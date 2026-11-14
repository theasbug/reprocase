/**
 * Quick Proof server flow. It sends only the requests the user starts from the wizard, through
 * the same scope/budget/rate policy as runs, and uses the accounts the user bound. The output is
 * an ordinary case: the policy stays unacknowledged and the run still needs explicit approval.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CSRF_PATHS, IDENTITY_PATHS, buildQuickProof, caseSchema, findCsrfPointer, findOwnerPointer, inferCreate, inferIdentity, jsonPointer, parseRequest, rolePreconditions, scalarFields, targetOrigin, templatePath, type QuickProofKind, type CaseSpec, type HttpResponse, type IdentityGuess, type Json, type ResolvedRequest } from '@reprocase/core';
import { observeExpanded } from './quickproof-expanded.ts';
import type { BrowserManager } from '@reprocase/browser';
import type { ScanNetwork } from '@reprocase/core';

type Actor = 'owner' | 'researcher';
interface Session { id: string; origin: string; kind: QuickProofKind; identity?: IdentityGuess; createdAt: number; finished?: boolean }

export const connectSchema = z.strictObject({
  actor: z.enum(['owner', 'researcher']),
  token: z.string().min(1).max(8192).optional(),
  cookie: z.string().min(1).max(16384).optional(),
  header: z.strictObject({ name: z.string().regex(/^[A-Za-z0-9-]{1,64}$/), value: z.string().min(1).max(8192) }).optional(),
}).refine(v => [v.token, v.cookie, v.header].filter(Boolean).length === 1, 'Provide exactly one of token, cookie or header');
export const identitySchema = z.strictObject({ path: z.string().startsWith('/').max(500).optional(), idPointer: z.string().max(300).optional(), tenantPointer: z.string().max(300).optional(), rolePointer: z.string().max(300).optional() });
export const observeSchema = z.strictObject({
  create: z.string().max(200_000).optional(),
  vulnerable: z.string().min(1).max(200_000),
  title: z.string().max(200).optional(),
  read: z.string().max(200_000).optional(), field: z.string().max(512).optional(),
  csrf: z.strictObject({ path: z.string().startsWith('/'), pointer: z.string(), header: z.string().regex(/^[A-Za-z0-9-]+$/) }).optional(),
});

export interface QuickProofDeps {
  browsers: BrowserManager;
  network: (signal?: AbortSignal) => ScanNetwork;
  saveCase: (spec: CaseSpec) => CaseSpec;
  saveTargets: (caseId: string, targets: Record<string, string>) => void;
}

export class QuickProof {
  private sessions = new Map<string, Session>();
  private controllers = new Map<string, AbortController>();
  private tasks = new Set<Promise<unknown>>();
  constructor(private deps: QuickProofDeps) {}
  cancel(id: string) { this.controllers.get(id)?.abort(); return { cancelled: true }; }
  cancelAll() { for (const controller of this.controllers.values()) controller.abort(); }
  async close() { this.cancelAll(); await Promise.allSettled([...this.tasks]); }
  private async operation<T>(id: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.controllers.has(id)) throw Object.assign(new Error('A verification is already running for this session'), { statusCode: 429 });
    const controller = new AbortController(); this.controllers.set(id, controller);
    const task = fn(controller.signal); this.tasks.add(task);
    try { return await task; } finally { this.controllers.delete(id); this.tasks.delete(task); }
  }

  private key(id: string, actor: Actor) { return `${id}:${actor}`; }
  private get(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw Object.assign(new Error('Quick Proof session not found. Start again.'), { statusCode: 404 });
    return s;
  }

  start(originInput: string, kind: QuickProofKind = 'authorization') {
    const origin = targetOrigin(originInput);
    const id = `qp-${randomUUID().slice(0, 12)}`;
    this.sessions.set(id, { id, origin, kind, createdAt: Date.now() });
    return { id, origin, kind };
  }

  async connect(id: string, input: z.infer<typeof connectSchema>) {
    const s = this.get(id);
    if (this.controllers.has(id)) throw new Error('Wait for the active verification before changing accounts');
    if (s.finished) throw new Error('This draft is saved. Connect accounts through the case or start a new Quick proof.');
    await this.deps.browsers.connectDirect(this.key(id, input.actor), {
      origin: s.origin,
      ...(input.token ? { token: input.token } : {}),
      ...(input.cookie ? { cookie: input.cookie } : {}),
      ...(input.header ? { headers: { [input.header.name]: input.header.value } } : {}),
    });
    s.identity = undefined;
    return this.status(id);
  }

  async openBrowser(id: string, actor: Actor) {
    const s = this.get(id);
    if (this.controllers.has(id)) throw new Error('Wait for the active verification before changing accounts');
    if (s.finished) throw new Error('This draft is saved. Start a new Quick proof.');
    await this.deps.browsers.open(this.key(id, actor), s.origin);
    s.identity = undefined;
    return this.status(id);
  }

  status(id: string) {
    const s = this.get(id);
    const actor = (a: Actor) => { const st = this.deps.browsers.status(this.key(id, a)); return st ? { mode: st.mode, connected: st.connected, identity: st.identity, error: st.error } : null; };
    return { id, origin: s.origin, owner: actor('owner'), researcher: actor('researcher'), identity: s.identity ? { path: s.identity.path, idPointer: s.identity.idPointer, tenantPointer: s.identity.tenantPointer, sameTenant: s.identity.sameTenant, confidence: s.identity.confidence } : null };
  }

  private async send(id: string, actor: Actor, network: ScanNetwork, request: Omit<ResolvedRequest, 'url'> & { path: string }): Promise<HttpResponse> {
    const s = this.get(id);
    const url = new URL(request.path, s.origin).toString();
    await network.authorize(url);
    const { path: _path, ...rest } = request;
    return this.deps.browsers.request(this.key(id, actor), { ...rest, url }, network.signal);
  }

  /** Deletes the observation object. Returns a message naming the object when that did not succeed. */
  private async removeObservation(id: string, network: ScanNetwork, objectPath: string, csrfHeaders: (actor: Actor) => Promise<Record<string, string>>): Promise<string | undefined> {
    const where = `${this.get(id).origin}${objectPath}`;
    try {
      const del = await this.send(id, 'owner', network, { method: 'DELETE', path: objectPath, headers: await csrfHeaders('owner') });
      return del.status >= 300 ? `The observation object could not be deleted (HTTP ${del.status}). Remove it manually: ${where}` : undefined;
    } catch {
      return `The observation object could not be deleted. Remove it manually: ${where}`;
    }
  }

  /** Finds the "who am I" endpoint and the identity fields by comparing both accounts. */
  async detectIdentity(id: string, input: z.infer<typeof identitySchema> = {}) {
    return this.operation(id, signal => this.detectIdentityInner(id, input, signal));
  }
  private async detectIdentityInner(id: string, input: z.infer<typeof identitySchema>, signal: AbortSignal) {
    const s = this.get(id);
    const actors = s.kind === 'cors_read' ? ['owner'] as const : ['owner', 'researcher'] as const;
    for (const a of actors) if (!this.deps.browsers.status(this.key(id, a))) throw Object.assign(new Error(`Connect the ${a === 'owner' ? 'first (owner)' : 'second'} account first.`), { statusCode: 422 });
    const network = this.deps.network(signal);
    const tried: { path: string; owner: number; researcher: number }[] = [];
    let found: { guess: IdentityGuess; a: Json; b: Json } | undefined;
    for (const path of input.path ? [input.path] : IDENTITY_PATHS) {
      const a = await this.send(id, 'owner', network, { method: 'GET', path, headers: {} });
      const b = s.kind === 'cors_read' ? a : await this.send(id, 'researcher', network, { method: 'GET', path, headers: {} });
      tried.push({ path, owner: a.status, researcher: b.status });
      if (a.status !== 200 || b.status !== 200) continue;
      const idField = s.kind === 'cors_read' ? scalarFields(a.body).find(f => /^(?:id|account_id|user_id|uid|sub)$/i.test(f.key)) : undefined;
      const guess = idField ? { path, idPointer: idField.pointer, sameTenant: true, fields: scalarFields(a.body).map(f => ({ pointer: f.pointer, a: f.value })), confidence: 'medium' as const } : inferIdentity(path, a.body, b.body);
      if (guess) { found = { guess, a: a.body, b: b.body }; break; }
    }
    if (!found) return { found: false as const, tried, message: input.path ? 'This endpoint did not return two different account IDs. Check that both accounts are signed in and different.' : 'No common identity endpoint answered for both accounts. Enter the path your app uses for the signed-in user (for example /api/v2/account).' };
    const guess = { ...found.guess, ...(input.idPointer ? { idPointer: input.idPointer } : {}), ...(input.tenantPointer !== undefined ? (input.tenantPointer ? { tenantPointer: input.tenantPointer } : { tenantPointer: undefined }) : {}) };
    if (input.rolePointer) { guess.rolePointer = input.rolePointer; guess.roles = [String(jsonPointer(found.a, input.rolePointer)), String(jsonPointer(found.b, input.rolePointer))]; }
    if (input.tenantPointer !== undefined) guess.sameTenant = !guess.tenantPointer || String(jsonPointer(found.a, guess.tenantPointer)) === String(jsonPointer(found.b, guess.tenantPointer));
    for (const a of actors) {
      // The confirming identity request goes through the same policy as the detection requests.
      await network.authorize(new URL(guess.path, s.origin).toString());
      await this.deps.browsers.verify(this.key(id, a), { origin: 'api', path: guess.path, idPointer: guess.idPointer, ...(guess.tenantPointer ? { tenantPointer: guess.tenantPointer } : {}), ...(guess.rolePointer && s.kind === 'role' ? { rolePointer: guess.rolePointer } : {}) }, signal);
    }
    s.identity = guess;
    return { found: true as const, tried, identity: guess, status: this.status(id) };
  }

  /**
   * Runs the user's creation request once as the owner, learns where the new ID and owner appear,
   * previews the vulnerable request as the other account, cleans up, and saves a draft case.
   */
  async observe(id: string, input: z.infer<typeof observeSchema>) {
    return this.operation(id, signal => this.observeInner(id, input, signal));
  }
  private async observeInner(id: string, input: z.infer<typeof observeSchema>, signal: AbortSignal) {
    const s = this.get(id);
    if (s.finished) throw new Error('This draft is already saved. Start a new Quick proof for another observation.');
    if (!s.identity) throw Object.assign(new Error('Detect the account identities first.'), { statusCode: 422 });
    const vulnerable = parseRequest(input.vulnerable);
    if (s.kind === 'cors_read' || (s.kind === 'role' && !input.create) || vulnerable.method !== 'GET') {
      const result = await observeExpanded({ ...this.deps, network: () => this.deps.network(signal) }, s, input);
      if (result.status === 'ready') s.finished = true;
      return result;
    }
    const create = parseRequest(input.create ?? '');
    if (create.method !== 'POST' || !create.body) throw Object.assign(new Error('The creation request must be a POST with a JSON or form body.'), { statusCode: 422 });
    if (vulnerable.method !== 'GET') throw Object.assign(new Error('Quick Proof currently proves read access (GET). Use the case editor for write IDORs.'), { statusCode: 422 });
    const template = templatePath(vulnerable.path);
    if (!template) throw Object.assign(new Error('The vulnerable request has no object ID in its path (for example /api/orders/123).'), { statusCode: 422 });
    const owner = this.deps.browsers.verifiedIdentity(this.key(id, 'owner'));
    if (!owner) throw Object.assign(new Error('The owner account is not verified.'), { statusCode: 422 });
    const network = this.deps.network(signal);
    const notes: string[] = [];
    const contentHeaders = create.contentType === 'form' ? { 'content-type': 'application/x-www-form-urlencoded' } : { 'content-type': 'application/json' };
    let csrf = input.csrf;
    const csrfHeaders = async (actor: Actor): Promise<Record<string, string>> => {
      if (!csrf) return {};
      const r = await this.send(id, actor, network, { method: 'GET', path: csrf.path, headers: {} });
      const token = jsonPointer(r.body, csrf.pointer);
      if (typeof token !== 'string' || !token) throw Object.assign(new Error('The CSRF endpoint did not return a token for this account.'), { statusCode: 422 });
      return { [csrf.header]: token };
    };
    const doCreate = async () => this.send(id, 'owner', network, { method: 'POST', path: create.path, headers: { ...contentHeaders, ...(await csrfHeaders('owner')) }, contentType: create.contentType, body: create.body as Json });
    let created = await doCreate();
    if (!csrf && [403, 419].includes(created.status) && /csrf|xsrf/i.test(JSON.stringify(created.body ?? ''))) {
      for (const path of CSRF_PATHS) {
        const r = await this.send(id, 'owner', network, { method: 'GET', path, headers: {} });
        const pointer = r.status === 200 ? findCsrfPointer(r.body) : undefined;
        if (!pointer) continue;
        for (const header of ['x-csrf-token', 'x-xsrf-token']) {
          csrf = { path, pointer, header };
          created = await doCreate();
          if (created.status >= 200 && created.status < 300) { notes.push(`CSRF detected: token from ${path}, sent as ${header}.`); break; }
          csrf = undefined;
        }
        if (csrf) break;
      }
    }
    if (created.status < 200 || created.status >= 300) throw Object.assign(new Error(`The creation request returned HTTP ${created.status} for the owner account. Check the request body and that the account can create this object.`), { statusCode: 422 });
    let guess: ReturnType<typeof inferCreate>;
    try { guess = inferCreate({ requestBody: create.body, responseBody: created.body, sampleId: template.sampleId, owner }); }
    catch (error) {
      // The object exists on the target but its ID is unknown, so it cannot be removed automatically.
      throw Object.assign(new Error(`${(error as Error).message} The creation returned HTTP ${created.status}, so an object was probably created with account A; remove it manually.`), { statusCode: 422 });
    }
    notes.push(...guess.notes);
    const newId = jsonPointer(created.body, guess.idResponsePointer);
    const objectPath = template.readPath.replace('{resource}', encodeURIComponent(String(newId)));
    let ownerRead: HttpResponse, other: HttpResponse;
    try {
      ownerRead = await this.send(id, 'owner', network, { method: 'GET', path: objectPath, headers: {} });
      if (!guess.ownerResponsePointer && ownerRead.status === 200) {
        const pointer = findOwnerPointer(ownerRead.body, owner.id);
        if (pointer) { guess.ownerResponsePointer = pointer; guess.ownerSource = 'owner_read'; }
      }
      other = await this.send(id, 'researcher', network, { method: 'GET', path: objectPath, headers: {} });
    } catch (error) {
      const cleanup = await this.removeObservation(id, network, objectPath, csrfHeaders);
      throw Object.assign(new Error(`${(error as Error).message} ${cleanup ?? 'The observation object was deleted.'}`), { statusCode: 422 });
    }
    // The proof run creates and removes its own object; this one only served the observation.
    const cleanup = await this.removeObservation(id, network, objectPath, csrfHeaders);
    if (cleanup) notes.push(cleanup);
    const built = buildQuickProof({ ...(input.title ? { title: input.title } : {}), identity: s.identity, createPath: create.path, createBody: create.body, ...(create.contentType === 'form' ? { createContentType: 'form' as const } : {}), create: guess, readPath: template.readPath, ...(csrf ? { csrf } : {}) }, id);
    let spec = s.kind === 'role' ? caseSchema.parse({ ...built.case, schemaVersion: 2, kind: 'authorization', boundary: 'role' }) : built.case;
    if (s.kind === 'role') rolePreconditions(spec, s.identity);
    const saved = this.deps.saveCase(spec);
    s.finished = true;
    this.deps.saveTargets(saved.id, { api: s.origin });
    return {
      status: 'ready' as const,
      case: saved,
      issues: built.issues,
      notes,
      learned: { identity: { path: s.identity.path, idPointer: s.identity.idPointer, tenantPointer: s.identity.tenantPointer }, objectPath: template.readPath, idField: guess.idResponsePointer, ownerField: guess.ownerResponsePointer, ownerSource: guess.ownerSource, markerField: guess.markerRequestPointer, csrf: csrf ?? null, boundary: built.authoring.boundary },
      preview: { owner: ownerRead.status, other: other.status, otherSawObject: other.status === 200 && JSON.stringify(other.body).includes(String(newId)) },
    };
  }
}

export const credentialSchema = z.strictObject({
  token: z.string().min(1).max(8192).optional(),
  cookie: z.string().min(1).max(16384).optional(),
  header: z.strictObject({ name: z.string().regex(/^[A-Za-z0-9-]{1,64}$/), value: z.string().min(1).max(8192) }).optional(),
}).refine(v => [v.token, v.cookie, v.header].filter(Boolean).length === 1, 'Provide exactly one of token, cookie or header');
export const verifySiteSchema = z.strictObject({ origin: z.string().min(1), accounts: z.record(z.string(), credentialSchema) });
export const directInput = (origin: string, c: z.infer<typeof credentialSchema>) => ({
  origin,
  ...(c.token ? { token: c.token.replace(/^Bearer\s+/i, '') } : {}),
  ...(c.cookie ? { cookie: c.cookie } : {}),
  ...(c.header ? { headers: { [c.header.name]: c.header.value } } : {}),
});
