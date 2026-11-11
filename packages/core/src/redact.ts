import type { Json } from './schema.ts';

/** Field-name detection is deliberately conservative; it is not a PII classifier. */
export function isSecretKey(key: string): boolean {
  const normal = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /authorization|password|passwd|passphrase|apikey|clientsecret|cookie|csrf|xsrf/.test(normal)
    || /^(?:access|refresh|id|auth|bearer|session)?token$/.test(normal)
    || /(?:token|secret)$/.test(normal)
    || /^session(?:id|key)?$/.test(normal);
}

function isReference(value: unknown): value is { $ref: string } {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && typeof (value as Record<string, unknown>).$ref === 'string';
}

export interface Redactor {
  text(input: string): string;
  json<T>(input: T): T;
  add(...values: string[]): void;
  alias(value: Json, label: string): void;
}

export function createRedactor(initialSecrets: string[] = []): Redactor {
  const secrets = new Set(initialSecrets.filter(Boolean));
  const aliases = new Map<string, { value: string | number; label: string }>();
  const keyFor = (value: unknown) => `${typeof value}:${String(value)}`;
  const add = (...values: string[]) => { for (const value of values) if (value) secrets.add(value); };

  const rememberField = (name: string, value: unknown) => {
    if (!isSecretKey(name) || typeof value !== 'string' || !value || value.startsWith('[')) return;
    add(value);
    if (/authorization/i.test(name)) {
      const credential = value.replace(/^\s*(?:Bearer|Basic)\s+/i, '').trim();
      if (credential && credential !== value) add(credential);
    }
    if (/cookie/i.test(name)) {
      for (const part of value.split(';')) {
        const equal = part.indexOf('=');
        if (equal < 1) continue;
        const cookieName = part.slice(0, equal).trim();
        const cookieValue = part.slice(equal + 1).trim();
        if (!/^(?:path|domain|expires|max-age|samesite)$/i.test(cookieName) && cookieValue) add(cookieValue);
      }
    }
  };

  const scan = (value: unknown) => {
    if (!value || typeof value !== 'object' || isReference(value)) return;
    if (Array.isArray(value)) { for (const item of value) scan(item); return; }
    for (const [key, item] of Object.entries(value)) { rememberField(key, item); scan(item); }
  };

  const maskText = (input: string, withAliases = true): string => {
    let result = input;
    // Longer values first prevents a short component from leaving a long secret partially visible.
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
      for (const variant of new Set([secret, encodeURIComponent(secret)])) result = result.split(variant).join('[REDACTED]');
    }
    if (!withAliases) return result;
    const exact = aliases.get(keyFor(result));
    if (exact) return `[${exact.label}]`;
    // Long opaque identifiers/canaries can occur inside prose. Short IDs only get
    // substituted as complete JSON leaves or URL components, never inside dates.
    for (const { value, label } of aliases.values()) {
      if (typeof value === 'string' && value.length >= 8 && !/^\d+$/.test(value)) {
        result = result.split(value).join(`[${label}]`);
        result = result.split(encodeURIComponent(value)).join(`[${label}]`);
      }
    }
    if (/^https?:\/\//i.test(result)) {
      try {
        const url = new URL(result);
        url.username = ''; url.password = '';
        url.pathname = url.pathname.split('/').map(segment => {
          let decoded = segment;
          try { decoded = decodeURIComponent(segment); } catch { /* Preserve malformed input as text. */ }
          const entry = aliases.get(keyFor(decoded)) ?? (/^-?\d+(?:\.\d+)?$/.test(decoded) ? aliases.get(keyFor(Number(decoded))) : undefined);
          return entry ? `[${entry.label}]` : segment;
        }).join('/');
        for (const [name, value] of [...url.searchParams]) {
          const entry = aliases.get(keyFor(value)) ?? (/^-?\d+(?:\.\d+)?$/.test(value) ? aliases.get(keyFor(Number(value))) : undefined);
          if (isSecretKey(name)) url.searchParams.set(name, '[REDACTED]');
          else if (entry) url.searchParams.set(name, `[${entry.label}]`);
        }
        result = url.toString();
      } catch { /* An error containing a URL still receives secret replacement above. */ }
    }
    return result;
  };

  type Context = 'generic' | 'case' | 'run';
  const metadata = new Set(['schemaVersion', 'revision', 'caseRevision', 'requests', 'status', 'requestCount', 'attempts', 'successes', 'port', 'intervalMs', 'maxRequests']);
  const aliasAllowed = (context: Context, path: string[], field?: string) => {
    if (context === 'case' || (field && metadata.has(field))) return false;
    if (context === 'generic') return true;
    if (path[0] === 'identities') return path.length === 3 && (path[2] === 'id' || path[2] === 'tenant');
    if (path[0] === 'steps' && path.length >= 4) {
      return (path[2] === 'request' && ['url', 'body'].includes(path[3]))
        || (path[2] === 'response' && ['body', 'headers'].includes(path[3]));
    }
    return false;
  };
  const visit = (value: unknown, field?: string, path: string[] = [], context: Context = 'generic'): unknown => {
    if (isReference(value)) return { $ref: value.$ref };
    if (field && isSecretKey(field) && value !== undefined && value !== null) return '[REDACTED]';
    const useAliases = aliasAllowed(context, path, field);
    if (typeof value === 'string') return maskText(value, useAliases);
    if (typeof value === 'number') {
      const alias = useAliases ? aliases.get(keyFor(value)) : undefined;
      return alias ? `[${alias.label}]` : value;
    }
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item, index) => visit(item, undefined, [...path, String(index)], context));
    if (Object.hasOwn(value, 'schemaVersion') && Object.hasOwn(value, 'actors') && Object.hasOwn(value, 'witness')) { context = 'case'; path = []; }
    else if (Object.hasOwn(value, 'caseId') && Object.hasOwn(value, 'caseRevision') && Object.hasOwn(value, 'steps')) { context = 'run'; path = []; }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [name, item] of Object.entries(value)) result[name] = visit(item, name, [...path, name], context);
    return result;
  };

  return {
    add,
    alias(value, label) {
      if ((typeof value === 'string' && value.length) || (typeof value === 'number' && Number.isFinite(value))) {
        aliases.set(keyFor(value), { value: value as string | number, label });
      }
    },
    text: input => maskText(input),
    json<T>(input: T): T { scan(input); return visit(input) as T; },
  };
}
