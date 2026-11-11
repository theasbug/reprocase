import { describe, expect, it } from 'vitest';
import { createRedactor } from '../packages/core/src/redact.ts';
import { importTraffic } from '../packages/core/src/import.ts';
import { exportPackage, renderHTML, renderMarkdown } from '../packages/core/src/export.ts';
import { createExampleCase } from '../packages/core/src/example.ts';
import { packageSchema, type RunResult } from '../packages/core/src/schema.ts';

const harEntry = (method: string, path: string, body?: unknown, response?: unknown, headers: { name: string; value: string }[] = []) => ({
  request: { method, url: `https://old-target.example${path}`, headers: [{ name: 'Authorization', value: 'Bearer source-token-not-for-sharing' }, ...headers], ...(body === undefined ? {} : { postData: { text: JSON.stringify(body) } }) },
  response: { content: { text: JSON.stringify(response ?? {}) } },
});
const makeHAR = (entries: unknown[]) => JSON.stringify({ log: { version: '1.2', entries } });

describe('portable traffic imports', () => {
  it('derives fresh producer references while removing source credentials, targets, and IDs', () => {
    const sourceId = '62d4816a-5ca4-43a9-adc6-8d59c711b805';
    const originalMarker = 'only-in-the-recording-private-marker';
    const imported = importTraffic('har', makeHAR([
      harEntry('GET', '/csrf', undefined, { csrf: 'source-csrf-should-not-survive' }),
      harEntry('POST', '/documents', { title: 'Controlled test', marker: originalMarker }, { id: sourceId, ownerId: 'source-owner-identity', tenant: 'source-tenant-identity' }, [{ name: 'x-csrf-token', value: 'source-csrf-should-not-survive' }]),
      harEntry('GET', `/documents/${sourceId}`, undefined, { id: sourceId }),
    ]));
    const serialised = JSON.stringify(imported.case);
    expect(serialised).not.toContain('source-token-not-for-sharing');
    expect(serialised).not.toContain('old-target.example');
    expect(serialised).not.toContain(sourceId);
    expect(serialised).not.toContain(originalMarker);
    expect(serialised).not.toContain('source-csrf-should-not-survive');
    expect(imported.case.policy.acknowledged).toBe(false);
    expect(imported.case.steps[1].request.headers['x-csrf-token']).toEqual({ $ref: 'captures.step1_csrf' });
    expect(imported.case.steps[1].request.body).toMatchObject({ marker: { $ref: 'run.marker' } });
    expect(imported.case.steps[2].request.path).toBe('/documents/{id1}');
    expect(imported.case.steps[2].request.pathParams.id1).toEqual({ $ref: 'captures.step2_id' });
    expect(imported.case.resources[0]).toMatchObject({ createdBy: 'step2', idRef: 'captures.step2_id', ownerRef: 'captures.step2_ownerId' });
  });

  it('keeps ambiguous identifier matches unresolved instead of silently choosing the wrong entity', () => {
    const imported = importTraffic('har', makeHAR([
      harEntry('POST', '/documents', {}, { id: 78349, ownerId: 78349 }),
      harEntry('GET', '/documents/78349'),
    ]));
    expect(imported.case.steps[1].request.pathParams.id1).toMatchObject({ $ref: expect.stringContaining('captures.importedId') });
    expect(imported.warnings.join(' ')).toContain('multiple possible producers');
    expect(JSON.stringify(imported.case)).not.toContain('78349');
  });

  it('redacts raw HTTP source auth and leaves an explicit binding for unknown numeric IDs', () => {
    const result = importTraffic('http', 'GET /documents/4815162342?userId=986432 HTTP/1.1\r\nHost: captured.example\r\nCookie: session=unshareable-session-secret\r\nX-API-Key: source-api-secret\r\n\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"marker":"historical-only"}');
    const serialised = JSON.stringify(result.case);
    for (const old of ['4815162342', '986432', 'unshareable-session-secret', 'source-api-secret', 'captured.example', 'historical-only']) expect(serialised).not.toContain(old);
    expect(result.case.steps[0].request.path).toBe('/documents/{id1}');
    expect(result.warnings.join(' ')).toContain('no observed producer');
  });

  it('rejects a package containing executable or unrecognised case fields', () => {
    const pack = exportPackage(createExampleCase());
    expect(() => importTraffic('package', JSON.stringify({ ...pack, shell: 'echo unsafe' }))).toThrow();
    expect(() => importTraffic('package', JSON.stringify({ ...pack, case: { ...pack.case, javascript: 'process.exit()' } }))).toThrow();
  });

  it('does not treat historical package evidence as a new execution', () => {
    const pack = exportPackage(createExampleCase());
    const result = importTraffic('package', JSON.stringify(pack));
    expect(result.warnings.join(' ')).toContain('historical observation');
    expect(result).not.toHaveProperty('verdict');
  });
});

