import { ScanNetwork, readResponseText, type ScanOptions } from './network.ts';
import { checkScope, type BountyProgram } from './bounty.ts';
import { extractEndpointsFromText, probeOrigin, type ReconEndpoint, type ReconFinding } from './recon.ts';
import { createRedactor } from './redact.ts';
import { targetOrigin } from './values.ts';

export interface JwtAnalysisResult {
  validFormat: boolean;
  header: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  signaturePresent: boolean;
  suggestedPointers: {
    idPointer: string;
    tenantPointer?: string;
    rolePointer?: string;
  };
  findings: ReconFinding[];
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const json = Buffer.from(normalized + pad, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function analyzeJwtToken(rawInput: string): JwtAnalysisResult {
  const token = rawInput.trim().replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length < 2 || parts.length > 3) {
    return {
      validFormat: false,
      header: null,
      payload: null,
      signaturePresent: false,
      suggestedPointers: { idPointer: '/id' },
      findings: [
        {
          id: 'jwt-invalid-structure',
          severity: 'info',
          title: 'Input is not a standard 3-part JWT',
          category: 'Authentication Token',
          evidence: `Token contains ${parts.length} segment(s).`,
          remediation: 'Provide a Base64URL-encoded JWT (header.payload.signature) for structural JWT analysis.',
        },
      ],
    };
  }

  const header = decodeBase64UrlJson(parts[0] ?? '');
  const payload = decodeBase64UrlJson(parts[1] ?? '');
  const signaturePresent = Boolean(parts[2] && parts[2].trim().length > 0);
  const findings: ReconFinding[] = [];

  if (!header || !payload) {
    return {
      validFormat: false,
      header,
      payload,
      signaturePresent,
      suggestedPointers: { idPointer: '/id' },
      findings: [
        {
          id: 'jwt-decode-error',
          severity: 'info',
          title: 'Could not decode JWT header or payload as JSON',
          category: 'Authentication Token',
          evidence: 'Malformed Base64URL JSON segment.',
          remediation: 'Verify that the token is an unencrypted JWS (not an encrypted JWE).',
        },
      ],
    };
  }

  const alg = String(header.alg ?? '').toLowerCase();
  if (!alg || alg === 'none' || !signaturePresent) {
    findings.push({
      id: 'jwt-alg-none',
      severity: 'high',
      title: 'Unsigned JWT or "alg: none" Accepted Risk',
      category: 'JWT Security (CWE-347)',
      evidence: `Header alg="${String(header.alg ?? 'missing')}", signaturePresent=${signaturePresent}`,
      remediation: 'Reject tokens with alg="none" or empty signatures and enforce a strict algorithm allowlist on the verifier.',
    });
  } else if (alg.startsWith('hs')) {
    findings.push({
      id: 'jwt-hmac-symmetric',
      severity: 'info',
      title: `Symmetric HMAC Algorithm (${String(header.alg)})`,
      category: 'JWT Cryptography',
      evidence: `alg="${String(header.alg)}" uses a shared secret for signing and verification.`,
      remediation: 'Ensure the HMAC secret has high entropy (>= 256 bits) and test against RS256->HS256 key confusion if public keys are exposed.',
    });
  }

  for (const riskyHeader of ['jku', 'x5u', 'jwk', 'kid'] as const) {
    if (header[riskyHeader] !== undefined) {
      findings.push({
        id: `jwt-header-${riskyHeader}`,
        severity: riskyHeader === 'kid' ? 'low' : 'medium',
        title: `Dynamic Key Header "${riskyHeader}" Present in JWT`,
        category: 'JWT Key Resolution',
        evidence: `${riskyHeader}: ${JSON.stringify(header[riskyHeader])}`,
        remediation: `Validate "${riskyHeader}" against a strict server-side key registry; never fetch arbitrary URLs from jku/x5u or interpolate kid into SQL/file paths.`,
      });
    }
  }

  if (payload.exp === undefined) {
    findings.push({
      id: 'jwt-missing-exp',
      severity: 'medium',
      title: 'JWT Lacks Expiration Claim (exp)',
      category: 'Session Management (CWE-613)',
      evidence: 'Payload does not contain an "exp" timestamp.',
      remediation: 'Include a short-lived "exp" claim in all access tokens and enforce expiration checks.',
    });
  } else if (typeof payload.exp === 'number') {
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) {
      findings.push({
        id: 'jwt-expired',
        severity: 'info',
        title: 'JWT Token Is Expired',
        category: 'Session Management',
        evidence: `exp=${payload.exp} (${new Date(payload.exp * 1000).toISOString()}) is in the past.`,
        remediation: 'Verify that the server rejects this expired token and refresh the actor session before running live tests.',
      });
    } else if (typeof payload.iat === 'number' && payload.exp - payload.iat > 86400 * 30) {
      findings.push({
        id: 'jwt-long-lived',
        severity: 'low',
        title: 'Long-Lived JWT Access Token (> 30 days)',
        category: 'Session Management',
        evidence: `Token lifetime is ${Math.round((payload.exp - payload.iat) / 86400)} days.`,
        remediation: 'Prefer short-lived access tokens paired with revocable refresh tokens.',
      });
    }
  }

