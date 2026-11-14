/**
 * Quick Proof: infer a case from observations instead of hand-written JSON Pointers.
 *
 * Everything here is pure. The server sends the (user-approved, scope-checked) requests and
 * passes the observed responses in. The output is ordinary guided-authoring input, so the
 * existing builder, validator and runner decide the verdict exactly as before.
 */
import { buildCase, type AuthoringInput } from './authoring.ts';
import type { Json } from './schema.ts';

/** Common "who am I" endpoints, tried in order with both accounts (GET only). */
export const IDENTITY_PATHS = ['/me', '/api/me', '/api/v1/me', '/api/v2/me', '/users/me', '/api/users/me', '/api/v1/users/me', '/user', '/api/user', '/account', '/api/account', '/profile', '/api/profile', '/api/v1/profile', '/auth/me', '/api/auth/me', '/api/session', '/whoami', '/api/whoami'] as const;

export interface FieldValue { pointer: string; key: string; value: string | number }
type Plain = Record<string, unknown>;
const isObject = (v: unknown): v is Plain => !!v && typeof v === 'object' && !Array.isArray(v);
const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
const SECRET_KEY = /(?:pass(?:word)?|secret|token|api[_-]?key|session|cookie|authorization|credential|private)/i;

/** Lists scalar fields with JSON Pointers. Bounded depth and count; secret-named fields are skipped. */
export function scalarFields(body: unknown, maxDepth = 5, limit = 400, includeSecretKeys = false): FieldValue[] {
  const out: FieldValue[] = [];
  const walk = (value: unknown, pointer: string, key: string, depth: number) => {
    if (out.length >= limit || depth > maxDepth) return;
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
      if ((includeSecretKeys || !SECRET_KEY.test(key)) && String(value).length <= 300) out.push({ pointer, key, value });
    } else if (isObject(value)) for (const [k, v] of Object.entries(value)) walk(v, `${pointer}/${escape(k)}`, k, depth + 1);
    else if (Array.isArray(value)) value.slice(0, 5).forEach((v, i) => walk(v, `${pointer}/${i}`, key, depth + 1));
  };
  walk(body, '', '', 0);
  return out;
}

const ID_KEY = /^(?:id|uuid|guid|sub|uid|(?:user|account|member|customer|profile|principal)[_-]?(?:id|uuid))$/i;
const TENANT_KEY = /(?:tenant|org|organi[sz]ation|team|workspace|company|account|group|realm|project)/i;
const TENANT_LEAF = /^(?:id|uuid|slug|key|name|tenant|org|team|workspace|company)$/i;
const depthOf = (pointer: string) => pointer.split('/').length - 1;

export interface IdentityGuess {
  path: string;
  idPointer: string;
  tenantPointer?: string;
  /** True when both accounts report the same tenant value. */
  sameTenant: boolean;
  /** Fields a user can pick from if a guess is wrong. */
  fields: { pointer: string; a: string | number; b?: string | number }[];
  confidence: 'high' | 'medium';
}

/**
 * Compares the same endpoint as two different accounts. The account ID is a field that both
 * responses have and that differs between them; the tenant is an organization-like field.
 */
export function inferIdentity(path: string, bodyA: unknown, bodyB: unknown): IdentityGuess | undefined {
  if (!isObject(bodyA) || !isObject(bodyB)) return undefined;
  const a = scalarFields(bodyA), bMap = new Map(scalarFields(bodyB).map(f => [f.pointer, f.value]));
  const shared = a.filter(f => bMap.has(f.pointer));
  const differing = shared.filter(f => String(f.value) !== String(bMap.get(f.pointer)));
  const rankId = (f: FieldValue) => (ID_KEY.test(f.key) ? 0 : /id$/i.test(f.key) ? 1 : /email|login|username/i.test(f.key) ? 3 : 2) * 10 + depthOf(f.pointer);
  const idField = differing.filter(f => !TENANT_KEY.test(f.pointer.split('/').slice(0, -1).join('/')) || ID_KEY.test(f.key)).sort((x, y) => rankId(x) - rankId(y))[0];
  if (!idField) return undefined;
  const tenantField = shared
    .filter(f => f.pointer !== idField.pointer && (TENANT_KEY.test(f.key) || (TENANT_KEY.test(f.pointer) && TENANT_LEAF.test(f.key))))
    .sort((x, y) => (/(?:id|slug|key)$/i.test(x.key) ? 0 : 1) - (/(?:id|slug|key)$/i.test(y.key) ? 0 : 1) || depthOf(x.pointer) - depthOf(y.pointer))[0];
  return {
    path,
    idPointer: idField.pointer,
    ...(tenantField ? { tenantPointer: tenantField.pointer } : {}),
    sameTenant: tenantField ? String(tenantField.value) === String(bMap.get(tenantField.pointer)) : true,
    fields: shared.map(f => ({ pointer: f.pointer, a: f.value, b: bMap.get(f.pointer) })),
    confidence: ID_KEY.test(idField.key) ? 'high' : 'medium',
  };
}

