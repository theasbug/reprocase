import { randomUUID } from 'node:crypto';
import { caseSchema, packageSchema, type CaseSpec, type HttpRequestSpec, type Json, type StepSpec } from './schema.ts';
import { isSecretKey } from './redact.ts';

export type ImportKind = 'har' | 'http' | 'package' | 'burp' | 'postman';
export interface ImportResult { case: CaseSpec; warnings: string[]; redactions: string[]; }
type Plain = Record<string, unknown>;
type RecordedRequest = { url: string; method: string; headers: { name: string; value: string }[]; body?: string; contentType?: 'json' | 'form' | 'multipart' | 'graphql'; actor?: string; response?: unknown };
const LIMIT = 50 * 1024 * 1024;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const ID_KEY = /^(?:id|ids|uuid|guids?|(?:owner|user|tenant|organization|organisation|account|document|project|resource)[_-]?ids?)$/i;
const opaque = (value: string) => /^\d+$/.test(value) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) || /^[0-9a-f]{24,}$/i.test(value);
const object = (value: unknown): value is Plain => !!value && typeof value === 'object' && !Array.isArray(value);
const safeName = (name: string) => name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0,40);
const pointerPart = (part: string) => part.replace(/~/g, '~0').replace(/\//g, '~1');

function harRequests(data: unknown): RecordedRequest[] {
  if (!object(data) || !object(data.log) || !Array.isArray(data.log.entries)) throw new Error('Expected a HAR object with log.entries.');
  return data.log.entries.map((entry, index) => {
    if (!object(entry) || !object(entry.request)) throw new Error(`HAR entry ${index + 1} has no request.`);
    const req = entry.request;
    if (typeof req.url !== 'string' || typeof req.method !== 'string') throw new Error(`HAR entry ${index + 1} requires a URL and method.`);
    const headers = Array.isArray(req.headers) ? req.headers.filter(h => object(h) && typeof h.name === 'string' && typeof h.value === 'string').map(h => ({ name: String(h.name), value: String(h.value) })) : [];
    let response: unknown;
    if (object(entry.response) && object(entry.response.content) && typeof entry.response.content.text === 'string') {
      try { response = JSON.parse(entry.response.content.text); } catch { /* Response text is not reused as executable data. */ }
    }
    const actor = typeof entry.actorId === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(entry.actorId) ? entry.actorId : undefined;
    return { url: req.url, method: req.method.toUpperCase(), headers, body: object(req.postData) && typeof req.postData.text === 'string' ? req.postData.text : undefined, ...(actor ? { actor } : {}), response };
  });
}

function unescapeXml(text: string): string {
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(text.trim());
  if (cdata) return cdata[1]!;
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function burpRequests(xml: string): RecordedRequest[] {
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  if (!items.length) throw new Error('Expected a Burp Suite XML export containing <item> elements.');
  return items.map((match, idx) => {
    const block = match[1]!;
    const urlTag = /<url>([\s\S]*?)<\/url>/i.exec(block);
    const reqTag = /<request(?:\s+base64=["'](true|false)["'])?\s*>([\s\S]*?)<\/request>/i.exec(block);
    if (!reqTag) throw new Error(`Burp item ${idx + 1} has no <request> element.`);
    const reqRaw = reqTag[1]?.toLowerCase() === 'true' ? Buffer.from(unescapeXml(reqTag[2]!).trim(), 'base64').toString('utf8') : unescapeXml(reqTag[2]!);
    const resTag = /<response(?:\s+base64=["'](true|false)["'])?\s*>([\s\S]*?)<\/response>/i.exec(block);
    const resRaw = resTag && resTag[2]?.trim() ? (resTag[1]?.toLowerCase() === 'true' ? Buffer.from(unescapeXml(resTag[2]!).trim(), 'base64').toString('utf8') : unescapeXml(resTag[2]!)) : undefined;
    const parsed = rawRequest(resRaw ? `${reqRaw.replace(/\r?\n$/, '')}\r\n\r\n${resRaw}` : reqRaw)[0]!;
    if (urlTag) {
      const fullUrl = unescapeXml(urlTag[1]!).trim();
      try {
        const u = new URL(fullUrl);
        const p = new URL(parsed.url);
        p.protocol = u.protocol; p.host = u.host;
        parsed.url = p.toString();
      } catch { /* Keep parsed request URL. */ }
    }
    return parsed;
  });
}

function postmanRequests(data: unknown): RecordedRequest[] {
  if (!object(data) || !Array.isArray(data.item)) throw new Error('Expected a Postman Collection v2.1 JSON object with an item array.');
  const results: RecordedRequest[] = [];
  const walkItems = (items: unknown[]) => {
    for (const item of items) {
      if (!object(item)) continue;
      if (Array.isArray(item.item)) { walkItems(item.item); continue; }
      if (!object(item.request)) continue;
      const req = item.request;
      const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET';
      let rawUrl = '';
      if (typeof req.url === 'string') rawUrl = req.url;
      else if (object(req.url) && typeof req.url.raw === 'string') rawUrl = req.url.raw;
      else if (object(req.url)) {
        const host = Array.isArray(req.url.host) ? req.url.host.join('.') : String(req.url.host ?? 'api.example.com');
        const path = Array.isArray(req.url.path) ? '/' + req.url.path.join('/') : String(req.url.path ?? '/');
        rawUrl = `https://${host}${path.startsWith('/') ? path : '/' + path}`;
      }
      rawUrl = rawUrl.replace(/^\{\{[^}]+\}\}/, 'https://api.example.com').replace(/\{\{([^}]+)\}\}/g, '00000000-0000-0000-0000-000000000001');
      if (!/^https?:\/\//i.test(rawUrl)) rawUrl = `https://${rawUrl.replace(/^\/+/, '')}`;
      const headers = Array.isArray(req.header) ? req.header.filter(h => object(h) && !h.disabled && typeof h.key === 'string' && typeof h.value === 'string').map(h => ({ name: String(h.key), value: String(h.value) })) : [];
      let body: string | undefined;
      let contentType: RecordedRequest['contentType'];
      if (object(req.body)) {
        if (req.body.mode === 'raw' && typeof req.body.raw === 'string') body = req.body.raw;
        else if (req.body.mode === 'graphql' && object(req.body.graphql)) { body = JSON.stringify(req.body.graphql); contentType = 'graphql'; }
        else if (req.body.mode === 'urlencoded' && Array.isArray(req.body.urlencoded)) {
          const formObj: Record<string, string> = {};
          for (const entry of req.body.urlencoded) if (object(entry) && !entry.disabled && typeof entry.key === 'string') formObj[entry.key] = String(entry.value ?? '');
          body = JSON.stringify(formObj);
          contentType = 'form';
        }
      }
      let response: unknown;
      if (Array.isArray(item.response) && object(item.response[0]) && typeof item.response[0].body === 'string') {
        try { response = JSON.parse(item.response[0].body); } catch { /* Ignore non-JSON example response. */ }
      }
      results.push({ url: rawUrl, method, headers, body, ...(contentType ? { contentType } : {}), response });
    }
  };
  walkItems(data.item);
  if (!results.length) throw new Error('The Postman collection contains no requests.');
  return results;
}

function rawRequest(data: string): RecordedRequest[] {
  const responseStart = /\r?\n\r?\n(?=HTTP\/\d(?:\.\d)?\s+\d{3})/.exec(data);
  const requestPart = responseStart ? data.slice(0, responseStart.index) : data;
  const responsePart = responseStart ? data.slice(responseStart.index + responseStart[0].length) : undefined;
  const split = /\r?\n\r?\n/.exec(requestPart);
  const headerText = split ? requestPart.slice(0, split.index) : requestPart;
  const body = split ? requestPart.slice(split.index + split[0].length) : undefined;
  const lines = headerText.split(/\r?\n/);
  const first = /^([A-Za-z]+)\s+(\S+)\s+HTTP\/\d(?:\.\d)?$/.exec((lines.shift() ?? '').trim());
  if (!first) throw new Error('Expected a raw HTTP request line, for example GET /documents/123 HTTP/1.1.');
  const headers = lines.map(line => { const colon = line.indexOf(':'); return { name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim(), valid: colon > 0 }; }).filter(h => h.valid).map(({ name, value }) => ({ name, value }));
  const host = headers.find(h => h.name.toLowerCase() === 'host')?.value;
  if (!/^https?:\/\//i.test(first[2]) && !host) throw new Error('A relative request target requires a Host header.');
  const url = /^https?:\/\//i.test(first[2]) ? first[2] : `https://${host}${first[2]}`;
  let response: unknown;
  if (responsePart) {
    const responseBody = responsePart.split(/\r?\n\r?\n/).slice(1).join('\n\n');
    try { response = JSON.parse(responseBody); } catch { /* Evidence is not used as future request literals. */ }
  }
  return [{ url, method: first[1].toUpperCase(), headers, body, response }];
}

/** Importing creates a draft only. It never fetches a URL or executes a command. */
export function importTraffic(kind: ImportKind, data: string): ImportResult {
  if (Buffer.byteLength(data, 'utf8') > LIMIT) throw new Error('Import is limited to 50 MiB. Select only the traffic relevant to this case.');
  if (kind === 'package') {
    const pack = packageSchema.parse(JSON.parse(data));
    return { case: pack.case, warnings: ['Imported evidence is a historical observation. Connect your own accounts and run the case to obtain a new verdict.'], redactions: pack.redactions };
  }
  const source = kind === 'har' ? harRequests(JSON.parse(data)) : kind === 'burp' ? burpRequests(data) : kind === 'postman' ? postmanRequests(JSON.parse(data)) : rawRequest(data);
  if (!source.length) throw new Error('The capture contains no HTTP requests.');
  if (source.length > 200) throw new Error('A case supports at most 200 requests. Export a smaller selection.');
  const warnings = new Set<string>([
    'This is an unapproved draft. Review actor assignment, identity probes, resource ownership, and the success/rejection conditions before running.',
    'Source response values are not trusted as future evidence. Captures extract fresh values from the new run.',
  ]);
  const redactions = new Set<string>();
  const originNames = new Map<string, string>();
  const authActors = new Map<string, string>();
  const captured = new Map<string, Set<string>>();
  let unknown = 0;
  const freshRef = (prefix: string): Json => ({ $ref: `captures.${prefix}${++unknown}` });
  const valueKey = (origin: string, value: unknown) => `${origin}\u0000${typeof value}:${String(value)}`;
  const rebind = (value: string | number, origin: string, label: string): Json => {
    const found = captured.get(valueKey(origin, value));
    if (found?.size === 1) return { $ref: [...found][0] };
    warnings.add(found && found.size > 1 ? 'An identifier has multiple possible producers. Choose its fresh binding explicitly.' : 'Some source identifiers have no observed producer. Bind each importedId placeholder to fresh setup output before running.');
    return freshRef(label);
  };
  const cleanBody = (value: unknown, origin: string, field = ''): Json => {
    if (value === null || typeof value === 'boolean') return value;
    if (isSecretKey(field)) { redactions.add(`Body field ${field} replaced with a fresh binding`); return freshRef('freshCredential'); }
    if (typeof value === 'string' || typeof value === 'number') {
      if (/^(?:marker|canary|reprocase[_-]?marker)$/i.test(field)) { warnings.add('A recorded marker field was rebound to a fresh run marker. Review that this is a safe controlled field.'); return { $ref: 'run.marker' }; }
      if (ID_KEY.test(field) || (typeof value === 'string' && opaque(value))) return rebind(value, origin, 'importedId');
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) { warnings.add('An embedded URL requires an explicit fresh binding.'); return freshRef('importedUrl'); }
      return value;
    }
    if (Array.isArray(value)) return value.map(item => cleanBody(item, origin, field));
    if (object(value)) {
      if (Object.hasOwn(value, '$ref')) { warnings.add('A reserved $ref object in captured business data was omitted. Review this body manually.'); return '[REVIEW RESERVED OBJECT]'; }
      const result: Record<string, Json> = Object.create(null) as Record<string, Json>;
      for (const [key, item] of Object.entries(value)) result[key] = cleanBody(item, origin, key);
      return result;
    }
    return null;
  };

  const resources: CaseSpec['resources'] = [];
  const steps: StepSpec[] = source.map((record, index) => {
    if (!METHODS.has(record.method)) throw new Error(`Unsupported HTTP method at request ${index + 1}.`);
    const url = new URL(record.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) targets can be imported.');
    if (url.username || url.password) redactions.add('URL credentials removed');
    let origin = originNames.get(url.origin);
    if (!origin) { origin = originNames.size === 0 ? 'api' : `api${originNames.size + 1}`; originNames.set(url.origin, origin); }
    const stepId = `step${index + 1}`;
    const sourceAuth = record.headers.filter(h => /^(?:authorization|cookie)$/i.test(h.name)).map(h => `${h.name.toLowerCase()}:${h.value}`).join('|');
    let actor = record.actor ?? 'owner';
    if (!record.actor) {
      if (sourceAuth) {
        actor = authActors.get(sourceAuth) ?? (authActors.size === 0 ? 'owner' : 'researcher');
        authActors.set(sourceAuth, actor);
        if (authActors.size > 2) warnings.add('The capture contains more than two authentication variants. Review actor assignments; token rotation can look like a different account.');
      } else if (index === source.length - 1) { actor = 'researcher'; warnings.add('Some requests have no authentication information; their actor assignment must be reviewed.'); }
    }
    const pathParams: Record<string, Json> = Object.create(null) as Record<string, Json>;
    let pathIndex = 0;
    const path = url.pathname.split('/').map(segment => {
      let decoded = segment; try { decoded = decodeURIComponent(segment); } catch { /* Keep malformed paths for manual review. */ }
      if (!opaque(decoded)) return segment;
      const name = `id${++pathIndex}`;
      pathParams[name] = rebind(/^\d+$/.test(decoded) ? Number(decoded) : decoded, origin, 'importedId');
      // HAR URLs stringify numeric identifiers; allow either typed capture representation.
      if (object(pathParams[name]) && String((pathParams[name] as Plain).$ref).includes('importedId')) {
        const alternative = captured.get(valueKey(origin, decoded));
        if (alternative?.size === 1) pathParams[name] = { $ref: [...alternative][0] };
      }
      return `{${name}}`;
    }).join('/');
    const query: Record<string, Json> = Object.create(null) as Record<string, Json>;
    for (const [name, value] of url.searchParams) {
      if (Object.hasOwn(query, name)) warnings.add('Repeated query parameters were normalized; review requests whose behavior depends on duplicates.');
      if (isSecretKey(name)) { redactions.add(`Query field ${name} replaced with a fresh binding`); query[name] = freshRef('freshCredential'); }
      else if (ID_KEY.test(name) || opaque(value)) query[name] = rebind(value, origin, 'importedId');
      else query[name] = value;
    }
    const headers: Record<string, Json> = Object.create(null) as Record<string, Json>;
    for (const header of record.headers) {
      const name = header.name.toLowerCase();
      if (/^(?:authorization|proxy-authorization|cookie|set-cookie)$/i.test(name)) { redactions.add(`${name} header removed; connect your own account`); continue; }
      if (/^(?:host|content-length|connection|transfer-encoding|origin|referer|accept-encoding|user-agent)$/i.test(name)) continue;
      if (isSecretKey(name)) { redactions.add(`${name} header replaced with a fresh binding`); headers[name] = rebind(header.value, origin, `fresh_${safeName(name)}`); }
      else if (/https?:\/\//i.test(header.value)) { warnings.add('A header containing an absolute URL was omitted. Rebuild it for the selected target if required.'); }
      else headers[name] = header.value;
    }
    let body: Json | undefined;
    let contentType = record.contentType;
    if (record.body?.trim()) {
      try {
        const parsedBody = JSON.parse(record.body);
        body = cleanBody(parsedBody, origin);
        if (!contentType && object(parsedBody) && typeof parsedBody.query === 'string' && /query|mutation/i.test(parsedBody.query)) contentType = 'graphql';
      } catch {
        const isFormHeader = record.headers.some(h => h.name.toLowerCase() === 'content-type' && /x-www-form-urlencoded/i.test(h.value));
        if (isFormHeader && /^[^=\s&]+=[^&\r\n]*(?:&[^=\s&]+=[^&\r\n]*)*$/.test(record.body.trim())) {
          const params = new URLSearchParams(record.body.trim());
          const formObj: Record<string, string> = {};
          for (const [k, v] of params) formObj[k] = v;
          body = cleanBody(formObj, origin);
          contentType = 'form';
        } else {
          body = '[REVIEW BODY: non-JSON payload omitted]';
          warnings.add('Non-JSON request bodies are omitted in this HTTP/JSON release. Rebuild the selected payload manually.');
        }
      }
    }
    const request: HttpRequestSpec = { actor, origin, method: record.method as HttpRequestSpec['method'], path, pathParams, query, headers, ...(contentType ? { contentType } : {}), ...(body === undefined ? {} : { body }) };
    const step: StepSpec = { id: stepId, label: `${record.method} ${path}`, phase: index === source.length - 1 ? 'probe' : 'prepare', effect: ['GET', 'HEAD', 'OPTIONS'].includes(record.method) ? 'read' : 'write', request, captures: [], checks: [] };
    // Discover producer locations without retaining the captured source value.
    const responseFields: Record<string, string> = Object.create(null) as Record<string, string>;
    const walk = (value: unknown, pointer: string, field: string) => {
      if ((typeof value === 'string' || typeof value === 'number') && (ID_KEY.test(field) || /^(?:csrf|xsrf)(?:[_-]?token)?$/i.test(field))) {
        const captureName = `${stepId}_${safeName(field)}`;
        if (step.captures.some(c => c.name === captureName)) return;
        step.captures.push({ name: captureName, from: 'body', pointer });
        responseFields[field.toLowerCase().replace(/[_-]/g, '')] = `captures.${captureName}`;
        const key = valueKey(origin, value);
        const choices = captured.get(key) ?? new Set<string>(); choices.add(`captures.${captureName}`); captured.set(key, choices);
      } else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${pointer}/${i}`, field));
      else if (object(value)) for (const [key, item] of Object.entries(value)) walk(item, `${pointer}/${pointerPart(key)}`, key);
    };
    walk(record.response, '', '');
    if (step.phase === 'prepare' && record.method === 'POST' && responseFields.id && responseFields.ownerid) {
      resources.push({ id: `resource${resources.length + 1}`, label: `Prepared resource ${resources.length + 1}`, ownerActor: actor, createdBy: stepId, idRef: responseFields.id, ownerRef: responseFields.ownerid, ...(responseFields.tenant ? { tenantRef: responseFields.tenant } : {}) });
    }
    return step;
  });
  if (!resources.length) warnings.add('Define a fresh resource producer and observed ownership before relying on this draft for a fresh-account reproduction.');
  const probe = steps.at(-1)!;
  const spec = caseSchema.parse({
    schemaVersion: 1, id: `import-${randomUUID()}`, revision: 1,
    title: `Imported HTTP case (${steps.length} request${steps.length === 1 ? '' : 's'})`,
    description: 'Draft reconstructed from selected traffic. Source credentials, target origins, and recognized source identifiers have been removed. Review the inferred bindings.',
    policy: { statement: 'Describe the intended access boundary and confirm that these test accounts should not have access to each other’s private resources.', acknowledged: false },
    actors: [
      { id: 'owner', label: 'Resource owner', color: '#4fd1c5', identity: { origin: 'api', path: '/me', idPointer: '/id', tenantPointer: '/tenant', rolePointer: '/role' } },
      { id: 'researcher', label: 'Researcher', color: '#b794f4', identity: { origin: 'api', path: '/me', idPointer: '/id', tenantPointer: '/tenant', rolePointer: '/role' } },
    ],
    origins: [...originNames.values()].map((id, i) => ({ id, label: `API ${i + 1}` })),
    preconditions: [{ id: 'distinct-identities', label: 'The accounts represent different users', op: 'neq', left: { $ref: 'actors.owner.id' }, right: { $ref: 'actors.researcher.id' } }],
    resources, steps,
    witness: {
      success: [{ id: 'private-content-observed', label: 'The researcher receives the new run’s private marker (review pointer)', op: 'eq', left: { $ref: `steps.${probe.id}.body.marker` }, right: { $ref: 'run.marker' } }],
      rejection: [{ id: 'access-denied', label: 'The service explicitly denies the request', op: 'in', left: { $ref: `steps.${probe.id}.status` }, right: [403, 404] }],
    },
  });
  return { case: spec, warnings: [...warnings], redactions: [...redactions] };
}

export function importMultiActorTraffic(sessions: { actorId: string; entries: unknown[] }[]): ImportResult {
  const merged = sessions.flatMap(session =>
    session.entries.filter(object).map(entry => ({ ...entry, actorId: session.actorId }) as Plain),
  ).sort((a, b) => String(a.startedDateTime ?? '').localeCompare(String(b.startedDateTime ?? '')));
  if (!merged.length) throw new Error('No recorded traffic entries are available across the connected actors.');
  return importTraffic('har', JSON.stringify({ log: { version: '1.2', entries: merged } }));
}
