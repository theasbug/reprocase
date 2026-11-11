import { ScanNetwork, readResponseText, type ScanOptions } from './network.ts';
import { buildCase } from './authoring.ts';
import { createRedactor } from './redact.ts';
import type { CaseSpec, HttpRequestSpec } from './schema.ts';
import { targetOrigin } from './values.ts';

export type HttpMethod = HttpRequestSpec['method'];

export type VulnCategory =
  | 'idor_bola'
  | 'bfla_privesc'
  | 'race_condition'
  | 'ssrf_redirect'
  | 'graphql'
  | 'info_disclosure';

export interface ReconEndpoint {
  id: string;
  method: HttpMethod;
  path: string;
  parameters: string[];
  risk: 'high' | 'medium' | 'low';
  categories: VulnCategory[];
  rationale: string;
  source: string;
}

export interface ReconFinding {
  id: string;
  severity: 'high' | 'medium' | 'low' | 'info';
  title: string;
  category: string;
  evidence: string;
  remediation: string;
}

export interface ReconReport {
  origin: string;
  scannedAt: string;
  technologies: string[];
  probedPaths: Array<{ path: string; status: number; contentType: string; size: number }>;
  state: 'completed' | 'inconclusive';
  errors: Array<{path:string;message:string}>;
  securityFindings: ReconFinding[];
  endpoints: ReconEndpoint[];
}

const IDOR_PARAM_REGEX = /(?:^|_|-)(?:id|uid|user_?id|account_?id|tenant_?id|org_?id|doc_?id|document_?id|project_?id|invoice_?id|order_?id|member_?id|file_?id)$/i;
const BFLA_PATH_REGEX = /\/(?:admin|internal|manage|roles|permissions|users|staff|billing|orgs|tenants|settings|config|debug|actuator)\b/i;
const RACE_PATH_REGEX = /\/(?:redeem|coupon|transfer|withdraw|checkout|pay|vote|invite|claim|mint|documents|tokens|credit)\b/i;
const SSRF_PARAM_REGEX = /(?:^|_|-)(?:url|uri|webhook|callback|redirect|redirect_uri|return_?url|next|dest|destination|target| proxy|fetch)$/i;