const OPAQUE = (v: string) => /^\d{1,19}$/.test(v) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) || /^[0-9a-f]{24,40}$/i.test(v) || /^[A-Za-z0-9_-]{20,40}$/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v);

/** Turns a concrete object URL path into a template: /api/v1/notes/8f2c… → /api/v1/notes/{resource}. */
export function templatePath(path: string): { readPath: string; sampleId: string } | undefined {
  const parts = path.split('/');
  for (let i = parts.length - 1; i > 0; i--) {
    let decoded = parts[i]!; try { decoded = decodeURIComponent(decoded); } catch { /* keep raw */ }
    if (OPAQUE(decoded)) { const copy = [...parts]; copy[i] = '{resource}'; return { readPath: copy.join('/'), sampleId: decoded }; }
  }
  return undefined;
}

const shapeOf = (v: string) => /^\d+$/.test(v) ? 'number' : /^[0-9a-f]{8}-/i.test(v) ? 'uuid' : /^[0-9a-f]+$/i.test(v) ? 'hex' : 'token';
const MARKER_KEYS = ['title', 'name', 'text', 'note', 'notes', 'content', 'body', 'description', 'subject', 'comment', 'message', 'label', 'summary'];
const OWNER_KEY = /(?:owner|user|author|creator|created[_-]?by|account|member|customer)/i;

export interface CreateGuess {
  idResponsePointer: string;
  ownerResponsePointer?: string;
  /** Where the owner field was observed: the creation response or the owner's own read. */
  ownerSource?: 'creation' | 'owner_read';
  tenantResponsePointer?: string;
  markerRequestPointer: string;
  notes: string[];
}

/**
 * Reads one creation request/response made by the owner account and finds where the new ID,
 * the owner and the tenant appear, and which request field can carry the run marker.
 */
export function inferCreate(input: { requestBody: unknown; responseBody: unknown; sampleId?: string; owner: { id: Json; tenant?: Json } }): CreateGuess {
  const notes: string[] = [];
  const response = scalarFields(input.responseBody);
  const wanted = input.sampleId ? shapeOf(input.sampleId) : undefined;
  const ownerId = String(input.owner.id);
  const idCandidates = response.filter(f => String(f.value) !== ownerId && (input.owner.tenant === undefined || String(f.value) !== String(input.owner.tenant)) && OPAQUE(String(f.value)));
  const rank = (f: FieldValue) => (/^(?:id|uuid|guid)$/i.test(f.key) ? 0 : /id$/i.test(f.key) ? 1 : 2) * 100 + (wanted && shapeOf(String(f.value)) === wanted ? 0 : 50) + depthOf(f.pointer);
  const id = idCandidates.sort((a, b) => rank(a) - rank(b))[0];
  if (!id) throw new Error('The creation response does not include an identifier for the new object. Pick the request that returns it, or choose the field manually.');
  const owner = findOwnerPointer(input.responseBody, input.owner.id, id.pointer);
  if (!owner) notes.push('The creation response does not show the owner. ReproCase looks for it in the owner’s own read instead.');
  const tenant = input.owner.tenant === undefined ? undefined : response.find(f => f.pointer !== id.pointer && String(f.value) === String(input.owner.tenant));
  if (!isObject(input.requestBody)) throw new Error('The creation request needs a JSON or form body so ReproCase can place a unique marker in it.');
  const strings = Object.entries(input.requestBody).filter(([k, v]) => typeof v === 'string' && !SECRET_KEY.test(k));
  const marker = strings.sort(([a], [b]) => (MARKER_KEYS.indexOf(a.toLowerCase()) + 1 || 99) - (MARKER_KEYS.indexOf(b.toLowerCase()) + 1 || 99))[0];
  if (!marker) notes.push('No text field was found in the creation body. ReproCase adds a "title" field for the marker; pick another field if the API rejects it.');
  return {
    idResponsePointer: id.pointer,
    ...(owner ? { ownerResponsePointer: owner, ownerSource: 'creation' as const } : {}),
    ...(tenant ? { tenantResponsePointer: tenant.pointer } : {}),
    markerRequestPointer: marker ? `/${escape(marker[0])}` : '/title',
    notes,
  };
}

/** Finds the field whose value equals the owner's live account ID, preferring owner-like keys. */
export function findOwnerPointer(body: unknown, ownerId: Json, exclude?: string): string | undefined {
  const matches = scalarFields(body).filter(f => f.pointer !== exclude && String(f.value) === String(ownerId));
  return matches.sort((a, b) => (OWNER_KEY.test(a.key) ? 0 : 1) - (OWNER_KEY.test(b.key) ? 0 : 1) || depthOf(a.pointer) - depthOf(b.pointer))[0]?.pointer;
}