  const sensitiveKeys = Object.keys(payload).filter(k => /(?:password|secret|private|ssn|credit|card|api_?key|hash)/i.test(k));
  if (sensitiveKeys.length > 0) {
    findings.push({
      id: 'jwt-sensitive-payload',
      severity: 'high',
      title: 'Sensitive Data Exposed in Base64 JWT Payload',
      category: 'Information Exposure (CWE-200)',
      evidence: `Sensitive claim keys present: ${sensitiveKeys.join(', ')}`,
      remediation: 'Never store passwords, secrets, or sensitive PII inside unencrypted JWT payloads.',
    });
  }

  const keys = Object.keys(payload);
  const idKey = keys.find(k => /^(?:sub|id|user_?id|uid|account_?id)$/i.test(k)) ?? 'id';
  const tenantKey = keys.find(k => /^(?:tenant|tenant_?id|org|org_?id|workspace_?id|company_?id)$/i.test(k));
  const roleKey = keys.find(k => /^(?:role|roles|permissions|scope|is_?admin|group)$/i.test(k));

  return {
    validFormat: true,
    header,
    payload,
    signaturePresent,
    suggestedPointers: {
      idPointer: `/${idKey}`,
      ...(tenantKey ? { tenantPointer: `/${tenantKey}` } : {}),
      ...(roleKey ? { rolePointer: `/${roleKey}` } : {}),
    },
    findings,
  };
}

export interface TrafficAuditResult {
  findings: ReconFinding[];
  endpoints: ReconEndpoint[];
  leakedSecretsCount: number;
  insecureCookiesCount: number;
}

const SECRET_PATTERNS: Array<{ id: string; title: string; regex: RegExp; severity: 'high' | 'medium' }> = [
  { id: 'leak-aws-key', title: 'AWS Access Key ID Exposed in Traffic', regex: /\bAKIA[0-9A-Z]{16}\b/, severity: 'high' },
  { id: 'leak-github-token', title: 'GitHub Personal/App Token Exposed', regex: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/, severity: 'high' },
  { id: 'leak-slack-token', title: 'Slack Token Exposed in Response', regex: /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/, severity: 'high' },
  { id: 'leak-stripe-key', title: 'Stripe Live Secret/Restricted Key Exposed', regex: /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b/, severity: 'high' },
  { id: 'leak-google-api', title: 'Google API Key Exposed', regex: /\bAIza[0-9A-Za-z\-_]{35}\b/, severity: 'medium' },
  { id: 'leak-private-key', title: 'PEM Private Key Material Exposed', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, severity: 'high' },
];

const ERROR_PATTERNS: Array<{ id: string; title: string; regex: RegExp }> = [
  { id: 'error-sql-leak', title: 'Database / SQL Error Message Disclosure', regex: /(?:SQL syntax.*MySQL|Warning.*mysql_|PostgreSQL.*ERROR|ORA-\d{5}|SQLite\/JDBCDriver|Unclosed quotation mark after the character string)/i },
  { id: 'error-stack-trace', title: 'Server Stack Trace Disclosure', regex: /(?:Traceback \(most recent call last\)|at [A-Za-z0-9_$.]+\s*\([^)]+:\d+:\d+\)|Exception in thread "main")/ },
];

