import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';

export type DemoMode = 'vulnerable' | 'secure' | 'ambiguous';
export interface DemoAccount { id: string; email: string; password: string; tenant: string; role: 'member' | 'admin'; }
export async function startDemo(mode: DemoMode = 'vulnerable') {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const users = new Map<string, DemoAccount>();
  const sessions = new Map<string, { user: DemoAccount; csrf: string }>();
  const challenges = new Map<string, DemoAccount>();
  const documents = new Map<string, { id: string; ownerId: string; tenant: string; title: string; marker: string; visibility: 'private' }>();
  let currentMode = mode, pairNumber = 0, loginCount = 0, writeCount = 0;
  let pair: DemoAccount[] = [];
  const freshPair = () => {
    pairNumber++;
    pair = ['owner', 'researcher'].map((name, index) => ({ id: randomUUID(), email: `${name}${pairNumber}@reprocase.test`, password: `demo-${randomUUID().slice(0, 8)}`, tenant: `${index ? 'indigo' : 'mint'}-${randomUUID().slice(0, 8)}`, role: 'member' as const }));
    pair.forEach(user => users.set(user.email, user));
    return pair;
  };
  freshPair();
  const session = (request: any) => {
    const bearer = String(request.headers.authorization ?? '').replace(/^Bearer /i, '');
    const cookie = /(?:^|;\s*)rc_session=([^;]+)/.exec(String(request.headers.cookie ?? ''))?.[1];
    return sessions.get(bearer || cookie || '');
  };
  const authenticate = (request: any, reply: any) => { const entry = session(request); if (!entry) reply.code(401).send({ error: 'Sign in with a test account' }); return entry; };
  const establish = (user: DemoAccount, reply: any) => {
    const token = randomUUID() + randomUUID();
    sessions.set(token, { user, csrf: randomUUID() }); loginCount++;
    reply.header('set-cookie', `rc_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
    return { token, user: { id: user.id, tenant: user.tenant, role: user.role }, cookie: `rc_session=${token}` };
  };
  app.get('/health', () => ({ ok: true, demo: true }));
  app.get('/me', (request, reply) => { const entry = authenticate(request, reply); return entry ? { id: entry.user.id, tenant: entry.user.tenant, role: entry.user.role, email: entry.user.email } : undefined; });
  app.get('/csrf', (request, reply) => { const entry = authenticate(request, reply); return entry ? { csrf: entry.csrf } : undefined; });
  app.post('/auth/login', (request, reply) => {
    const body = request.body as any;
    const user = users.get(String(body?.email ?? ''));
    if (!user || user.password !== body?.password) return reply.code(401).send({ error: 'Invalid demo credentials' });
    if (body?.mfa === true) { const challenge = randomUUID(); challenges.set(challenge, user); return { needsMfa: true, challenge }; }
    return establish(user, reply);
  });
  app.post('/auth/mfa', (request, reply) => {
    const body = request.body as any, user = challenges.get(String(body?.challenge ?? ''));
    if (!user || body?.code !== '123456') return reply.code(401).send({ error: 'Use the demo code 123456' });
    challenges.delete(body.challenge); return establish(user, reply);
  });
  app.post('/auth/logout', (request, reply) => { const entry = session(request); for (const [key, item] of sessions) if (item === entry) sessions.delete(key); reply.header('set-cookie', 'rc_session=; Max-Age=0; Path=/'); return { ok: true }; });
  app.get('/documents', (request, reply) => { const entry = authenticate(request, reply); return entry ? { documents: [...documents.values()].filter(d => d.ownerId === entry.user.id) } : undefined; });
  app.post('/documents', (request, reply) => {
    const entry = authenticate(request, reply); if (!entry) return;
    if (request.headers['x-csrf-token'] !== entry.csrf) return reply.code(403).send({ error: 'CSRF token is required' });
    const body = request.body as any;
    if (typeof body?.marker !== 'string' || body.marker.length > 300 || typeof body?.title !== 'string') return reply.code(400).send({ error: 'Provide title and controlled marker' });
    const doc = { id: randomUUID(), ownerId: entry.user.id, tenant: entry.user.tenant, marker: body.marker, title: String(body.title).slice(0, 200), visibility: 'private' as const };
    documents.set(doc.id, doc); writeCount++;
    return reply.code(201).send(doc);
  });
  app.get<{ Params: { id: string } }>('/documents/:id', (request, reply) => {
    const entry = authenticate(request, reply); if (!entry) return;
    const doc = documents.get(request.params.id); if (!doc) return reply.code(404).send({ error: 'Not found' });
    if (doc.ownerId !== entry.user.id && currentMode === 'secure') return reply.code(403).send({ error: 'Private document: owner access only' });
    if (doc.ownerId !== entry.user.id && currentMode === 'ambiguous') return { status: 'ok', message: 'This response proves no access' };
    return doc;
  });
  app.patch<{ Params: { id: string } }>('/documents/:id', (request, reply) => {
    const entry = authenticate(request, reply); if (!entry) return;
    const doc = documents.get(request.params.id); if (!doc) return reply.code(404).send({ error: 'Not found' });
    if (request.headers['x-csrf-token'] !== entry.csrf) return reply.code(403).send({ error: 'CSRF token is required' });
    if (doc.ownerId !== entry.user.id && currentMode !== 'vulnerable') return reply.code(403).send({ error: 'Owner access only' });
    doc.title = String((request.body as any)?.title ?? '').slice(0, 200); writeCount++;
    return doc;
  });
  app.delete<{ Params: { id: string } }>('/documents/:id', (request, reply) => {
    const entry = authenticate(request, reply); if (!entry) return;
    const doc = documents.get(request.params.id); if (!doc) return reply.code(404).send({ error: 'Not found' });
    // Cleanup is always protected, including when read authorization is intentionally broken.
    if (doc.ownerId !== entry.user.id || request.headers['x-csrf-token'] !== entry.csrf) return reply.code(403).send({ error: 'Owner and CSRF token required' });
    documents.delete(doc.id); writeCount++; return { deleted: true };
  });
  app.get('/', (_request, reply) => reply.type('text/html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ReproCase · Test application</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101419;color:#e6edf4;font:16px system-ui}main{width:min(92vw,460px);padding:36px;border:1px solid #2b343f;border-radius:20px;background:#171d25}small{color:#55d4ba;letter-spacing:.12em}h1{font-size:27px}label{display:block;margin:18px 0 6px;color:#afbaca}input{width:100%;padding:12px;background:#101419;color:white;border:1px solid #3a4553;border-radius:8px}button{width:100%;padding:13px;border:0;border-radius:8px;background:#73e3cb;color:#11221f;font-weight:700;margin-top:22px;cursor:pointer}p{color:#9ba9ba;line-height:1.6}#message{white-space:pre-wrap}input[type=checkbox]{width:auto}</style><main><small>REPROCASE / CONTROLLED LAB</small><h1>Sign in to your test account</h1><p>This isolated application contains an intentional access-control flaw for reproduction testing.</p><form id="login"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><label><input id="mfa" type="checkbox"> Practice MFA handoff (code: 123456)</label><button>Sign in</button></form><form id="challenge" hidden><label for="code">Verification code</label><input id="code" autocomplete="one-time-code"><button>Verify code</button></form><p id="message" role="status"></p></main><script>
  const message=document.getElementById('message');let challenge;
  async function send(path,body){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
  function done(data){document.getElementById('login').hidden=true;document.getElementById('challenge').hidden=true;message.textContent='Signed in. You can return to ReproCase and verify this account.\\nTenant: '+data.user.tenant;}
  document.getElementById('login').onsubmit=async e=>{e.preventDefault();try{const data=await send('/auth/login',{email:document.getElementById('email').value,password:document.getElementById('password').value,mfa:document.getElementById('mfa').checked});if(data.needsMfa){challenge=data.challenge;document.getElementById('login').hidden=true;document.getElementById('challenge').hidden=false;message.textContent='Enter the code 123456 to continue.'}else done(data)}catch(e){message.textContent=e.message}};
  document.getElementById('challenge').onsubmit=async e=>{e.preventDefault();try{done(await send('/auth/mfa',{challenge,code:document.getElementById('code').value}))}catch(e){message.textContent=e.message}};
  fetch('/me').then(r=>r.ok?r.json():null).then(user=>{if(user)done({user})});
  </script></html>`));
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  return {
    origin, get mode() { return currentMode; }, setMode(next: DemoMode) { currentMode = next; },
    get accounts() { return pair; }, freshPair,
    stats: () => ({ documentCount: documents.size, loginCount, writeCount }),
    expireSessions() { sessions.clear(); },
    setRole(email: string, role: 'member' | 'admin') { const user = users.get(email); if (user) user.role = role; },
    close: () => app.close(),
  };
}
export type DemoServer = Awaited<ReturnType<typeof startDemo>>;