function classifyEndpoint(method: HttpMethod, rawPath: string, params: string[], source: string): ReconEndpoint {
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const allParams = new Set<string>(params);
  for (const match of path.matchAll(/\{([a-zA-Z0-9_-]+)\}|:([a-zA-Z0-9_-]+)/g)) {
    allParams.add(match[1] ?? match[2]);
  }
  const hasNumericOrUuidSegment = /\/(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i.test(path);
  if (hasNumericOrUuidSegment) allParams.add('id');

  const querySplit = path.split('?');
  const cleanPath = querySplit[0];
  if (querySplit[1]) {
    for (const pair of querySplit[1].split('&')) {
      const key = pair.split('=')[0]?.trim();
      if (key) allParams.add(key);
    }
  }

  const paramList = [...allParams];
  const categories: VulnCategory[] = [];
  const reasons: string[] = [];

  if (/graphql/i.test(cleanPath)) {
    categories.push('graphql');
    reasons.push('GraphQL endpoint supports query/mutation batching and object-level field resolution.');
  }
  if (hasNumericOrUuidSegment || paramList.some(p => IDOR_PARAM_REGEX.test(p)) || /\/(?:documents|files|orders|invoices|messages|projects|accounts|users)\b/i.test(cleanPath)) {
    categories.push('idor_bola');
    reasons.push('References object/account identifiers suitable for cross-actor BOLA/IDOR verification.');
  }
  if (BFLA_PATH_REGEX.test(cleanPath) || paramList.some(p => /^(?:role|is_?admin|permissions|scope|tenant)$/i.test(p))) {
    categories.push('bfla_privesc');
    reasons.push('Touches administrative, tenant, or role-scoped functionality (BFLA / Privilege Escalation).');
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && (RACE_PATH_REGEX.test(cleanPath) || categories.includes('idor_bola'))) {
    categories.push('race_condition');
    reasons.push(`State-mutating ${method} route can be tested with parallel barrier concurrency for race conditions.`);
  }
  if (paramList.some(p => SSRF_PARAM_REGEX.test(p))) {
    categories.push('ssrf_redirect');
    reasons.push('Accepts URL/redirect/webhook parameter suitable for SSRF or open redirect checks.');
  }
  if (!categories.length) {
    categories.push('info_disclosure');
    reasons.push('General application endpoint discovered during reconnaissance.');
  }

  const risk: 'high' | 'medium' | 'low' =
    categories.includes('idor_bola') || categories.includes('bfla_privesc') || (categories.includes('race_condition') && RACE_PATH_REGEX.test(cleanPath))
      ? 'high'
      : categories.includes('graphql') || categories.includes('ssrf_redirect') || categories.includes('race_condition')
        ? 'medium'
        : 'low';

  return {
    id: `${method.toLowerCase()}-${cleanPath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'root'}`,
    method,
    path: cleanPath,
    parameters: paramList,
    risk,
    categories,
    rationale: reasons.join(' '),
    source,
  };
}

export function extractEndpointsFromText(sourceText: string, sourceLabel = 'manual'): ReconEndpoint[] {
  const map = new Map<string, ReconEndpoint>();
  const add = (method: HttpMethod, path: string, params: string[] = [], src = sourceLabel) => {
    if (!path || path.startsWith('//') || /\.(?:png|jpg|jpeg|gif|svg|woff2?|ttf|eot|css|ico)$/i.test(path)) return;
    const item = classifyEndpoint(method, path, params, src);
    const key = `${item.method}:${item.path}`;
    const existing = map.get(key);
    if (existing) {
      const mergedParams = [...new Set([...existing.parameters, ...item.parameters])];
      map.set(key, classifyEndpoint(method, item.path, mergedParams, existing.source));
    } else {
      map.set(key, item);
    }
  };

  // Try parsing as JSON (OpenAPI / Swagger / HAR / Postman)
  const trimmed = sourceText.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, any>;
      if (parsed.paths && typeof parsed.paths === 'object') {
        for (const [routePath, methodsObj] of Object.entries(parsed.paths)) {
          if (!methodsObj || typeof methodsObj !== 'object') continue;
          for (const [m, details] of Object.entries(methodsObj as Record<string, any>)) {
            const upper = m.toUpperCase();
            if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(upper)) {
              const params: string[] = [];
              if (Array.isArray(details?.parameters)) {
                for (const p of details.parameters) if (typeof p?.name === 'string') params.push(p.name);
              }
              add(upper as HttpMethod, routePath, params, 'openapi');
            }
          }
        }
      }
      if (Array.isArray(parsed.log?.entries)) {
        for (const entry of parsed.log.entries) {
          const req = entry?.request;
          if (!req?.url) continue;
          try {
            const u = new URL(req.url);
            const method = (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(String(req.method).toUpperCase())
              ? String(req.method).toUpperCase()
              : 'GET') as HttpMethod;
            const params = [...u.searchParams.keys()];
            add(method, u.pathname, params, 'har');
          } catch { /* ignore invalid URLs */ }
        }
      }
    } catch { /* Fallback to regex extraction */ }
  }

  // Extract explicit HTTP lines: GET /api/v1/users/123
  for (const match of sourceText.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;={}-]+)/g)) {
    add(match[1] as HttpMethod, match[2], [], sourceLabel);
  }

  // Extract fetch / axios / API calls in JS bundles: axios.post('/api/...') or fetch('/api/...', { method: 'POST' })
  for (const match of sourceText.matchAll(/\b(?:axios|api|client|http)\.(get|post|put|patch|delete)\s*\(\s*['"`](\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;={}-]+)['"`]/gi)) {
    add(match[1].toUpperCase() as HttpMethod, match[2], [], sourceLabel);
  }

  // Extract quoted API-like paths from JS/HTML/robots.txt
  for (const match of sourceText.matchAll(/(?:['"`]|Disallow:\s*|Allow:\s*)(\/(?:api|v\d+|graphql|auth|admin|users|documents|orgs|tenants|projects|files|orders|invoices|settings|internal|account|webhooks)[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;={}-]*)/gi)) {
    const cleaned = match[1].replace(/['"`\s]+$/g, '');
    const defaultMethod: HttpMethod = /\/(?:login|register|graphql|redeem|transfer|create|upload)\b/i.test(cleaned) ? 'POST' : 'GET';
    add(defaultMethod, cleaned, [], sourceLabel);
  }

  const riskOrder = { high: 0, medium: 1, low: 2 };
  return [...map.values()].sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk] || a.path.localeCompare(b.path));
}

export async function probeOrigin(
  originInput: string,
  fetcher: typeof fetch = fetch,
  secrets: string[] = [],
  options: ScanOptions = {},
): Promise<ReconReport> {
  const origin = targetOrigin(originInput);
  const redactor = createRedactor(secrets);
  const network=options.network??new ScanNetwork(fetcher,options);
  const errors: ReconReport['errors']=[];
  const discoveryPaths = ['/', '/robots.txt', '/.well-known/security.txt', '/openapi.json', '/swagger.json', '/graphql'];
  const probedPaths: ReconReport['probedPaths'] = [];
  const technologies = new Set<string>();
  const securityFindings: ReconFinding[] = [];
  const collectedEndpoints: ReconEndpoint[] = [];

  for (const path of discoveryPaths) {
    try {
      const response = await network.request(`${origin}${path}`, {
        method: 'GET',
        headers: {
          accept: 'application/json, text/plain, text/html, */*',
          ...(path === '/' ? { Origin: 'https://recon-check.example' } : {}),
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      const text = redactor.text(await readResponseText(response));
      const contentType = response.headers.get('content-type') ?? '';
      probedPaths.push({ path, status: response.status, contentType, size: text.length });

      const serverHeader = response.headers.get('server');
      const poweredBy = response.headers.get('x-powered-by');
      if (serverHeader) technologies.add(`Server: ${serverHeader}`);
      if (poweredBy) technologies.add(`X-Powered-By: ${poweredBy}`);

      if (path === '/') {
        if (!response.headers.get('content-security-policy')) {
          securityFindings.push({
            id: 'missing-csp',
            severity: 'low',
            title: 'Missing Content-Security-Policy (CSP) header',
            category: 'Security Headers',
            evidence: `GET ${origin}/ returned status ${response.status} without a Content-Security-Policy header.`,
            remediation: 'Define a restrictive Content-Security-Policy header to mitigate XSS and data injection risks.',
          });
        }
        if (origin.startsWith('https://') && !response.headers.get('strict-transport-security')) {
          securityFindings.push({
            id: 'missing-hsts',
            severity: 'low',
            title: 'Missing Strict-Transport-Security (HSTS) header',
            category: 'Security Headers',
            evidence: `HTTPS origin ${origin} did not return a Strict-Transport-Security header.`,
            remediation: 'Add Strict-Transport-Security: max-age=31536000; includeSubDomains.',
          });
        }
        const acao = response.headers.get('access-control-allow-origin');
        const acac = response.headers.get('access-control-allow-credentials');
        if (acao === '*' && acac === 'true') {
          securityFindings.push({
            id: 'cors-wildcard-credentials',
            severity: 'high',
            title: 'Misconfigured CORS with Credentials',
            category: 'CORS',
            evidence: `Access-Control-Allow-Origin: ${acao} combined with Access-Control-Allow-Credentials: true`,
            remediation: 'Restrict Access-Control-Allow-Origin to trusted origins and avoid reflecting untrusted Origins with credentials.',
          });
        } else if (acao === 'https://recon-check.example') {
          securityFindings.push({
            id: 'cors-origin-reflection',
            severity: acac === 'true' ? 'high' : 'medium',
            title: 'Arbitrary Origin Reflected in CORS Header',
            category: 'CORS',
            evidence: `Origin https://recon-check.example was reflected in Access-Control-Allow-Origin (${acac === 'true' ? 'with credentials' : 'without credentials'}).`,
            remediation: 'Validate the Origin header against a strict allowlist before reflecting it.',
          });
        }
        if (serverHeader && /\d+\.\d+/.test(serverHeader)) {
          securityFindings.push({
            id: 'server-version-disclosure',
            severity: 'info',
            title: 'Server Version Disclosure',
            category: 'Information Disclosure',
            evidence: `Server: ${serverHeader}`,
            remediation: 'Suppress detailed version banners in production HTTP responses.',
          });
        }
      }

      if (response.status >= 200 && response.status < 400 && text) {
        if ((path === '/openapi.json' || path === '/swagger.json') && text.trim().startsWith('{')) {
          technologies.add('OpenAPI / Swagger');
          securityFindings.push({
            id: `exposed-${path.slice(1)}`,
            severity: 'info',
            title: `Public API Specification (${path})`,
            category: 'Attack Surface',
            evidence: `${origin}${path} returned ${text.length} bytes of API schema definition.`,
            remediation: 'Verify whether all documented endpoints and administrative routes are intended to be publicly discoverable.',
          });
        }
        if (path === '/graphql' && (contentType.includes('json') || /graphql|query|errors/i.test(text))) {
          technologies.add('GraphQL');
          collectedEndpoints.push(classifyEndpoint('POST', '/graphql', ['query', 'variables'], 'probe'));
        }
        for (const ep of extractEndpointsFromText(text, `probe:${path}`)) {
          collectedEndpoints.push(ep);
        }
      }
    } catch(error) {
      network.signal?.throwIfAborted();
      errors.push({path,message:redactor.text(error instanceof Error?error.message:'Probe failed')});
    }
  }

  // Deduplicate endpoints
  const endpointMap = new Map<string, ReconEndpoint>();
  for (const ep of collectedEndpoints) {
    const key = `${ep.method}:${ep.path}`;
    if (!endpointMap.has(key)) endpointMap.set(key, ep);
  }
  const riskOrder = { high: 0, medium: 1, low: 2 };
  const endpoints = [...endpointMap.values()].sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk] || a.path.localeCompare(b.path));

  return {
    origin,
    scannedAt: new Date().toISOString(),
    technologies: [...technologies],
    probedPaths,
    state: errors.length?'inconclusive':'completed',
    errors,
    securityFindings,
    endpoints,
  };
}

export function buildCaseFromEndpoint(endpoint: ReconEndpoint, titlePrefix?: string): { case: CaseSpec; warnings: string[] } {
  const normalizedPath = endpoint.path.startsWith('/') ? endpoint.path : `/${endpoint.path}`;
  const hasIdPlaceholder = /\{([a-zA-Z0-9_-]+)\}|:([a-zA-Z0-9_-]+)|\/(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27})(?:\/|$)/i.test(normalizedPath);
  const probePath = hasIdPlaceholder
    ? normalizedPath
        .replace(/\{([a-zA-Z0-9_-]+)\}|:([a-zA-Z0-9_-]+)/g, '{resource}')
        .replace(/\/(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27})(?=\/|$)/i, '/{resource}')
    : normalizedPath.endsWith('/')
      ? `${normalizedPath}{resource}`
      : `${normalizedPath}/{resource}`;

  const rawCollection = probePath.replace(/\/\{resource\}.*$/, '') || '/api/items';
  const collectionPath = rawCollection.replace(/[{}]/g, '') || '/api/items';
  const isMutation = ['POST', 'PUT', 'PATCH'].includes(endpoint.method);

  const built = buildCase({
    title: `${titlePrefix ? `${titlePrefix}: ` : ''}${endpoint.method} ${normalizedPath} (${endpoint.categories.join(', ')})`.slice(0, 110),
    policy: `Only the resource owner or authorized role may access ${normalizedPath}. Generated from recon discovery (${endpoint.source}): ${endpoint.rationale}`,
    kind: isMutation ? 'write' : 'read',
    boundary: endpoint.categories.includes('bfla_privesc') ? 'cross_user' : 'cross_tenant',
    identityPath: '/me',
    idPointer: '/id',
    tenantPointer: '/tenant',
    rolePointer: '/role',
    createPath: collectionPath,
    createBody: { title: 'Private Recon Witness', visibility: 'private' },
    readPath: probePath,
    ...(isMutation ? { writePath: probePath, writeMethod: endpoint.method as 'POST' | 'PUT' | 'PATCH', writeBody: { title: 'Modified by Challenger' } } : {}),
  });

  if (endpoint.categories.includes('race_condition')) {
    const probeStep = built.case.steps.find(s => s.phase === 'probe');
    if (probeStep) {
      probeStep.concurrency = { count: 5, mode: 'parallel' };
    }
  }
  if (endpoint.categories.includes('graphql')) {
    for (const s of built.case.steps) {
      if (s.request.path.includes('graphql')) s.request.contentType = 'graphql';
    }
  }

  return {
    case: built.case,
    warnings: built.issues.map(i => `${i.path}: ${i.message}`),
  };
}