export interface QuickProofInput {
  title?: string;
  identity: IdentityGuess | { path: string; idPointer: string; tenantPointer?: string; sameTenant: boolean };
  createPath: string;
  createBody: Plain;
  create: CreateGuess;
  /** The vulnerable request path with a concrete ID, or an already templated path. */
  readPath: string;
  csrf?: { path: string; pointer: string; header: string };
  cleanup?: boolean;
  deniedStatuses?: number[];
}

/** Produces guided-authoring input and the resulting case. The policy starts unacknowledged. */
export function buildQuickProof(input: QuickProofInput, caseId?: string) {
  const template = input.readPath.includes('{resource}') ? { readPath: input.readPath } : templatePath(input.readPath);
  if (!template) throw new Error('The vulnerable request has no object ID in its path. Quick Proof currently supports IDs in the URL path.');
  if (!input.create.ownerResponsePointer) throw new Error('Neither the creation response nor the owner’s read shows who owns the object. ReproCase needs an observed owner to prove the object was not already shared.');
  const crossTenant = !!input.identity.tenantPointer && !input.identity.sameTenant;
  const authoring: AuthoringInput = {
    title: input.title?.trim() || `IDOR: ${template.readPath}`,
    policy: crossTenant
      ? 'An object is readable only by its owner. An account in another tenant must be denied.'
      : 'An object is readable only by its owner. Another account must be denied.',
    kind: 'read',
    boundary: crossTenant ? 'cross_tenant' : 'cross_user',
    identityPath: input.identity.path,
    idPointer: input.identity.idPointer,
    ...(input.identity.tenantPointer ? { tenantPointer: input.identity.tenantPointer } : {}),
    createPath: input.createPath,
    createBody: input.createBody as AuthoringInput['createBody'],
    idResponsePointer: input.create.idResponsePointer,
    ownerResponsePointer: input.create.ownerResponsePointer,
    ownershipSource: input.create.ownerSource ?? 'creation',
    ...(input.create.tenantResponsePointer && input.identity.tenantPointer ? { tenantResponsePointer: input.create.tenantResponsePointer } : {}),
    readPath: template.readPath,
    markerRequestPointer: input.create.markerRequestPointer,
    markerMatch: 'anywhere',
    ...(input.csrf ? { csrf: input.csrf } : {}),
    cleanup: input.cleanup ?? true,
    deniedStatuses: input.deniedStatuses ?? [401, 403, 404],
  };
  return { authoring, ...buildCase(authoring, caseId) };
}

export interface ParsedRequest { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; body?: Record<string, unknown>; contentType?: 'json' | 'form' }

/**
 * Reads a pasted request: a raw HTTP request (Burp "Copy to file", DevTools) or a single
 * "METHOD URL" line. Only the method, path and body are kept; headers (including cookies and
 * tokens) are ignored because the bound accounts provide authentication.
 */
export function parseRequest(text: string): ParsedRequest {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const split = normalized.indexOf('\n\n');
  const head = split === -1 ? normalized : normalized.slice(0, split);
  const rawBody = split === -1 ? '' : normalized.slice(split + 2).trim();
  const first = /^([A-Za-z]+)\s+(\S+)(?:\s+HTTP\/\d(?:\.\d)?)?$/.exec(head.split('\n')[0]!.trim());
  if (!first) throw new Error('Paste a request like "GET /api/orders/123 HTTP/1.1" or "GET https://host/api/orders/123".');
  const method = first[1]!.toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error(`Unsupported method ${method}.`);
  let path = first[2]!;
  if (/^https?:\/\//i.test(path)) { const u = new URL(path); path = u.pathname + u.search; }
  if (!path.startsWith('/')) throw new Error('The request target must be a path or an absolute URL.');
  path = path.split('?')[0]!;
  if (!rawBody) return { method: method as ParsedRequest['method'], path };
  try {
    const parsed = JSON.parse(rawBody);
    if (!isObject(parsed)) throw new Error('not an object');
    return { method: method as ParsedRequest['method'], path, body: parsed, contentType: 'json' };
  } catch {
    if (/^[^=\s&]+=[^&\n]*(?:&[^=\s&]+=[^&\n]*)*$/.test(rawBody)) return { method: method as ParsedRequest['method'], path, body: Object.fromEntries(new URLSearchParams(rawBody)), contentType: 'form' };
    throw new Error('The request body must be a JSON object or form fields.');
  }
}

/** Common CSRF token endpoints, tried as the owner only when a creation is rejected for CSRF. */
export const CSRF_PATHS = ['/csrf', '/api/csrf', '/api/v1/csrf', '/csrf-token', '/api/csrf-token', '/api/v1/csrf-token', '/auth/csrf'] as const;
/** Returns the pointer of a CSRF-looking token field in a response. */
export function findCsrfPointer(body: unknown): string | undefined {
  return scalarFields(body, 3, 100, true).find(f => /^(?:csrf|xsrf|_csrf|csrf[_-]?token|xsrf[_-]?token|token)$/i.test(f.key) && typeof f.value === 'string' && f.value.length >= 8)?.pointer;
}
