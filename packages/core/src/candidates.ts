/**
 * IDOR candidate discovery from external tool output (Arjun, ffuf).
 *
 * Parsing is offline: nothing here sends a request. A candidate is a lead, not a finding.
 * Each candidate carries a raw HTTP request draft that the regular "http" importer turns
 * into a reviewable case. Captured headers (cookies, tokens) are never carried over.
 */

export type CandidateKind = 'arjun' | 'ffuf';

export interface IdorCandidate {
  /** Stable index within this result, starting at 1. */
  index: number;
  source: CandidateKind;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  /** Parameter names discovered by the tool (Arjun) or present in the URL query. */
  params: string[];
  /** HTTP status reported by the tool, when available (ffuf). */
  status?: number;
  /** Higher means more identifier-like signals. 0 means no signal was found. */
  score: number;
  reasons: string[];
  /** Raw HTTP request for the "http" importer. Contains no captured credentials. */
  raw: string;
}

export interface CandidateResult { candidates: IdorCandidate[]; total: number; warnings: string[] }

type Plain = Record<string, unknown>;
const object = (value: unknown): value is Plain => !!value && typeof value === 'object' && !Array.isArray(value);
const LIMIT = 50 * 1024 * 1024;
const MAX_CANDIDATES = 500;

/** Parameter names that usually reference an object owned by someone. */
const ID_PARAM = /^(?:id|ids|uuid|guid|oid|pk|key|ref|(?:[a-z]+[_-]?)?(?:id|ids|uuid|guid|no|num|number))$/i;
const OWNER_PARAM = /(?:user|owner|account|customer|member|profile|tenant|org|organi[sz]ation|team|workspace|project|document|doc|file|invoice|order|report|ticket|message)/i;
const OPAQUE_SEGMENT = (value: string) => /^\d{1,19}$/.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || /^[0-9a-f]{24}$/i.test(value);
const RESOURCE_WORD = /^(?:users?|accounts?|customers?|members?|profiles?|tenants?|orgs?|organi[sz]ations?|teams?|workspaces?|projects?|documents?|docs?|files?|invoices?|orders?|reports?|tickets?|messages?|items?|records?|objects?)$/i;

function score(url: URL, params: string[], extra: string[] = []): { score: number; reasons: string[] } {
  const reasons: string[] = [...extra];
  let total = extra.length;
  const segments = url.pathname.split('/').filter(Boolean);
  segments.forEach((segment, i) => {
    let decoded = segment; try { decoded = decodeURIComponent(segment); } catch { /* Keep the raw segment. */ }
    if (OPAQUE_SEGMENT(decoded)) {
      const previous = segments[i - 1] ?? '';
      total += RESOURCE_WORD.test(previous) ? 3 : 2;
      reasons.push(RESOURCE_WORD.test(previous) ? `Object ID in path after /${previous}/` : 'Identifier-like path segment');
    }
  });
  for (const name of new Set(params)) {
    if (ID_PARAM.test(name)) { total += OWNER_PARAM.test(name) ? 3 : 2; reasons.push(`Identifier parameter "${name}"`); }
    else if (OWNER_PARAM.test(name)) { total += 1; reasons.push(`Ownership-related parameter "${name}"`); }
  }
  return { score: total, reasons };
}

/** Builds a credential-free raw request. ID-like values become "1" so the importer rebinds them. */
function rawRequest(method: IdorCandidate['method'], url: URL, params: string[], bodyStyle: 'query' | 'form' | 'json'): string {
  const value = (name: string) => (ID_PARAM.test(name) ? '1' : 'REVIEW');
  const target = new URL(url.href);
  target.username = ''; target.password = ''; target.hash = '';
  let body = '';
  const headers = [`Host: ${target.host}`, 'Accept: application/json'];
  if (bodyStyle === 'query') for (const name of params) if (!target.searchParams.has(name)) target.searchParams.set(name, value(name));
  if (bodyStyle === 'form') { body = new URLSearchParams(params.map(name => [name, value(name)])).toString(); headers.push('Content-Type: application/x-www-form-urlencoded'); }
  if (bodyStyle === 'json') { body = JSON.stringify(Object.fromEntries(params.map(name => [name, ID_PARAM.test(name) ? 1 : 'REVIEW']))); headers.push('Content-Type: application/json'); }
  return `${method} ${target.pathname}${target.search} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n${body}`;
}

function parseUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value.trim()); return ['http:', 'https:'].includes(url.protocol) ? url : undefined; } catch { return undefined; }
}