export function auditTrafficSecurity(trafficText: string): TrafficAuditResult {
  const findings: ReconFinding[] = [];
  let leakedSecretsCount = 0;
  let insecureCookiesCount = 0;

  for (const pat of SECRET_PATTERNS) {
    const match = trafficText.match(pat.regex);
    if (match) {
      leakedSecretsCount++;
      const sample = match[0].slice(0, 8) + '…[REDACTED]';
      findings.push({
        id: pat.id,
        severity: pat.severity,
        title: pat.title,
        category: 'Secret Exposure (CWE-798)',
        evidence: `Matched pattern: ${sample}`,
        remediation: 'Revoke the exposed credential immediately and remove secret keys from client-accessible HTTP responses or bundles.',
      });
    }
  }

  for (const errPat of ERROR_PATTERNS) {
    const match = trafficText.match(errPat.regex);
    if (match) {
      findings.push({
        id: errPat.id,
        severity: 'medium',
        title: errPat.title,
        category: 'Error Handling / Info Leak (CWE-209)',
        evidence: `Matched error signature: "${match[0].slice(0, 120)}"`,
        remediation: 'Return generic error messages to clients and log detailed stack traces or database errors server-side only.',
      });
    }
  }

  // Decode HAR headers rather than matching the serialized name/value separator.
  let cookieSource=trafficText;try{const har=JSON.parse(trafficText);if(Array.isArray(har?.log?.entries))cookieSource=har.log.entries.flatMap((e:any)=>(e.response?.headers??[]).filter((h:any)=>String(h.name).toLowerCase()==='set-cookie').map((h:any)=>'Set-Cookie: '+h.value)).join('\n');}catch{}
  const cookieMatches = [...cookieSource.matchAll(/set-cookie["'\s:]+\s*([^"\r\n]+)/gi)];
  for (const [idx, m] of cookieMatches.slice(0, 15).entries()) {
    const cookieVal = m[1] ?? '';
    const cookieName = cookieVal.split('=')[0]?.trim() || `cookie-${idx + 1}`;
    if (/(?:session|sid|token|auth|jwt)/i.test(cookieName)) {
      const missing: string[] = [];
      if (!/;\s*httponly/i.test(cookieVal)) missing.push('HttpOnly');
      if (!/;\s*secure/i.test(cookieVal)) missing.push('Secure');
      if (!/;\s*samesite/i.test(cookieVal)) missing.push('SameSite');
      if (missing.length > 0) {
        insecureCookiesCount++;
        findings.push({
          id: `insecure-cookie-${idx}`,
          severity: missing.includes('HttpOnly') ? 'medium' : 'low',
          title: `Session Cookie "${cookieName}" Missing ${missing.join(', ')}`,
          category: 'Cookie Security (CWE-614)',
          evidence: `Set-Cookie for "${cookieName}" lacks ${missing.join(', ')} attribute(s).`,
          remediation: 'Set HttpOnly, Secure, and SameSite=Lax (or Strict) on all authentication and session cookies.',
        });
      }
    }
  }

  const endpoints = extractEndpointsFromText(trafficText, 'traffic-audit');
  return {
    findings,
    endpoints,
    leakedSecretsCount,
    insecureCookiesCount,
  };
}

export interface JsBundleAnalysisResult {
  endpoints: ReconEndpoint[];
  graphqlOperations: Array<{ type: 'query' | 'mutation' | 'subscription'; name: string }>;
  clientRoleChecks: string[];
  sourceMaps: string[];
  envKeys: string[];
  findings: ReconFinding[];
}

