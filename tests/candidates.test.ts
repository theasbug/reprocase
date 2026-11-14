import { afterEach, describe, expect, it } from 'vitest';
import { importTraffic, parseCandidates, validateCase } from '../packages/core/src/index.ts';
import { createServer } from '../apps/server/src/server.ts';

const arjunOutput = JSON.stringify({
  'https://api.example.test/v1/search': { method: 'GET', params: ['q', 'page'], headers: { 'User-Agent': 'x' } },
  'https://api.example.test/v1/orders': { method: 'GET', params: ['order_id', 'format'], headers: { Cookie: 'session=SECRET-COOKIE', Authorization: 'Bearer SECRET-TOKEN' } },
  'https://api.example.test/v1/profile': { method: 'JSON', params: ['user_id', 'name'], headers: {} },
  'not a url': { method: 'GET', params: ['id'], headers: {} },
});

const ffufOutput = JSON.stringify({
  commandline: 'ffuf -u https://api.example.test/v1/users/FUZZ -w ids.txt -of json',
  config: { method: 'GET' },
  results: [
    { input: { FUZZ: '1041' }, status: 200, length: 120, url: 'https://api.example.test/v1/users/1041' },
    { input: { FUZZ: '1042' }, status: 200, length: 118, url: 'https://api.example.test/v1/users/1042' },
    { input: { FUZZ: 'admin' }, status: 403, length: 10, url: 'https://api.example.test/admin' },
    { input: { FUZZ: 'x' }, status: 200, url: 'ftp://api.example.test/file' },
  ],
});

describe('IDOR candidates', () => {
  it('ranks Arjun parameters by identifier signals and skips invalid entries', () => {
    const result = parseCandidates('arjun', arjunOutput);
    expect(result.total).toBe(3);
    expect(result.candidates.map(c => c.url)).toEqual([
      'https://api.example.test/v1/orders',
      'https://api.example.test/v1/profile',
      'https://api.example.test/v1/search',
    ]);
    const [orders, profile, search] = result.candidates;
    expect(orders!.score).toBeGreaterThan(0);
    expect(orders!.reasons.join(' ')).toContain('order_id');
    expect(profile!.method).toBe('POST');
    expect(profile!.raw).toContain('Content-Type: application/json');
    expect(search!.score).toBe(0);
    expect(result.candidates.map(c => c.index)).toEqual([1, 2, 3]);
    expect(result.warnings.join(' ')).toMatch(/Cookie\/Authorization headers were not copied/);
  });

  it('never carries captured credentials into the draft request', () => {
    const { candidates } = parseCandidates('arjun', arjunOutput);
    for (const c of candidates) {
      expect(c.raw).not.toMatch(/SECRET|cookie:|authorization:/i);
    }
  });

  it('groups ffuf results that differ only by identifier and keeps the 2xx signal', () => {
    const result = parseCandidates('ffuf', ffufOutput);
    expect(result.candidates).toHaveLength(2);
    const users = result.candidates[0]!;
    expect(users.url).toBe('https://api.example.test/v1/users/1041');
    expect(users.status).toBe(200);
    expect(users.reasons).toContain('Fuzzed identifier returned a 2xx response');
    expect(users.reasons.some(r => r.includes('/users/'))).toBe(true);
    expect(result.candidates[1]!.score).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/grouped/);
  });

  it('turns a candidate into a valid case draft with the identifier rebound', () => {
    const { candidates } = parseCandidates('ffuf', ffufOutput);
    const draft = importTraffic('http', candidates[0]!.raw);
    expect(draft.case.steps).toHaveLength(1);
    const step = draft.case.steps[0]!;
    expect(step.request.path).toBe('/v1/users/{id1}');
    expect(JSON.stringify(step.request.pathParams)).toContain('importedId');
    expect(validateCase(draft.case).filter(i => i.level === 'error').map(i => i.message).join('\n')).not.toMatch(/schema/i);

    const arjun = parseCandidates('arjun', arjunOutput).candidates[0]!;
    const fromArjun = importTraffic('http', arjun.raw).case.steps[0]!;
    expect(JSON.stringify(fromArjun.request.query.order_id)).toContain('importedId');
  });

  it('explains how to produce the expected JSON on bad input', () => {
    expect(() => parseCandidates('arjun', 'https://x.test?id=1')).toThrow(/-oJ/);
    expect(() => parseCandidates('ffuf', 'not json')).toThrow(/-of json/);
    expect(() => parseCandidates('ffuf', '{"foo":1}')).toThrow(/results array/);
  });
});

describe('candidates API', () => {
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  afterEach(async () => { await server?.close(); server = undefined; });
  it('requires the token and returns ranked candidates', async () => {
    server = await createServer({ memory: true, port: 0 });
    const host = new URL(server.origin).host;
    const denied = await server.app.inject({ method: 'POST', url: '/api/candidates', headers: { host }, payload: { kind: 'ffuf', data: ffufOutput } });
    expect(denied.statusCode).toBe(401);
    const ok = await server.app.inject({ method: 'POST', url: '/api/candidates', headers: { host, authorization: `Bearer ${server.token}` }, payload: { kind: 'ffuf', data: ffufOutput } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().candidates[0].url).toBe('https://api.example.test/v1/users/1041');
  });
});
