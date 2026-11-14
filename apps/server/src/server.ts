import Fastify from 'fastify';
import middie from '@fastify/middie';
import fastifyStatic from '@fastify/static';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { authoringSchema, calculateCvss31, parseCandidates, caseSchema, providerInputSchema, runConfigSchema, validateCase,mcpConfigSchema,type AgentTool,type AgentToolOutput } from '@reprocase/core';
import type { SecretVault } from '../../../packages/ai/src/providers.ts';
import { Store } from './store.ts';
import { ReproService } from './service.ts';
import { acquireWorkspace } from './runtime.ts';

const projectRoot = process.env.REPROCASE_APP_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
const originsSchema = z.record(z.string(), z.string());
const directSchema = z.strictObject({ origin: z.string(), token: z.string().optional(), cookie: z.string().optional(), headers: z.record(z.string(), z.string()).optional(), login: z.strictObject({ path: z.string(), method: z.string().optional(), body: z.any().optional() }).optional() });
const actionSchema = z.strictObject({ type: z.enum(['navigate', 'click', 'fill', 'fillSecret', 'press', 'handoff']), ref: z.string().optional(), url: z.string().optional(), value: z.string().optional(), secretRef: z.string().optional() });

export async function createServer(options: { workspace?: string; port?: number; dev?: boolean; demo?: boolean; mode?: 'vulnerable' | 'secure'; memory?: boolean; writeRuntime?: boolean; vault?: SecretVault; providerFetch?: typeof fetch;desktop?:boolean;dataRoot?:string;computer?:{tools():AgentTool[];execute(name:string,input:unknown,signal:AbortSignal):Promise<AgentToolOutput>;image(id:string):Promise<Buffer>} } = {}) {
  const workspace = resolve(options.workspace ?? join(projectRoot, '.reprocase'));
  if (!options.memory) mkdirSync(workspace, { recursive: true });
  const releaseWorkspace = options.memory ? () => {} : acquireWorkspace(workspace);
  let cleanup = async () => {};
  try {
  const defaultPrompt=readFileSync(join(projectRoot,'prompts','AGENT.md'),'utf8');
  const service = new ReproService(new Store(options.memory ? ':memory:' : join(workspace, 'state.sqlite')), { vault: options.vault, providerFetch: options.providerFetch,desktop:options.desktop,dataRoot:options.dataRoot??workspace,computer:options.computer,prompt:defaultPrompt });
  cleanup = () => service.close();
  await service.initialize();
  service.store.recoverInterruptedRuns();
  cleanup = () => service.close();
  const token = randomBytes(32).toString('hex');
  service.registerSecret(token);
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
  let webOrigin = '';
  let allowedOrigins = new Set<string>();
  // Containers must listen on all interfaces so a published port can reach the service.
  // Host-header, Origin and token checks still only accept loopback clients' requests.
  const listenHost = process.env.REPROCASE_LISTEN_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0', '::'].includes(listenHost)) throw new Error('REPROCASE_LISTEN_HOST must be 127.0.0.1, 0.0.0.0 or ::');
  app.addHook('onRequest', async (request, reply) => {
    let pathname: string;
    try { pathname = decodeURIComponent(request.url.split('?')[0]); } catch { return reply.code(400).send({ error: 'Invalid request path encoding' }); }
    // Fastify decodes route segments. Authorize the matched route, not only the raw URL.
    const isApi = request.routeOptions.url?.startsWith('/api/') || /^\/api(?:\/|$)/.test(pathname);
    const host = request.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return reply.code(403).send({ error: 'Host is not allowed' });
    if (webOrigin && request.headers.origin && !allowedOrigins.has(request.headers.origin)) return reply.code(403).send({ error: 'Origin is not allowed' });
    if (isApi) {
      const received = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
      if (Buffer.byteLength(received) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(received), Buffer.from(token))) return reply.code(401).send({ error: 'Open the local launch URL to authenticate this browser' });
    }
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    if (!options.dev) reply.header('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
    if (isApi) reply.header('cache-control', 'no-store');
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof z.ZodError ? 400 : (error as any).statusCode && (error as any).statusCode < 500 ? (error as any).statusCode : 400;
    reply.code(status).send({ error: service.safeError(error), ...(error instanceof z.ZodError ? { issues: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) } : {}) });
  });
  app.get('/api/state', () => service.state());
  app.get<{ Params: { id: string } }>('/api/cases/:id', request => service.getCase(request.params.id));
  app.get<{ Params: { id: string } }>('/api/cases/:id/validate', request => ({ issues: validateCase(service.getCase(request.params.id)) }));
  app.post('/api/cases', request => service.saveCase(caseSchema.parse(request.body)));
  app.post('/api/cases/build', request => {
    const body = z.strictObject({ settings: authoringSchema, targetOrigin: z.string().optional() }).parse(request.body);
    return service.build(body.settings, body.targetOrigin);
  });
  app.post<{ Params: { id: string } }>('/api/cases/:id/preflight', request => service.plan(request.params.id, runConfigSchema.parse(request.body)));
  app.get('/api/runs/compare', request => {
    const query = z.strictObject({ before: z.string().min(1), after: z.string().min(1) }).parse(request.query);
    return service.compare(query.before, query.after);
  });
  app.put<{ Params: { id: string } }>('/api/cases/:id', request => {
    const body = z.strictObject({ case: caseSchema, expectedRevision: z.number().int().positive() }).parse(request.body);
    if (body.case.id !== request.params.id) throw new Error('Case identifier does not match the route');
    return service.saveCase(body.case, body.expectedRevision);
  });
  app.post('/api/candidates', request => { const body = z.strictObject({ kind: z.enum(['arjun', 'ffuf']), data: z.string() }).parse(request.body); return parseCandidates(body.kind, body.data); });
  app.post('/api/import', request => { const body = z.strictObject({ kind: z.enum(['har', 'http', 'package', 'burp', 'postman']), data: z.string() }).parse(request.body); return service.import(body.kind, body.data); });
  app.post<{ Params: { id: string } }>('/api/cases/:id/traffic/draft', request => service.draftFromLiveTraffic(request.params.id));
  app.post('/api/demo/start', request => { const body = z.object({ mode: z.enum(['vulnerable', 'secure']).default('vulnerable') }).parse(request.body ?? {}); return service.startDemo(body.mode); });
  app.post('/api/demo/bind', request => { const body = z.strictObject({ caseId: z.string(), fresh: z.boolean().default(false), authMode: z.enum(['cookie', 'bearer']).default('cookie') }).parse(request.body); return service.bindDemo(body.caseId, body.fresh, body.authMode); });
  app.post('/api/demo/mode', request => { const body = z.strictObject({ mode: z.enum(['vulnerable', 'secure']) }).parse(request.body); return service.setDemoMode(body.mode); });
  type ActorParams = { caseId: string; actorId: string };
  const actorPrefix = '/api/cases/:caseId/actors/:actorId';
  app.post<{ Params: ActorParams }>(`${actorPrefix}/browser`, request => { const body = z.strictObject({ origin: z.string() }).parse(request.body); return service.openBrowser(request.params.caseId, request.params.actorId, body.origin); });
  app.post<{ Params: ActorParams }>(`${actorPrefix}/direct`, request => service.connectDirect(request.params.caseId, request.params.actorId, directSchema.parse(request.body)));
  app.post<{ Params: ActorParams }>(`${actorPrefix}/verify`, request => { const body = z.object({ targets: originsSchema.optional() }).parse(request.body ?? {}); return service.verifyActor(request.params.caseId, request.params.actorId, body.targets); });
  app.get<{ Params: ActorParams }>(`${actorPrefix}/snapshot`, request => { service.actor(request.params.caseId, request.params.actorId); return service.browsers.snapshot(service.key(request.params.caseId, request.params.actorId)); });
  app.post<{ Params: ActorParams }>(`${actorPrefix}/action`, request => service.browserAction(request.params.caseId, request.params.actorId, actionSchema.parse(request.body)));
  app.post<{ Params: ActorParams }>(`${actorPrefix}/assist`, request => { const body = z.strictObject({ username: z.string().optional(), password: z.string().optional(), instructions: z.string().max(8000).optional() }).parse(request.body); return service.assistLogin(request.params.caseId, request.params.actorId, body); });
  app.post<{ Params: ActorParams }>(`${actorPrefix}/credentials`, request => { const body = z.strictObject({ username: z.string().optional(), password: z.string().optional() }).parse(request.body); service.actor(request.params.caseId, request.params.actorId); return service.browsers.setSecrets(service.key(request.params.caseId, request.params.actorId), body); });
  app.post<{ Params: ActorParams }>(`${actorPrefix}/recording`, request => { const body = z.strictObject({ enabled: z.boolean() }).parse(request.body); service.actor(request.params.caseId, request.params.actorId); service.browsers.recording(service.key(request.params.caseId, request.params.actorId), body.enabled); return { recording: body.enabled }; });
  app.get<{ Params: ActorParams }>(`${actorPrefix}/traffic`, request => { service.actor(request.params.caseId, request.params.actorId); const har = service.browsers.traffic(service.key(request.params.caseId, request.params.actorId)); return { ...har, entries: har.log.entries }; });
  app.post<{ Params: { id: string } }>('/api/cases/:id/run', request => { const body = z.strictObject({ targets: originsSchema, approvedRevision: z.number().int().positive(), maxRequests: z.number().int().positive().max(10000).optional(), intervalMs: z.number().min(0).max(60000).optional() }).parse(request.body); return service.startRun(request.params.id, body); });
  app.post<{ Params: { id: string } }>('/api/cases/:id/matrix', request => { const body = z.strictObject({ targets: originsSchema, approvedRevision: z.number().int().positive(), maxRequests: z.number().int().positive().max(10000).optional(), intervalMs: z.number().min(0).max(60000).optional() }).parse(request.body); return service.runMatrix(request.params.id, body); });
  app.get<{ Params: { id: string } }>('/api/runs/:id', request => service.getRun(request.params.id));
  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', request => service.cancelRun(request.params.id));
  app.get<{ Params: { id: string }; Querystring: { runId?: string } }>('/api/cases/:id/export', request => service.package(request.params.id, request.query.runId));
  app.get<{ Params: { id: string }; Querystring: { runId?: string; format?: string } }>('/api/cases/:id/report', (request, reply) => {
    const rawFormat = request.query.format;
    const format = rawFormat === 'markdown' || rawFormat === 'bounty' || rawFormat === 'hurl' || rawFormat === 'playwright' ? rawFormat : 'html';
    reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    return reply.type(format === 'html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8').send(service.report(request.params.id, format, request.query.runId));
  });
  app.post('/api/ai/settings', request => service.configureAI(z.strictObject({ provider: z.enum(['openai', 'compatible', 'anthropic']), baseURL: z.string().optional(), apiKey: z.string().optional(), model: z.string().min(1) }).parse(request.body)));
  app.post('/api/ai/propose', request => { const body = z.strictObject({ caseId: z.string(), prompt: z.string().min(1).max(12000) }).parse(request.body); return service.propose(body.caseId, body.prompt); });
  app.post('/api/ai/test', () => service.testAI());
  app.get('/api/providers', () => service.providerState());
  app.post('/api/providers', async request => { const result = await service.providers.save(providerInputSchema.parse(request.body)); service.ai.clear(); return result; });
  app.delete<{ Params: { id: string } }>('/api/providers/:id', async request => { await service.providers.remove(request.params.id); service.ai.clear(); return { ok: true }; });
  app.post<{ Params: { id: string } }>('/api/providers/:id/discover', request => service.providers.discover(request.params.id));
  app.post('/api/providers/activate', request => { const body = z.strictObject({ profileId: z.string(), modelId: z.string() }).parse(request.body); return service.activateProvider(body.profileId, body.modelId); });
  app.get('/api/chats', () => service.chats.list());
  app.post('/api/chats', () => service.chats.create());
  app.get<{ Params: { id: string } }>('/api/chats/:id', request => service.chats.get(request.params.id));
  app.post<{ Params: { id: string } }>('/api/chats/:id/messages', request => service.chats.send(request.params.id, request.body));
  app.post<{ Params: { id: string } }>('/api/chats/:id/cancel', request => service.chats.cancel(request.params.id));
  app.patch<{ Params: { id: string } }>('/api/chats/:id', request => { const body = z.strictObject({ title: z.string().trim().min(1).max(100) }).parse(request.body); return service.chats.rename(request.params.id, body.title); });
  app.delete<{ Params: { id: string } }>('/api/chats/:id', request => { service.chats.remove(request.params.id); return { ok: true }; });
  app.get('/api/agent/state',()=>({environment:service.harness.environment(),permissionMode:service.harness.permissions.getMode(),tools:service.harness.tools(),prompt:service.store.setting('agent.prompt',defaultPrompt),defaultPrompt}));
  app.post('/api/agent/permissions',request=>{const body=z.strictObject({mode:z.enum(['ask','auto_edit','autonomous'])}).parse(request.body);const mode=service.harness.permissions.setMode(body.mode);return {ok:true,permissionMode:mode};});
  app.post('/api/agent/prompt',request=>{const body=z.strictObject({prompt:z.string().min(20).max(30000)}).parse(request.body);service.store.setSetting('agent.prompt',body.prompt);return {ok:true};});
  app.get<{Querystring:{sessionId?:string}}>('/api/agent/approvals',request=>service.harness.permissions.list(request.query.sessionId));
  app.post<{Params:{id:string}}>('/api/agent/approvals/:id',request=>{const body=z.strictObject({choice:z.enum(['once','session','computer','always','autonomous','deny'])}).parse(request.body);service.harness.permissions.decide(request.params.id,body.choice);return {ok:true,permissionMode:service.harness.permissions.getMode()};});
  app.get<{Params:{id:string}}>('/api/agent/screenshots/:id',async(request,reply)=>reply.type('image/png').send(await service.harness.image(request.params.id)));
  app.post<{Params:{id:string}}>('/api/agent/backups/:id/restore',request=>{const body=z.object({path:z.string().optional()}).parse(request.body??{});return service.harness.restoreBackup(request.params.id,body.path);});
  app.post('/api/scans/cancel',()=>service.cancelScans());
  app.post('/api/recon/probe',request=>{const body=z.strictObject({origin:z.string().min(1).max(2000)}).parse(request.body);return service.probeTarget(body.origin);});
  app.post('/api/recon/extract',request=>{const body=z.strictObject({sourceText:z.string().min(1).max(500000),sourceLabel:z.string().max(100).optional()}).parse(request.body);return {endpoints:service.extractRecon(body.sourceText,body.sourceLabel)};});
  app.post('/api/recon/draft-case',request=>{
    const body=z.strictObject({
      endpoint:z.object({
        id:z.string().default('recon-endpoint'),
        method:z.enum(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']),
        path:z.string().min(1),
        parameters:z.array(z.string()).default([]),
        risk:z.enum(['high','medium','low']).default('high'),
        categories:z.array(z.enum(['idor_bola','bfla_privesc','race_condition','ssrf_redirect','graphql','info_disclosure'])).default(['idor_bola']),
        rationale:z.string().default('Discovered during reconnaissance.'),
        source:z.string().default('recon'),
      }),
      targetOrigin:z.string().optional(),
    }).parse(request.body);
    return service.draftFromReconEndpoint(body.endpoint,body.targetOrigin);
  });
  app.get('/api/bounty/state', () => service.bountyState());
  app.get('/api/bounty/programs', () => service.store.programs());
  app.post('/api/bounty/programs', request => service.saveProgram(z.record(z.string(), z.unknown()).parse(request.body)));
  app.delete<{ Params: { id: string } }>('/api/bounty/programs/:id', request => service.deleteProgram(request.params.id));
  app.post('/api/bounty/scope-check', request => { const body = z.strictObject({ target: z.string().min(1), programId: z.string().optional() }).parse(request.body); return service.checkTargetScope(body.target, body.programId); });
  app.post('/api/bounty/assets', request => { const body = z.strictObject({ domain: z.string().min(1), programId: z.string().optional() }).parse(request.body); return service.discoverAssets(body.domain, body.programId); });
  app.post('/api/bounty/security-pack', request => { const body = z.strictObject({ origin: z.string().min(1), programId: z.string().optional() }).parse(request.body); return service.runAuditPack(body.origin, body.programId); });
  app.post('/api/bounty/jwt-analyze', request => { const body = z.strictObject({ token: z.string().min(1) }).parse(request.body); return service.analyzeToken(body.token); });
  app.post('/api/bounty/traffic-audit', request => { const body = z.object({ caseId: z.string().optional(), trafficText: z.string().optional() }).parse(request.body ?? {}); return service.auditTraffic(body); });
  app.post('/api/bounty/js-audit', request => { const body = z.strictObject({ jsSource: z.string().min(1), sourceLabel: z.string().optional() }).parse(request.body); return service.analyzeJs(body.jsSource, body.sourceLabel); });
  app.post('/api/bounty/cvss', request => { const body = z.object({ vector: z.any() }).parse(request.body ?? {}); return calculateCvss31(body.vector); });
  app.get('/api/bounty/findings', () => service.store.findings());
  app.post('/api/bounty/findings', request => service.saveFinding(z.record(z.string(), z.unknown()).parse(request.body)));
  app.delete<{ Params: { id: string } }>('/api/bounty/findings/:id', request => service.deleteFinding(request.params.id));
  app.get<{ Params: { id: string } }>('/api/bounty/findings/:id/export', (request, reply) => reply.type('text/plain; charset=utf-8').send(service.exportFindingMarkdown(request.params.id)));
  app.get('/api/bounty/toolchain', () => service.detectToolchain());
  app.get('/api/mcp/servers',()=>service.mcp.list());
  app.post('/api/mcp/servers',request=>service.mcp.save(mcpConfigSchema.parse(request.body)));
  app.post<{Params:{id:string}}>('/api/mcp/servers/:id/connect',request=>service.mcp.connect(request.params.id));
  app.post<{Params:{id:string}}>('/api/mcp/servers/:id/disconnect',request=>service.mcp.disconnect(request.params.id));
  app.delete<{Params:{id:string}}>('/api/mcp/servers/:id',async request=>{await service.mcp.remove(request.params.id);return {ok:true};});

  let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
  cleanup = async () => { await service.close(); await app.close(); await vite?.close(); };
  if (options.dev) {
    const { createServer: createVite } = await import('vite');
    vite = await createVite({ root: join(projectRoot, 'apps/web'), configFile: join(projectRoot, 'apps/web/vite.config.ts'), server: { middlewareMode: true }, appType: 'spa' });
    await app.register(middie);
    app.use((request: any, response: any, next: any) => request.url.startsWith('/api/') ? next() : vite!.middlewares(request, response, next));
  } else {
    const dist = join(projectRoot, 'apps/web/dist');
    if (existsSync(join(dist, 'index.html'))) {
      await app.register(fastifyStatic, { root: dist, prefix: '/', wildcard: false });
      app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: 'Unknown API route' }) : reply.sendFile('index.html'));
    } else app.get('/', (_request, reply) => reply.type('text/html').send('<h1>ReproCase</h1><p>Build the interface with <code>npm run build</code>, or start development with <code>npm run dev</code>.</p>'));
  }
  const bound = await app.listen({ host: listenHost, port: options.port ?? 4317 });
  const port = new URL(bound).port;
  const address = listenHost === '127.0.0.1' ? bound : `http://localhost:${port}`;
  webOrigin = address;
  allowedOrigins = new Set(listenHost === '127.0.0.1' ? [address] : [address, `http://127.0.0.1:${port}`]);
  if (options.demo) await service.startDemo(options.mode ?? 'vulnerable');
  const runtimePath = join(workspace, 'runtime.json');
  if (!options.memory && options.writeRuntime !== false) writeFileSync(runtimePath, JSON.stringify({ origin: address, token, pid: process.pid }), { mode: 0o600 });
  const url = `${address}/#token=${token}`;
  let closed = false;
  return { app, service, origin: address, token, url, workspace, async close() {
    if (closed) return; closed = true;
    await service.close(); await app.close(); await vite?.close();
    if (!options.memory && options.writeRuntime !== false) {
      try { const saved = JSON.parse(readFileSync(runtimePath, 'utf8')); if (saved.token === token) unlinkSync(runtimePath); } catch { /* Another process may have replaced or removed its own runtime record. */ }
    }
    releaseWorkspace();
  } };
  } catch (error) { await cleanup(); releaseWorkspace(); throw error; }
}
export { projectRoot };