export function analyzeJsBundle(jsSource: string, sourceLabel = 'js-bundle'): JsBundleAnalysisResult {
  const endpoints = extractEndpointsFromText(jsSource, sourceLabel);
  const graphqlOperations: JsBundleAnalysisResult['graphqlOperations'] = [];
  const seenGql = new Set<string>();

  for (const m of jsSource.matchAll(/\b(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)\s*[({]/g)) {
    const type = m[1] as 'query' | 'mutation' | 'subscription';
    const name = m[2] ?? '';
    const key = `${type}:${name}`;
    if (name && !seenGql.has(key)) {
      seenGql.add(key);
      graphqlOperations.push({ type, name });
    }
  }

  const clientRoleChecks = new Set<string>();
  for (const m of jsSource.matchAll(/\b(?:isAdmin|isSuperAdmin|canDelete|canEdit|hasRole|hasPermission|user\.role\s*===\s*['"`][^'"`]+['"`])/g)) {
    clientRoleChecks.add(m[0]);
  }

  const sourceMaps = new Set<string>();
  for (const m of jsSource.matchAll(/\/\/[#@]\s*sourceMappingURL=([^\s'"]+)/g)) {
    if (m[1]) sourceMaps.add(m[1]);
  }

  const envKeys = new Set<string>();
  for (const m of jsSource.matchAll(/\b(?:NEXT_PUBLIC_|REACT_APP_|VITE_)[A-Z0-9_]+\b/g)) {
    envKeys.add(m[0]);
  }

  const trafficAudit = auditTrafficSecurity(jsSource);
  const findings: ReconFinding[] = [...trafficAudit.findings];

  if (sourceMaps.size > 0) {
    findings.push({
      id: 'js-sourcemap-exposed',
      severity: 'low',
      title: 'JavaScript Source Map Reference Discovered',
      category: 'Attack Surface / Recon',
      evidence: `sourceMappingURL: ${[...sourceMaps].join(', ')}`,
      remediation: 'Verify that production .map files are not publicly downloadable unless intentional.',
    });
  }

  if (clientRoleChecks.size > 0) {
    findings.push({
      id: 'js-client-role-guards',
      severity: 'info',
      title: 'Client-Side Role / Permission Guards Found in Bundle',
      category: 'BFLA / Privilege Escalation Hint',
      evidence: `Guards: ${[...clientRoleChecks].slice(0, 8).join(', ')}`,
      remediation: 'Verify that every backend API route behind these UI guards enforces server-side role authorization.',
    });
  }

  return {
    endpoints,
    graphqlOperations,
    clientRoleChecks: [...clientRoleChecks],
    sourceMaps: [...sourceMaps],
    envKeys: [...envKeys],
    findings,
  };
}

export interface DiscoveredAsset {
  hostname: string;
  inScope: boolean;
  scopeReason: string;
  liveOrigin?: string;
  status?: number;
  server?: string;
}

export async function discoverSubdomains(
  domainInput: string,
  program?: Pick<BountyProgram, 'inScope' | 'outOfScope'>,
  fetcher: typeof fetch = fetch,
  options: ScanOptions = {},
): Promise<{ baseDomain: string; assets: DiscoveredAsset[] }> {
  const baseDomain = domainInput
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^\*\./, '')
    .split('/')[0]
    ?.toLowerCase() ?? '';
  if (!baseDomain || !baseDomain.includes('.')) {
    throw new Error('Provide a valid root domain (e.g. example.com)');
  }

  if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(baseDomain))throw new Error('Invalid root domain');
  const effectiveProgram = program ?? { inScope: [`*.${baseDomain}`, baseDomain], outOfScope: [] };
  const network=options.network??new ScanNetwork(fetcher,{...options,program:options.program??{...effectiveProgram,maxRps:10,customHeaders:{}}});
  const hostSet = new Set<string>([baseDomain, `api.${baseDomain}`, `app.${baseDomain}`]);
  try {
    const crtRes = await network.request(`https://crt.sh/?q=%25.${encodeURIComponent(baseDomain)}&output=json`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    },true);
    if (crtRes.ok) {
      const rows = JSON.parse(await readResponseText(crtRes,2000000)) as Array<{ name_value?: string }>;
      for (const row of rows.slice(0, 300)) {
        for (const rawName of String(row.name_value ?? '').split(/\r?\n/)) {
          const clean = rawName.trim().toLowerCase().replace(/^\*\./, '');
          if (clean && (clean === baseDomain || clean.endsWith(`.${baseDomain}`)) && !clean.includes(' ')) {
            hostSet.add(clean);
          }
        }
      }
    }
  } catch {
    network.signal?.throwIfAborted();
    /* Fallback to seed subdomains if crt.sh is offline or rate-limited */
  }

  const hosts = [...hostSet].slice(0, 30);
  const assets: DiscoveredAsset[] = [];

  for (const hostname of hosts) {
    const scope = checkScope(hostname, effectiveProgram);
    const asset: DiscoveredAsset = {
      hostname,
      inScope: scope.allowed,
      scopeReason: scope.reason,
    };
    if (scope.allowed && assets.filter(a => a.liveOrigin).length < 8) {
      for (const proto of ['https', 'http'] as const) {
        try {
          const origin = `${proto}://${hostname}`;
          const res = await network.request(origin, {
            method: 'HEAD',
            redirect: 'manual',
            signal: AbortSignal.timeout(3000),
          });
          asset.liveOrigin = origin;
          asset.status = res.status;
          asset.server = res.headers.get('server') ?? undefined;
          break;
        } catch {
          network.signal?.throwIfAborted();
          /* try next protocol or skip */
        }
      }
    }
    assets.push(asset);
  }

  return { baseDomain, assets };
}

export interface SecurityAuditPackResult {
  origin: string;
  inScope: boolean;
  scopeReason: string;
  scannedAt: string;
  technologies: string[];
  allowedMethods: string[];
  state: 'completed'|'inconclusive';
  errors: Array<{path:string;message:string}>;
  graphqlIntrospectionEnabled: boolean;
  findings: ReconFinding[];
  endpoints: ReconEndpoint[];
}

export async function runSecurityAuditPack(
  originInput: string,
  program?: BountyProgram,
  fetcher: typeof fetch = fetch,
  secrets: string[] = [],
  options: ScanOptions = {},
): Promise<SecurityAuditPackResult> {
  const origin = targetOrigin(originInput);
  const redactor = createRedactor(secrets);
  const network=options.network??new ScanNetwork(fetcher,{...options,program});
  const wrappedFetch: typeof fetch = (url,init)=>network.request(String(url),init);
  const baseRecon = await probeOrigin(origin, wrappedFetch, secrets, {network});
  const errors=[...baseRecon.errors];
  const findings: ReconFinding[] = [...baseRecon.securityFindings];
  const endpoints: ReconEndpoint[] = [...baseRecon.endpoints];
  let allowedMethods: string[] = [];
  let graphqlIntrospectionEnabled = false;

  // 1. Check OPTIONS / HTTP Verb Enumeration
  try {
    const optRes = await wrappedFetch(`${origin}/`, {
      method: 'OPTIONS',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    const allow = optRes.headers.get('allow') ?? optRes.headers.get('access-control-allow-methods') ?? '';
    if (allow) {
      allowedMethods = allow.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (allowedMethods.some(m => ['PUT', 'DELETE', 'TRACE', 'CONNECT'].includes(m))) {
        findings.push({
          id: 'http-risky-methods-advertised',
          severity: allowedMethods.includes('TRACE') ? 'medium' : 'info',
          title: `HTTP Methods Advertised via OPTIONS (${allowedMethods.join(', ')})`,
          category: 'HTTP Configuration',
          evidence: `Allow / Access-Control-Allow-Methods: ${allow}`,
          remediation: 'Disable unused HTTP verbs (such as TRACE) and ensure state-changing methods require authentication.',
        });
      }
    }
  } catch(error) { network.signal?.throwIfAborted(); errors.push({path:'audit',message:redactor.text(error instanceof Error?error.message:'Audit failed')}); }

  // 2. Check Null Origin CORS Reflection
  try {
    const nullCorsRes = await wrappedFetch(`${origin}/`, {
      method: 'GET',
      headers: { Origin: 'null' },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (nullCorsRes.headers.get('access-control-allow-origin') === 'null') {
      findings.push({
        id: 'cors-null-origin-allowed',
        severity: nullCorsRes.headers.get('access-control-allow-credentials') === 'true' ? 'high' : 'medium',
        title: 'CORS Allows "null" Origin',
        category: 'CORS Misconfiguration (CWE-942)',
        evidence: 'Access-Control-Allow-Origin: null returned when Origin: null was sent.',
        remediation: 'Never allow the "null" origin in Access-Control-Allow-Origin as sandboxed iframes can forge null-origin requests.',
      });
    }
  } catch(error) { network.signal?.throwIfAborted(); errors.push({path:'audit',message:redactor.text(error instanceof Error?error.message:'Audit failed')}); }

  // 3. Check GraphQL Introspection
  try {
    const gqlRes = await wrappedFetch(`${origin}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __schema { queryType { name } mutationType { name } } }' }),
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (gqlRes.ok) {
      const json = JSON.parse(await readResponseText(gqlRes,50000));
      if (json?.data?.__schema && typeof json.data.__schema==='object' && !json.errors?.length) {
        graphqlIntrospectionEnabled = true;
        findings.push({
          id: 'graphql-introspection-enabled',
          severity: 'medium',
          title: 'GraphQL Introspection Enabled',
          category: 'GraphQL Security',
          evidence: `POST ${origin}/graphql returned __schema introspection metadata.`,
          remediation: 'Disable GraphQL schema introspection in production environments unless public API discovery is intended.',
        });
      }
    }
  } catch(error) { network.signal?.throwIfAborted(); errors.push({path:'audit',message:redactor.text(error instanceof Error?error.message:'Audit failed')}); }

  return {
    origin,
    inScope: true,
    scopeReason: program ? `Verified against program "${program.name}"` : 'Ad-hoc target assessment',
    scannedAt: new Date().toISOString(),
    technologies: baseRecon.technologies,
    allowedMethods,
    state: errors.length?'inconclusive':'completed',
    errors,
    graphqlIntrospectionEnabled,
    findings,
    endpoints,
  };
}