function arjun(data: unknown, warnings: Set<string>): Omit<IdorCandidate, 'index'>[] {
  if (!object(data)) throw new Error('Expected Arjun JSON output (arjun -oJ): an object keyed by URL.');
  const out: Omit<IdorCandidate, 'index'>[] = [];
  for (const [key, entry] of Object.entries(data)) {
    const url = parseUrl(key);
    if (!url || !object(entry)) { warnings.add('Some Arjun entries were skipped because they had no valid HTTP(S) URL.'); continue; }
    const params = Array.isArray(entry.params) ? entry.params.filter((p): p is string => typeof p === 'string' && /^[\w.\-[\]]{1,100}$/.test(p)) : [];
    const toolMethod = typeof entry.method === 'string' ? entry.method.toUpperCase() : 'GET';
    if (object(entry.headers) && Object.keys(entry.headers).some(h => /^(?:cookie|authorization)$/i.test(h))) warnings.add('Captured Cookie/Authorization headers were not copied. Connect your own test accounts in ReproCase.');
    const [method, style]: [IdorCandidate['method'], 'query' | 'form' | 'json'] = toolMethod === 'JSON' ? ['POST', 'json'] : toolMethod === 'POST' || toolMethod === 'XML' ? ['POST', 'form'] : ['GET', 'query'];
    if (toolMethod === 'XML') warnings.add('Arjun XML-mode results are drafted as form requests. Rebuild the XML body manually.');
    const signal = score(url, [...params, ...url.searchParams.keys()]);
    out.push({ source: 'arjun', method, url: url.href, params, ...signal, raw: rawRequest(method, url, params, style) });
  }
  return out;
}

function ffuf(data: unknown, warnings: Set<string>): Omit<IdorCandidate, 'index'>[] {
  if (!object(data) || !Array.isArray(data.results)) throw new Error('Expected ffuf JSON output (ffuf -of json): an object with a results array.');
  const configMethod = object(data.config) && typeof data.config.method === 'string' ? data.config.method.toUpperCase() : 'GET';
  const method = (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(configMethod) ? configMethod : 'GET') as IdorCandidate['method'];
  if (method !== 'GET') warnings.add(`ffuf ran with ${method}. Request bodies are not included in ffuf output; rebuild them manually.`);
  const seen = new Set<string>();
  const out: Omit<IdorCandidate, 'index'>[] = [];
  for (const result of data.results) {
    if (!object(result)) continue;
    const url = parseUrl(result.url);
    if (!url) { warnings.add('Some ffuf results were skipped because they had no valid HTTP(S) URL.'); continue; }
    const status = typeof result.status === 'number' ? result.status : undefined;
    const key = `${method} ${url.origin}${url.pathname.replace(/\/(?:\d{1,19}|[0-9a-f-]{24,36})(?=\/|$)/gi, '/{id}')}?${[...url.searchParams.keys()].sort().join('&')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const extra: string[] = [];
    const inputs = object(result.input) ? Object.values(result.input).filter((v): v is string => typeof v === 'string') : [];
    if (inputs.some(v => OPAQUE_SEGMENT(v)) && status !== undefined && status >= 200 && status < 300) extra.push('Fuzzed identifier returned a 2xx response');
    const params = [...url.searchParams.keys()];
    const signal = score(url, params, extra);
    out.push({ source: 'ffuf', method, url: url.href, params, ...(status === undefined ? {} : { status }), ...signal, raw: rawRequest(method, url, [], 'query') });
  }
  if (data.results.length > out.length) warnings.add('ffuf results that differ only by an identifier value were grouped into one candidate.');
  return out;
}

/** Parses Arjun or ffuf JSON into ranked IDOR candidates. Never sends a request. */
export function parseCandidates(kind: CandidateKind, data: string): CandidateResult {
  if (Buffer.byteLength(data, 'utf8') > LIMIT) throw new Error('Candidate import is limited to 50 MiB.');
  let parsed: unknown;
  try { parsed = JSON.parse(data); } catch { throw new Error(kind === 'arjun' ? 'Arjun output must be JSON. Run Arjun with -oJ <file>.' : 'ffuf output must be JSON. Run ffuf with -of json -o <file>.'); }
  const warnings = new Set<string>(['Candidates are leads, not findings. A draft becomes evidence only after a run with your own accounts.']);
  const found = kind === 'arjun' ? arjun(parsed, warnings) : ffuf(parsed, warnings);
  const ranked = found.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  if (ranked.length > MAX_CANDIDATES) warnings.add(`Showing the top ${MAX_CANDIDATES} of ${ranked.length} candidates.`);
  return { candidates: ranked.slice(0, MAX_CANDIDATES).map((c, i) => ({ index: i + 1, ...c })), total: ranked.length, warnings: [...warnings] };
}
