import type { Condition, CheckResult, Json, HttpRequestSpec, ResolvedRequest } from './schema.ts';

const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
export function jsonPointer(value: unknown, pointer: string): any {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) throw new Error('JSON Pointer must be empty or begin with /');
  let current: any = value;
  for (const part of pointer.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(part)) throw new Error('Invalid JSON Pointer escape');
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (unsafe.has(key) || current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}
export function lookup(values: Record<string, unknown>, path: string): any {
  let current: any = values;
  for (const key of path.split('.')) {
    if (unsafe.has(key) || current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}
export function refs(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (!Array.isArray(value) && Object.keys(value).length === 1 && '$ref' in value) return [String((value as any).$ref)];
  return Object.values(value).flatMap(refs);
}
/** Only bindings actually consumed by the request can establish resource provenance. */
export function consumedRequestRefs(request: HttpRequestSpec): string[] {
  const names = [...request.path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
  return refs([Object.fromEntries(names.filter(name => Object.hasOwn(request.pathParams, name)).map(name => [name, request.pathParams[name]])), request.query, request.body ?? null]);
}
export function resolve(value: Json, values: Record<string, unknown>): any {
  if (value && typeof value === 'object') {
    if (!Array.isArray(value) && Object.keys(value).length === 1 && '$ref' in value) {
      const resolved = lookup(values, String(value.$ref));
      if (resolved === undefined) throw new Error(`Unbound reference: ${value.$ref}`);
      return resolved;
    }
    if (Array.isArray(value)) return value.map(item => resolve(item, values));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (unsafe.has(key)) throw new Error('Unsafe object key');
      return [key, resolve(item, values)];
    }));
  }
  return value;
}
export const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) && equal((a as any)[k], (b as any)[k]));
};
export function check(condition: Condition, values: Record<string, unknown>): CheckResult {
  try {
    const left = resolve(condition.left, values);
    const right = condition.right === undefined ? undefined : resolve(condition.right, values);
    let passed = false;
    if (condition.op === 'exists') passed = left !== undefined && left !== null && left !== '';
    else if (left !== undefined && right !== undefined) {
      switch (condition.op) {
        case 'eq': passed = equal(left, right); break;
        case 'neq': passed = !equal(left, right); break;
        case 'contains': passed = typeof left === 'string' && typeof right === 'string' ? left.includes(right) : Array.isArray(left) && left.some(x => equal(x, right)); break;
        case 'not_contains': passed = typeof left === 'string' && typeof right === 'string' ? !left.includes(right) : Array.isArray(left) && !left.some(x => equal(x, right)); break;
        case 'in': passed = Array.isArray(right) && right.some(x => equal(x, left)); break;
        case 'gt': passed = typeof left === 'number' && typeof right === 'number' && left > right; break;
        case 'gte': passed = typeof left === 'number' && typeof right === 'number' && left >= right; break;
        case 'lt': passed = typeof left === 'number' && typeof right === 'number' && left < right; break;
        case 'lte': passed = typeof left === 'number' && typeof right === 'number' && left <= right; break;
        case 'regex': passed = typeof left === 'string' && typeof right === 'string' && right.length <= 256 && left.length <= 50000 && new RegExp(right).test(left); break;
      }
    }
    return { id: condition.id, label: condition.label, passed, detail: passed ? 'Observed condition satisfied' : 'Observed condition not satisfied' };
  } catch {
    return { id: condition.id, label: condition.label, passed: false, detail: 'Required observation is unavailable' };
  }
}
export function targetOrigin(input: string): string {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Target must be a plain HTTP(S) origin without credentials or a path');
  return url.origin;
}
export function resolveRequest(spec: HttpRequestSpec, targets: Record<string, string>, values: Record<string, unknown>): ResolvedRequest {
  const base = targets[spec.origin];
  if (!base) throw new Error(`Target origin is not mapped: ${spec.origin}`);
  const origin = targetOrigin(base);
  if (!spec.path.startsWith('/') || spec.path.startsWith('//') || /[\\?#\r\n]/.test(spec.path)) throw new Error('Request path must be relative to the approved origin');
  const path = spec.path.replace(/\{([^}]+)\}/g, (_match, key) => {
    if (!Object.hasOwn(spec.pathParams, key)) throw new Error(`Missing path binding: ${key}`);
    const value = resolve(spec.pathParams[key], values);
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Path binding must resolve to a scalar');
    return encodeURIComponent(String(value));
  });
  if (/[{}]/.test(path)) throw new Error('Unresolved path binding');
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error('Request escaped its approved origin');
  for (const [key, value] of Object.entries(spec.query)) {
    const resolved = resolve(value, values);
    if (Array.isArray(resolved)) resolved.forEach(item => url.searchParams.append(key, String(item)));
    else if (resolved !== null) url.searchParams.append(key, String(resolved));
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(spec.headers)) {
    if (/^(authorization|cookie|host|origin|connection|content-length|transfer-encoding|proxy-.*)$/i.test(name)) throw new Error('Authentication and transport headers must come from the local session');
    const resolved = resolve(value, values);
    if (!['string', 'number', 'boolean'].includes(typeof resolved) || /[\r\n]/.test(String(resolved))) throw new Error('Header binding must be a safe scalar');
    headers[name] = String(resolved);
  }
  const hasContentType = Object.keys(headers).some(k => k.toLowerCase() === 'content-type');
  if (!hasContentType && spec.contentType === 'form') headers['content-type'] = 'application/x-www-form-urlencoded';
  else if (!hasContentType && (spec.contentType === 'graphql' || spec.contentType === 'json')) headers['content-type'] = 'application/json';
  return { url: url.toString(), method: spec.method, headers, ...(spec.contentType ? { contentType: spec.contentType } : {}), ...(spec.body === undefined ? {} : { body: resolve(spec.body, values) }) };
}
