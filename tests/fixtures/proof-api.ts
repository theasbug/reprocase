import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';

export async function startProofApi(options: { secure?: boolean; noEffect?: boolean; errorAfterWrite?: boolean; dropAfterWrite?: boolean; cors?: 'reflect' | 'null' | 'safe' | 'wildcard'; form?: boolean; publicData?: boolean; dropCors?: boolean; slowMutation?: boolean; failDelete?: boolean; errorRead?: boolean } = {}) {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 3000, timeWindow: '1 minute' });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));
  const users = { alice: { id: 'alice-account', tenant: 'team-one', role: 'admin' }, bob: { id: 'bob-account', tenant: 'team-one', role: 'member' } };
  const seen: { method: string; url: string; origin?: string; actor?: string }[] = [];
  const docs = new Map<string, any>();
  let secure = !!options.secure;
  const user = (req: any) => { const name = String(req.headers.authorization ?? '').replace('Bearer ', '') || /session=(alice|bob)/.exec(String(req.headers.cookie))?.[1]; return users[name as keyof typeof users]; };
  app.addHook('onRequest', async (req, reply) => {
    seen.push({ method: req.method, url: req.url, origin: req.headers.origin, actor: user(req)?.id });
    if (req.headers.origin && options.cors !== 'safe') {
      const allow = options.cors === 'wildcard' ? '*' : options.cors === 'null' ? 'null' : req.headers.origin;
      reply.header('access-control-allow-origin', allow).header('access-control-allow-credentials', 'true');
    }
  });
  app.get('/me', (req, reply) => user(req) ?? reply.code(401).send({ error: 'unauthorized' }));
  app.get('/private', (req, reply) => {
    if (options.dropCors && req.headers.origin) { reply.raw.destroy(); return reply; }
    if (options.errorRead && req.headers.origin && user(req)) return reply.code(403).send({ privateNote: `private-${user(req)!.id}-only` });
    return options.publicData ? { privateNote: 'private-alice-account-only' } : user(req) ? { privateNote: `private-${user(req)!.id}-only` } : reply.code(401).send({ error: 'unauthorized' });
  });
  app.get('/admin/report', (req, reply) => !user(req) ? reply.code(401).send({ error: 'unauthorized' }) : secure && user(req)!.role !== 'admin' ? reply.code(403).send({ error: 'admin only' }) : options.errorRead && user(req)!.role !== 'admin' ? reply.code(403).send({ confidential: 'payroll-private-this-run' }) : { confidential: 'payroll-private-this-run' });
  app.post('/documents', (req: any, reply) => {
    const u = user(req); if (!u) return reply.code(401).send({ error: 'unauthorized' });
    if (options.form && !String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')) return reply.code(415).send({ error: 'form required' });
    const doc = { id: randomUUID(), ownerId: u.id, tenant: u.tenant, text: String(req.body?.text ?? 'before'), count: 1, enabled: false, state: 'draft', details: { memo: String(req.body?.details?.memo ?? 'before') } };
    docs.set(doc.id, doc); return reply.code(201).send(doc);
  });
  const read = (req: any, reply: any) => {
    if (!user(req)) return reply.code(401).send({ error: 'unauthorized' });
    const doc = docs.get(req.params.id ?? req.query.id);
    return doc ?? reply.code(404).send({ error: 'missing' });
  };
  app.get('/documents/:id', read); app.get('/lookup', read);
  const update = async (req: any, reply: any) => {
    if (options.slowMutation) await new Promise(resolve => setTimeout(resolve, 200));
    const u = user(req); if (!u) return reply.code(401).send({ error: 'unauthorized' });
    if (options.form && !String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')) return reply.code(415).send({ error: 'form required' });
    const doc = docs.get(req.params.id ?? req.query.id ?? req.body?.id);
    if (!doc) return reply.code(404).send({ error: 'missing' });
    if (secure && u.id !== doc.ownerId) return reply.code(403).send({ error: 'owner only' });
    if (!options.noEffect || u.id === doc.ownerId) for (const k of ['text', 'count', 'enabled', 'state']) if (req.body?.[k] !== undefined) doc[k] = req.body[k];
    if ((!options.noEffect || u.id === doc.ownerId) && req.body?.details?.memo !== undefined) doc.details.memo = req.body.details.memo;
    if (u.id !== doc.ownerId && options.dropAfterWrite) { reply.raw.destroy(); return reply; }
    return options.errorAfterWrite && u.id !== doc.ownerId ? reply.code(500).send({ error: 'failed after commit' }) : { ok: true };
  };
  for (const method of ['PATCH', 'PUT', 'POST'] as const) { app.route({ method, url: '/documents/:id', handler: update }); app.route({ method, url: '/update', handler: update }); }
  app.delete('/documents/:id', (req: any, reply) => {
    if (options.failDelete) return reply.code(503).send({ error: 'cleanup unavailable' });
    if (docs.get(req.params.id)?.ownerId !== user(req)?.id) return reply.code(403).send({ error: 'owner only' });
    docs.delete(req.params.id); return { deleted: true };
  });
  app.get('/login/:name', (req: any, reply) => { reply.header('set-cookie', `session=${req.params.name}; Path=/; HttpOnly; SameSite=None; Secure`); return { signedIn: true }; });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, origin, users, seen, docs, setSecure(value: boolean) { secure = value; }, setCors(value: typeof options.cors) { options.cors = value; }, close: () => app.close() };
}
