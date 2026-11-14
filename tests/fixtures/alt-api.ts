/**
 * A second local lab whose API is deliberately shaped differently from the built-in demo, so
 * tests prove that Quick Proof infers the mechanism instead of relying on demo defaults:
 * - identity at /api/v1/profile with { account_id, org: { slug } }
 * - UUID object IDs under a wrapper: { note: { uid, created_by, org_slug, text } }
 * - custom auth header X-Auth-Token, CSRF via GET /api/v1/csrf + x-xsrf-token
 * - denial with 401
 */
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';

type Mode = 'vulnerable' | 'secure';
interface User { account_id: string; email: string; org: string; token: string; xsrf: string }

export async function startAltApi(mode: Mode = 'vulnerable') {
  let current = mode;
  const users = new Map<string, User>();
  const add = (email: string, org: string) => { const u = { account_id: randomUUID(), email, org, token: randomUUID().replace(/-/g, ''), xsrf: randomUUID() }; users.set(u.token, u); return u; };
  const alice = add('alice@alt.test', 'org-alpha');
  const bob = add('bob@alt.test', 'org-bravo');
  const carol = add('carol@alt.test', 'org-alpha');
  const notes = new Map<string, { uid: string; created_by: string; org_slug: string; text: string; color: string }>();
  let requests = 0;

  const app = Fastify({ logger: false });
  // Like a real API, the lab limits request rates. The limit is far above what the tests send.
  await app.register(rateLimit, { max: 2000, timeWindow: '1 minute' });
  app.addHook('onRequest', async () => { requests++; });
  const who = (req: any) => users.get(String(req.headers['x-auth-token'] ?? ''));
  const auth = (req: any, reply: any) => { const u = who(req); if (!u) reply.code(401).send({ message: 'unauthorized' }); return u; };

  app.get('/api/v1/profile', (req, reply) => { const u = auth(req, reply); return u && { account_id: u.account_id, email: u.email, org: { slug: u.org, plan: 'team' }, prefs: { theme: 'dark' } }; });
  app.get('/api/v1/csrf', (req, reply) => { const u = auth(req, reply); return u && { xsrf: u.xsrf }; });
  app.post('/api/v1/notes', (req: any, reply) => {
    const u = auth(req, reply); if (!u) return;
    if (req.headers['x-xsrf-token'] !== u.xsrf) return reply.code(403).send({ message: 'csrf token missing' });
    const body = req.body ?? {};
    if (typeof body.text !== 'string') return reply.code(400).send({ message: 'text is required' });
    const note = { uid: randomUUID(), created_by: u.account_id, org_slug: u.org, text: body.text, color: String(body.color ?? 'yellow') };
    notes.set(note.uid, note);
    return reply.code(201).send({ ok: true, note });
  });
  app.get('/api/v1/notes/:uid', (req: any, reply) => {
    const u = auth(req, reply); if (!u) return;
    const note = notes.get(req.params.uid);
    if (!note) return reply.code(404).send({ message: 'not found' });
    if (current === 'secure' && note.created_by !== u.account_id) return reply.code(401).send({ message: 'not yours' });
    return { note };
  });
  app.delete('/api/v1/notes/:uid', (req: any, reply) => {
    const u = auth(req, reply); if (!u) return;
    if (req.headers['x-xsrf-token'] !== u.xsrf) return reply.code(403).send({ message: 'csrf token missing' });
    const note = notes.get(req.params.uid);
    if (!note || note.created_by !== u.account_id) return reply.code(404).send({ message: 'not found' });
    notes.delete(note.uid); return { ok: true };
  });

  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  return {
    origin,
    users: { alice, bob, carol },
    setMode(next: Mode) { current = next; },
    noteCount: () => notes.size,
    requestCount: () => requests,
    close: () => app.close(),
  };
}