describe('secret and evidence redaction', () => {
  it('redacts credentials across earlier text and preserves executable reference objects', () => {
    const redactor = createRedactor();
    const redacted = redactor.json({
      error: 'The request included raw-credential-secret',
      request: { headers: { Authorization: 'Bearer raw-credential-secret', 'x-csrf-token': { $ref: 'captures.ownerCsrf' } } },
      nested: { refresh_token: 'refresh-private-value' },
    });
    expect(JSON.stringify(redacted)).not.toContain('raw-credential-secret');
    expect(JSON.stringify(redacted)).not.toContain('refresh-private-value');
    expect(redacted.request.headers['x-csrf-token']).toEqual({ $ref: 'captures.ownerCsrf' });
  });

  it('redacts short IDs as typed leaves and URL components without corrupting prose or timestamps', () => {
    const redactor = createRedactor();
    redactor.alias(7, 'actors.owner.id');
    expect(redactor.json({ id: 7, timestamp: '2026-11-10T17:23:00Z' })).toEqual({ id: '[actors.owner.id]', timestamp: '2026-11-10T17:23:00Z' });
    const url = redactor.text('https://target.example/documents/7?ownerId=7');
    expect(decodeURIComponent(url)).toContain('/documents/[actors.owner.id]');
    expect(decodeURIComponent(url)).toContain('ownerId=[actors.owner.id]');
    expect(redactor.text('The process took 7 seconds')).toBe('The process took 7 seconds');
  });

  it('exports a portable spec and scrubbed historical evidence without resource IDs, markers, or session secrets', () => {
    const spec = createExampleCase();
    const run: RunResult = {
      schemaVersion: 1, id: 'run-1', caseId: spec.id, caseRevision: 1, state: 'completed', verdict: 'reproduced', reason: 'Observed the private marker', code: 'witness_observed',
      startedAt: '2026-11-10T17:00:00Z', finishedAt: '2026-11-10T17:00:01Z', setup: 'created_this_run', requests: 6, cleanupErrors: [], checks: [],
      identities: { owner: { id: 'private-owner-id', tenant: 'private-owner-tenant' }, researcher: { id: 'private-researcher-id', tenant: 'private-researcher-tenant' } },
      steps: [{ id: 'create-document', label: 'Create', phase: 'prepare', actor: 'owner', status: 'passed', startedAt: '2026-11-10T17:00:00Z', checks: [],
        request: { method: 'POST', url: 'https://target.example/documents', body: { title: 'Controlled test', marker: 'rc_private_marker_for_this_run' } },
        response: { status: 201, headers: { 'set-cookie': 'session=do-not-export-this-secret; Path=/; HttpOnly' }, body: { id: 'private-document-id', ownerId: 'private-owner-id', tenant: 'private-owner-tenant', marker: 'rc_private_marker_for_this_run' } } },
        { id: 'cross-tenant-read', label: 'Read', phase: 'probe', actor: 'researcher', status: 'passed', startedAt: '2026-11-10T17:00:01Z', checks: [], request: { method: 'GET', url: 'https://target.example/documents/private-document-id' }, response: { status: 200, headers: {}, body: { marker: 'rc_private_marker_for_this_run' } } }],
    };
    const exported = exportPackage(spec, run);
    packageSchema.parse(exported);
    const serialised = JSON.stringify(exported);
    for (const privateValue of ['private-owner-id', 'private-owner-tenant', 'private-researcher-id', 'private-document-id', 'rc_private_marker_for_this_run', 'do-not-export-this-secret']) expect(serialised).not.toContain(privateValue);
    expect(exported.case.steps[1].request.body).toMatchObject({ marker: { $ref: 'run.marker' } });
    expect(serialised).toContain('Historical local observation');
  });

  it('escapes hostile report strings and includes no executable external resources', () => {
    const spec = createExampleCase();
    spec.title = '<script>alert("report")</script>';
    spec.description = '<img src=x onerror=alert(1)>';
    const exported = exportPackage(spec);
    const report = renderHTML(exported);
    expect(report).not.toContain('<script>');
    expect(report).not.toContain('<img src=x');
    expect(report).toContain('&lt;script&gt;');
    expect(report).toContain("default-src 'none'");
    expect(renderMarkdown(exported)).not.toContain('<script>');
  });

  it('keeps metadata and HTTP status numeric when identities collide with 1, 2, or 200', () => {
    const spec = createExampleCase();
    const redactor = createRedactor();
    redactor.alias(1, 'actors.owner.id');
    redactor.alias(2, 'actors.researcher.id');
    redactor.alias(200, 'captures.documentId');
    const run: RunResult = {
      schemaVersion: 1, id: 'numeric-run', caseId: spec.id, caseRevision: 1, state: 'completed', verdict: 'reproduced', reason: 'Witness observed', code: 'witness_observed', startedAt: '2026-11-10T17:00:00Z', setup: 'created_this_run', requests: 2, cleanupErrors: [], checks: [],
      identities: { owner: { id: 1, tenant: 'owner-tenant' }, researcher: { id: 2, tenant: 'researcher-tenant' } },
      steps: [{ id: 'create-document', label: 'Create', phase: 'prepare', actor: 'owner', status: 'passed', startedAt: '2026-11-10T17:00:00Z', checks: [], response: { status: 200, headers: {}, body: { id: 200, ownerId: 1, tenant: 'owner-tenant' } } }],
    };
    const safe = redactor.json(run);
    expect(safe.schemaVersion).toBe(1);
    expect(safe.caseRevision).toBe(1);
    expect(safe.requests).toBe(2);
    expect(safe.steps[0].response?.status).toBe(200);
    expect(safe.identities.owner.id).toBe('[actors.owner.id]');
    expect(safe.steps[0].response?.body).toMatchObject({ id: '[captures.documentId]', ownerId: '[actors.owner.id]' });
    const pack = exportPackage(spec, run);
    expect(pack.case.schemaVersion).toBe(1);
    expect(pack.case.revision).toBe(1);
    expect((pack.evidence as Record<string, unknown>).schemaVersion).toBe(1);
    expect(() => packageSchema.parse(pack)).not.toThrow();
  });
});
