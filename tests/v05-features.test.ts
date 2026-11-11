import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  analyzeJsBundle,
  analyzeJwtToken,
  auditTrafficSecurity,
  buildCaseFromEndpoint,
  calculateCvss31,
  checkScope,
  createExampleCase,
  executeCase,
  executeMatrix,
  exportPackage,
  extractEndpointsFromText,
  importMultiActorTraffic,
  importTraffic,
  probeOrigin,
  renderBountyReport,
  renderFindingMarkdown,
  renderHurl,
  renderPlaywright,
  runSecurityAuditPack,
  validateCase,
  type CaseSpec,
  type HttpResponse,
  type ResolvedRequest,
  type SessionTransport,
} from '../packages/core/src/index.ts';
import { Harness } from '../apps/server/src/harness.ts';
import { McpManager } from '../apps/server/src/mcp-client.ts';
import { createServer } from '../apps/server/src/server.ts';

describe('v0.5 core, runner, matrix, importers, exporters, and agent rollback', () => {
  it('supports GraphQL POST read probes and extended operators (gt, lte, regex, not_contains)', async () => {
    const base = createExampleCase();
    const spec: CaseSpec = {
      ...base,
      steps: [
        base.steps[0]!,
        base.steps[1]!,
        base.steps[2]!,
        {
          id: 'graphql-probe',
          label: 'Query document over GraphQL as researcher',
          phase: 'probe',
          effect: 'read',
          request: {
            actor: 'researcher',
            origin: 'api',
            method: 'POST',
            path: '/graphql',
            pathParams: {},
            query: {},
            headers: {},
            contentType: 'graphql',
            body: {
              query: 'query GetDoc($id: ID!) { document(id: $id) { id marker score } }',
              variables: { id: { $ref: 'captures.documentId' } },
            },
          },
          captures: [],
          checks: [],
        },
        base.steps[4]!,
      ],
      witness: {
        success: [
          { id: 'marker-match', label: 'GraphQL response exposes the fresh marker', op: 'regex', left: { $ref: 'steps.graphql-probe.body.data.document.marker' }, right: '^rc_' },
          { id: 'exact-marker', label: 'Marker equals run marker', op: 'eq', left: { $ref: 'steps.graphql-probe.body.data.document.marker' }, right: { $ref: 'run.marker' } },
          { id: 'score-gt', label: 'Score is greater than 10', op: 'gt', left: { $ref: 'steps.graphql-probe.body.data.document.score' }, right: 10 },
          { id: 'no-error-text', label: 'Marker does not contain forbidden', op: 'not_contains', left: { $ref: 'steps.graphql-probe.body.data.document.marker' }, right: 'FORBIDDEN' },
        ],
        rejection: [
          { id: 'denied', label: 'Denied status', op: 'in', left: { $ref: 'steps.graphql-probe.status' }, right: [403, 404] },
        ],
      },
    };

    expect(validateCase(spec).filter(i => i.level === 'error')).toEqual([]);

    let createdMarker = '';
    const transport: SessionTransport = {
      knownSecrets: () => [],
      async request(actorId: string, req: ResolvedRequest): Promise<HttpResponse> {
        if (req.url.endsWith('/me')) {
          return { status: 200, headers: {}, body: actorId === 'owner' ? { id: 'u1', tenant: 't1', role: 'member' } : { id: 'u2', tenant: 't2', role: 'member' } };
        }
        if (req.url.endsWith('/csrf')) return { status: 200, headers: {}, body: { csrf: 'csrf-tok' } };
        if (req.method === 'POST' && req.url.endsWith('/documents')) {
          createdMarker = String((req.body as any)?.marker ?? '');
          return { status: 201, headers: {}, body: { id: 'doc-99', ownerId: 'u1', tenant: 't1', visibility: 'private', marker: createdMarker } };
        }
        if (req.method === 'GET' && req.url.includes('/documents/doc-99')) {
          return { status: 200, headers: {}, body: { id: 'doc-99', ownerId: 'u1', tenant: 't1', visibility: 'private', marker: createdMarker } };
        }
        if (req.method === 'POST' && req.url.endsWith('/graphql')) {
          expect(req.headers['content-type']).toBe('application/json');
          return { status: 200, headers: {}, body: { data: { document: { id: 'doc-99', marker: createdMarker, score: 42 } } } };
        }
        return { status: 204, headers: {}, body: null };
      },
    };

    const result = await executeCase(spec, { targets: { api: 'https://api.example.com' }, approvedRevision: spec.revision, intervalMs: 0 }, transport);
    expect(result.verdict).toBe('reproduced');
  });

  it('executes concurrent barrier requests for TOCTOU / race condition probes', async () => {
    const base = createExampleCase();
    const spec: CaseSpec = {
      ...base,
      steps: [
        base.steps[0]!,
        base.steps[1]!,
        base.steps[2]!,
        {
          id: 'race-probe',
          label: 'Redeem single-use resource concurrently',
          phase: 'probe',
          effect: 'write',
          concurrency: { count: 5, mode: 'parallel' },
          request: {
            actor: 'researcher',
            origin: 'api',
            method: 'POST',
            path: '/documents/{documentId}',
            pathParams: { documentId: { $ref: 'captures.documentId' } },
            query: {},
            headers: {},
            body: { action: 'redeem' },
          },
          captures: [],
          checks: [],
        },
        base.steps[4]!,
      ],
      witness: {
        success: [
          { id: 'race-succeeded-multiple', label: 'More than one concurrent request succeeded', op: 'gt', left: { $ref: 'steps.race-probe.concurrency.succeeded' }, right: 1 },
        ],
        rejection: [
          { id: 'race-blocked', label: 'At most one or zero requests succeeded', op: 'lte', left: { $ref: 'steps.race-probe.concurrency.succeeded' }, right: 1 },
        ],
      },
    };

    expect(validateCase(spec).filter(i => i.level === 'error')).toEqual([]);

    let raceCalls = 0;
    let raceMarker = '';
    const transport: SessionTransport = {
      knownSecrets: () => [],
      async request(actorId: string, req: ResolvedRequest): Promise<HttpResponse> {
        if (req.url.endsWith('/me')) return { status: 200, headers: {}, body: actorId === 'owner' ? { id: 'u1', tenant: 't1', role: 'member' } : { id: 'u2', tenant: 't2', role: 'member' } };
        if (req.url.endsWith('/csrf')) return { status: 200, headers: {}, body: { csrf: 'csrf-tok' } };
        if (req.method === 'POST' && req.url.endsWith('/documents')) {
          raceMarker = String((req.body as any)?.marker ?? '');
          return { status: 201, headers: {}, body: { id: 'doc-race', ownerId: 'u1', tenant: 't1', visibility: 'private', marker: raceMarker } };
        }
        if (req.method === 'GET' && req.url.includes('/documents/doc-race')) {
          return { status: 200, headers: {}, body: { id: 'doc-race', ownerId: 'u1', tenant: 't1', visibility: 'private', marker: raceMarker } };
        }
        if (req.method === 'POST' && req.url.includes('/documents/doc-race')) {
          raceCalls++;
          return { status: raceCalls <= 3 ? 200 : 409, headers: {}, body: { redeemed: raceCalls <= 3 } };
        }
        return { status: 204, headers: {}, body: null };
      },
    };

    const run = await executeCase(spec, { targets: { api: 'https://api.example.com' }, approvedRevision: spec.revision, intervalMs: 0 }, transport);
    expect(run.verdict).toBe('reproduced');
    const probeStep = run.steps.find(s => s.id === 'race-probe');
    expect(probeStep?.concurrency).toEqual({ count: 5, succeeded: 3, statuses: [200, 200, 200, 409, 409] });
  });

  it('evaluates a multi-actor role access matrix across challengers', async () => {
    const base = createExampleCase();
    const spec: CaseSpec = {
      ...base,
      actors: [
        base.actors[0]!,
        { ...base.actors[1]!, id: 'peer', label: 'Same-tenant peer', expectedRole: 'member' },
        { ...base.actors[1]!, id: 'outsider', label: 'Cross-tenant user', expectedRole: 'guest' },
      ],
      preconditions: [
        { id: 'different-user', label: 'Actors are distinct', op: 'neq', left: { $ref: 'actors.owner.id' }, right: { $ref: 'actors.peer.id' } },
      ],
      steps: base.steps.map(s => s.request.actor === 'researcher' ? { ...s, request: { ...s.request, actor: 'peer' } } : s),
    };

    let currentMarker = '';
    const transport: SessionTransport = {
      knownSecrets: () => [],
      async request(actorId: string, req: ResolvedRequest): Promise<HttpResponse> {
        if (req.url.endsWith('/me')) {
          const map: Record<string, any> = {
            owner: { id: 'u-owner', tenant: 't-alpha', role: 'member' },
            peer: { id: 'u-peer', tenant: 't-alpha', role: 'member' },
            outsider: { id: 'u-out', tenant: 't-beta', role: 'guest' },
          };
          return { status: 200, headers: {}, body: map[actorId] };
        }
        if (req.url.endsWith('/csrf')) return { status: 200, headers: {}, body: { csrf: 'tok' } };
        if (req.method === 'POST' && req.url.endsWith('/documents')) {
          currentMarker = String((req.body as any)?.marker ?? '');
          return { status: 201, headers: {}, body: { id: 'doc-m', ownerId: 'u-owner', tenant: 't-alpha', visibility: 'private', marker: currentMarker } };
        }
        if (req.method === 'GET' && req.url.includes('/documents/doc-m')) {
          if (actorId === 'outsider') return { status: 403, headers: {}, body: { error: 'Forbidden' } };
          return { status: 200, headers: {}, body: { id: 'doc-m', ownerId: 'u-owner', tenant: 't-alpha', marker: currentMarker } };
        }
        return { status: 204, headers: {}, body: null };
      },
    };

    const matrix = await executeMatrix(spec, { targets: { api: 'https://api.example.com' }, approvedRevision: spec.revision, intervalMs: 0 }, transport);
    expect(matrix.summary).toEqual({ totalActors: 2, reproduced: 1, notReproduced: 1, inconclusive: 0 });
    expect(matrix.cells.find(c => c.actorId === 'peer')?.verdict).toBe('reproduced');
    expect(matrix.cells.find(c => c.actorId === 'outsider')?.verdict).toBe('not_reproduced');
  });

  it('imports Burp XML, Postman v2.1 collections, and multi-actor live traffic with full redaction', () => {
    const rawReq = 'POST /documents HTTP/1.1\r\nHost: burp-target.example\r\nAuthorization: Bearer secret-burp-jwt\r\nContent-Type: application/json\r\n\r\n{"title":"Doc","marker":"old-marker"}';
    const rawRes = 'HTTP/1.1 201 Created\r\nContent-Type: application/json\r\n\r\n{"id":"99887766","ownerId":"u-1"}';
    const rawProbe = 'GET /documents/99887766 HTTP/1.1\r\nHost: burp-target.example\r\nCookie: sid=secret-cookie\r\n\r\n';
    const burpXml = `<items><item><url>https://burp-target.example/documents</url><request base64="true">${Buffer.from(rawReq).toString('base64')}</request><response base64="true">${Buffer.from(rawRes).toString('base64')}</response></item><item><url>https://burp-target.example/documents/99887766</url><request base64="false"><![CDATA[${rawProbe}]]></request></item></items>`;

    const burpImported = importTraffic('burp', burpXml);
    const burpSerialized = JSON.stringify(burpImported.case);
    expect(burpSerialized).not.toContain('secret-burp-jwt');
    expect(burpSerialized).not.toContain('secret-cookie');
    expect(burpSerialized).not.toContain('99887766');
    expect(burpImported.case.steps[1]?.request.path).toBe('/documents/{id1}');
    expect(burpImported.case.steps[1]?.request.pathParams.id1).toEqual({ $ref: 'captures.step1_id' });

    const postman = {
      info: { name: 'Bounty API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        {
          name: 'Create Resource',
          request: {
            method: 'POST',
            header: [{ key: 'Authorization', value: 'Bearer pm-secret-token' }],
            url: { raw: 'https://pm.example.com/projects', host: ['pm', 'example', 'com'], path: ['projects'] },
            body: { mode: 'urlencoded', urlencoded: [{ key: 'name', value: 'Alpha' }, { key: 'marker', value: 'old' }] },
          },
          response: [{ body: JSON.stringify({ id: '550e8400-e29b-41d4-a716-446655440000', ownerId: 'owner-1' }) }],
        },
        {
          name: 'Read Resource',
          request: {
            method: 'GET',
            header: [],
            url: 'https://pm.example.com/projects/550e8400-e29b-41d4-a716-446655440000',
          },
        },
      ],
    };
    const pmImported = importTraffic('postman', JSON.stringify(postman));
    expect(JSON.stringify(pmImported.case)).not.toContain('pm-secret-token');
    expect(pmImported.case.steps[0]?.request.contentType).toBe('form');
    expect(pmImported.case.steps[1]?.request.path).toBe('/projects/{id1}');

    const multi = importMultiActorTraffic([
      { actorId: 'owner', entries: [{ startedDateTime: '2026-11-11T10:00:01Z', request: { method: 'POST', url: 'https://app.example/items', headers: [], postData: { text: '{"marker":"m"}' } }, response: { content: { text: '{"id":"12345","ownerId":"u1"}' } } }] },
      { actorId: 'researcher', entries: [{ startedDateTime: '2026-11-11T10:00:02Z', request: { method: 'GET', url: 'https://app.example/items/12345', headers: [] }, response: { content: { text: '{"id":"12345"}' } } }] },
    ]);
    expect(multi.case.steps[0]?.request.actor).toBe('owner');
    expect(multi.case.steps[1]?.request.actor).toBe('researcher');
  });

  it('renders HackerOne/Bugcrowd bounty reports, Hurl scripts, and Playwright tests', () => {
    const spec = createExampleCase();
    const pack = exportPackage(spec);
    const bounty = renderBountyReport(pack);
    expect(bounty).toContain('# [Bug Bounty Report]');
    expect(bounty).toContain('CWE-639');
    expect(bounty).toContain('## Remediation Recommendation');

    const hurl = renderHurl(spec, { api: 'https://target.example' });
    expect(hurl).toContain('POST https://target.example/documents');
    expect(hurl).toContain('[Captures]');
    expect(hurl).toContain('documentId: jsonpath "$.id"');

    const pw = renderPlaywright(spec, { api: 'https://target.example' });
    expect(pw).toContain("import { test, expect } from '@playwright/test';");
    expect(pw).toContain('executeCase');
  });

  it('computes unified line diffs on file writes and restores backups via rollback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reprocase-v05-'));
    try {
      const mcp = new McpManager({ desktop: true, save: () => {} });
      const harness = new Harness({
        desktop: true,
        root: dir,
        dataRoot: dir,
        saveRoot: () => {},
        secrets: () => [],
        mcp,
        caseAction: async () => ({}),
      });
      const ctrl = new AbortController();
      await harness.execute('filesystem_write_file', { path: 'notes.txt', content: 'line1\nline2\n', expectedSha256: '' }, 's1', ctrl.signal, () => {});
      const read1 = JSON.parse(String(await harness.execute('filesystem_read_file', { path: 'notes.txt' }, 's1', ctrl.signal, () => {})));
      const write2 = JSON.parse(String(await harness.execute('filesystem_write_file', { path: 'notes.txt', content: 'line1\nline2-modified\nline3\n', expectedSha256: read1.sha256 }, 's1', ctrl.signal, () => {})));

      expect(write2.backupId).toBeTruthy();
      expect(write2.addedLines).toBe(2);
      expect(write2.removedLines).toBe(1);
      expect(write2.diff).toContain('- line2');
      expect(write2.diff).toContain('+ line2-modified');

      const rolled = JSON.parse(String(await harness.execute('filesystem_rollback', { backupId: write2.backupId }, 's1', ctrl.signal, () => {})));
      expect(rolled.restored).toBe(true);
      expect(rolled.sha256).toBe(read1.sha256);

      const readAfter = JSON.parse(String(await harness.execute('filesystem_read_file', { path: 'notes.txt' }, 's1', ctrl.signal, () => {})));
      expect(readAfter.content).toBe('line1\nline2\n');
      harness.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('supports autonomous (unlimited authority) and auto_edit permission modes without prompting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reprocase-perm-'));
    try {
      const mcp = new McpManager({ desktop: true, save: () => {} });
      const harness = new Harness({
        desktop: true,
        root: dir,
        dataRoot: dir,
        saveRoot: () => {},
        permissionMode: 'autonomous',
        secrets: () => [],
        mcp,
        caseAction: async () => ({ ok: true }),
      });
      const ctrl = new AbortController();
      let prompted = false;
      const cmdResult = JSON.parse(String(await harness.execute('terminal_run', { command: "echo 'autonomous-ok'", timeoutSeconds: 30 }, 's-auto', ctrl.signal, () => { prompted = true; })));
      expect(prompted).toBe(false);
      expect(cmdResult.exitCode, JSON.stringify(cmdResult)).toBe(0);
      expect(cmdResult.timedOut).toBe(false);
      expect(cmdResult.output).toContain('autonomous-ok');

      // Switch to ask mode, start a pending approval, then switch to autonomous to unblock immediately
      harness.permissions.setMode('ask');
      let approvalCreated = false;
      const pendingPromise = harness.execute('terminal_run', { command: "echo 'unblocked'", timeoutSeconds: 30 }, 's-auto', ctrl.signal, () => {
        approvalCreated = true;
        harness.permissions.setMode('autonomous');
      });
      const unblockedResult = JSON.parse(String(await pendingPromise));
      expect(approvalCreated).toBe(true);
      expect(unblockedResult.exitCode, JSON.stringify(unblockedResult)).toBe(0);
      expect(unblockedResult.output).toContain('unblocked');
      harness.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90000);

  it('probes target origins, extracts & ranks bug bounty candidates, and drafts cases from recon findings', async () => {
    const jsBundle = `
      const a = axios.get('/api/v1/documents/{documentId}');
      const b = axios.post('/api/v1/admin/roles', { role: 'superadmin' });
      const c = fetch('/api/v1/coupons/redeem', { method: 'POST' });
      const d = fetch('/api/v1/webhooks?callback=https://evil.example');
    `;
    const endpoints = extractEndpointsFromText(jsBundle, 'bundle.js');
    expect(endpoints.length).toBeGreaterThanOrEqual(4);
    expect(endpoints.some(e => e.path.includes('/documents') && e.categories.includes('idor_bola') && e.risk === 'high')).toBe(true);
    expect(endpoints.some(e => e.path.includes('/admin/roles') && e.categories.includes('bfla_privesc'))).toBe(true);
    expect(endpoints.some(e => e.path.includes('/coupons/redeem') && e.categories.includes('race_condition'))).toBe(true);
    expect(endpoints.some(e => e.path.includes('/webhooks') && e.categories.includes('ssrf_redirect'))).toBe(true);

    const idorCandidate = endpoints.find(e => e.path.includes('/documents'))!;
    const drafted = buildCaseFromEndpoint(idorCandidate, 'Recon');
    expect(validateCase({ ...drafted.case, policy: { ...drafted.case.policy, acknowledged: true } }).filter(i => i.level === 'error')).toEqual([]);

    const report = await probeOrigin('https://target.example', async url => {
      const u = String(url);
      if (u.endsWith('/openapi.json')) {
        return new Response(JSON.stringify({
          openapi: '3.0.0',
          paths: {
            '/api/orders/{orderId}': { get: { parameters: [{ name: 'orderId', in: 'path' }] } },
            '/api/redeem': { post: {} },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('<html><body>/api/users/42</body></html>', {
        status: 200,
        headers: {
          'content-type': 'text/html',
          'server': 'nginx/1.24.0',
          'access-control-allow-origin': 'https://recon-check.example',
          'access-control-allow-credentials': 'true',
        },
      });
    });
    expect(report.securityFindings.some(f => f.id === 'cors-origin-reflection' && f.severity === 'high')).toBe(true);
    expect(report.securityFindings.some(f => f.id === 'missing-csp')).toBe(true);
    expect(report.endpoints.some(e => e.path === '/api/orders/{orderId}' && e.categories.includes('idor_bola'))).toBe(true);
  });

  it('handles mid-task follow-up messages smoothly without stalling or corrupting history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reprocase-chat-followup-'));
    let releaseFirstRound!: (res: Response) => void;
    const bodies: any[] = [];
    const sseEvents = (items: any[]) => new Response(items.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });

    const srv = await createServer({
      memory: true,
      port: 0,
      desktop: true,
      dataRoot: dir,
      providerFetch: async (url, init) => {
        if (String(url).endsWith('/models')) {
          return new Response(JSON.stringify({ data: [{ id: 'test-model', capabilities: { vision: true } }] }), { headers: { 'content-type': 'application/json' } });
        }
        bodies.push(JSON.parse(String(init?.body)));
        if (bodies.length === 1) {
          return new Promise<Response>(r => { releaseFirstRound = r; });
        }
        return sseEvents([
          { choices: [{ delta: { content: 'Completed both instructions cleanly.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } },
        ]);
      },
    });

    try {
      const p = await srv.service.providers.save({ providerId: 'custom' });
      await srv.service.providers.discover(p.id);
      const chat = srv.service.chats.create();

      srv.service.chats.send(chat.id, { profileId: p.id, modelId: 'test-model', content: 'First task' });
      // Send follow-up while first task is still running
      srv.service.chats.send(chat.id, { profileId: p.id, modelId: 'test-model', content: 'Follow-up instruction while running' });

      // Simulate provider repeating tool_call id across delta chunks
      releaseFirstRound(sseEvents([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-99', function: { name: 'filesystem_list_directory', arguments: '{"pa' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-99', function: { name: 'filesystem_list_directory', arguments: 'th":"."}' } }] }, finish_reason: 'tool_calls' }] },
      ]));

      await expect.poll(() => srv.service.chats.list().find(c => c.id === chat.id)?.pending, { timeout: 5000 }).toBe(false);
      const finalChat = srv.service.chats.get(chat.id);
      expect(finalChat.messages.filter(m => m.status === 'queued')).toHaveLength(0);
      expect(finalChat.messages.at(-1)?.content).toContain('Completed both instructions cleanly.');
      // Verify no empty assistant ghost message was left behind
      expect(finalChat.messages.every(m => m.role !== 'assistant' || m.content.trim().length > 0 || (m.activities?.length ?? 0) > 0 || (m.reasoningText?.trim().length ?? 0) > 0)).toBe(true);
      // Verify tool_call id was not duplicated across chunks
      const assistantMsgInSecondBody = bodies[1].messages.find((m: any) => m.role === 'assistant' && m.tool_calls);
      expect(assistantMsgInSecondBody.tool_calls[0].id).toBe('call-99');
      expect(assistantMsgInSecondBody.tool_calls[0].function.name).toBe('filesystem_list_directory');
    } finally {
      await srv.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates bug bounty scope rules, calculates FIRST.org CVSS v3.1 scores, and runs all built-in security analyzers', async () => {
    const program = {
      id: 'prog-1',
      name: 'Acme Bounty',
      platform: 'hackerone' as const,
      inScope: ['*.acme.example', 'https://api.partner.example/v2/*'],
      outOfScope: ['blog.acme.example', 'staging.acme.example'],
      rateLimitRps: 5,
      customHeaders: {},
      notes: '',
      updatedAt: new Date().toISOString(),
    };
    expect(checkScope('https://app.acme.example/documents/1', program).allowed).toBe(true);
    expect(checkScope('https://blog.acme.example/post', program).allowed).toBe(false);
    expect(checkScope('https://api.partner.example/v2/users', program).allowed).toBe(true);
    expect(checkScope('https://evil.example', program).allowed).toBe(false);

    // CVSS v3.1 calculator verification
    const cvssHigh = calculateCvss31({ AV: 'N', AC: 'L', PR: 'L', UI: 'N', S: 'U', C: 'H', I: 'L', A: 'N' });
    expect(cvssHigh.vector).toBe('CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N');
    expect(cvssHigh.score).toBe(7.1);
    expect(cvssHigh.severity).toBe('High');

    const cvssCritical = calculateCvss31({ AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'C', C: 'H', I: 'H', A: 'H' });
    expect(cvssCritical.score).toBe(10.0);
    expect(cvssCritical.severity).toBe('Critical');

    // JWT Security Analyzer (alg=none + actor pointer inference)
    const headerB64 = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: '../../etc/passwd' })).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify({ sub: 'user-42', org_id: 'tenant-acme', role: 'admin' })).toString('base64url');
    const jwtRes = analyzeJwtToken(`Bearer ${headerB64}.${payloadB64}.`);
    expect(jwtRes.validFormat).toBe(true);
    expect(jwtRes.findings.some(f => f.id === 'jwt-alg-none' && f.severity === 'high')).toBe(true);
    expect(jwtRes.findings.some(f => f.id === 'jwt-header-kid')).toBe(true);
    expect(jwtRes.suggestedPointers).toEqual({
      idPointer: '/sub',
      tenantPointer: '/org_id',
      rolePointer: '/role',
    });

    // Passive Traffic, Secret & Cookie Auditor
    const trafficRes = auditTrafficSecurity(`
      HTTP/1.1 200 OK
      Set-Cookie: session_id=xyz123; Path=/
      const awsKey = "AKIAIOSFODNN7EXAMPLE";
    `);
    expect(trafficRes.leakedSecretsCount).toBeGreaterThanOrEqual(1);
    expect(trafficRes.insecureCookiesCount).toBeGreaterThanOrEqual(1);
    expect(trafficRes.findings.some(f => f.id === 'leak-aws-key')).toBe(true);
    expect(trafficRes.findings.some(f => f.id.startsWith('insecure-cookie-'))).toBe(true);

    // JS Bundle, Source Map & GraphQL Analyzer
    const jsRes = analyzeJsBundle([
      "fetch('/api/v1/Invoices/999');",
      "const q = `mutation PromoteUser($id: ID!) { promoteUser(id: $id) { ok } }`;",
      '//#' + ' sourceMappingURL=app.bundle.js.map',
    ].join('\n'));
    expect(jsRes.endpoints.some(e => e.path.includes('/api/v1/Invoices'))).toBe(true);
    expect(jsRes.graphqlOperations).toContainEqual({ type: 'mutation', name: 'PromoteUser' });
    expect(jsRes.sourceMaps).toContain('app.bundle.js.map');

    // Active Security Audit Pack
    const packRes = await runSecurityAuditPack('https://api.acme.example', undefined, async (_url, init) => {
      const h = new Headers(init?.headers);
      if (init?.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { Allow: 'GET, POST, PUT, DELETE, TRACE' } });
      }
      if (h.get('Origin') === 'null') {
        return new Response('{}', { status: 200, headers: { 'access-control-allow-origin': 'null', 'access-control-allow-credentials': 'true' } });
      }
      return new Response('{}', { status: 200 });
    });
    expect(packRes.findings.some(f => f.id === 'cors-null-origin-allowed' && f.severity === 'high')).toBe(true);
    expect(packRes.findings.some(f => f.id === 'http-risky-methods-advertised')).toBe(true);
    expect(packRes.allowedMethods).toContain('TRACE');
  });

  it('stores bug bounty programs and findings in SQLite and exposes bounty_* agent tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reprocase-bounty-srv-'));
    const srv = await createServer({ memory: true, port: 0, desktop: true, dataRoot: dir });
    try {
      const savedProg = srv.service.saveProgram({
        name: 'GitHub Security Lab',
        platform: 'hackerone',
        inScope: ['*.github.example'],
        outOfScope: ['status.github.example'],
      });
      expect(srv.service.bountyState().programs).toHaveLength(1);
      expect(srv.service.checkTargetScope('https://api.github.example/repos', savedProg.id).allowed).toBe(true);

      const savedFinding = srv.service.saveFinding({
        programId: savedProg.id,
        title: 'Cross-Tenant Document Read via GraphQL IDOR',
        category: 'IDOR / BOLA',
        cwe: 'CWE-639',
        endpoint: 'POST /graphql',
        cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N',
      });
      expect(savedFinding.cvssScore).toBe(6.5);
      expect(savedFinding.severity).toBe('Medium');
      const md = renderFindingMarkdown(savedFinding, savedProg);
      expect(md).toContain('CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N');
    } finally {
      await srv.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
