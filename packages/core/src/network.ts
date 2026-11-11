import { setTimeout as delay } from 'node:timers/promises';
import { checkScope, type BountyProgram } from './bounty.ts';

/** Start-time limiter shared by all scans for one program (not one limiter per request). */
export class RequestLimiter {
  private tail: Promise<unknown> = Promise.resolve();
  private nextAt = 0;
  wait(rps: number, signal?: AbortSignal) {
    const turn = this.tail.then(async () => {
      signal?.throwIfAborted();
      const wait = this.nextAt - Date.now();
      if (wait > 0) await delay(wait, undefined, { signal });
      signal?.throwIfAborted();
      this.nextAt = Date.now() + Math.ceil(1000 / rps);
    });
    this.tail = turn.catch(() => {});
    return turn;
  }
}
export interface ScanOptions {
  signal?: AbortSignal;
  program?: Pick<BountyProgram, 'inScope' | 'outOfScope' | 'maxRps' | 'customHeaders'>;
  limiter?: RequestLimiter;
  maxRequests?: number;
  network?: ScanNetwork;
}
export class ScanNetwork {
  readonly signal?: AbortSignal;
  private limiter: RequestLimiter;
  private count = 0;
  constructor(private fetcher: typeof fetch, private options: ScanOptions = {}) {
    this.signal = options.signal;
    this.limiter = options.limiter ?? new RequestLimiter();
  }
  async authorize(input: string, requestSignal?: AbortSignal | null, discoveryLookup = false) {
    this.signal?.throwIfAborted();
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) URL without credentials');
    if (discoveryLookup && (url.origin !== 'https://crt.sh' || url.pathname !== '/')) throw new Error('Invalid discovery service');
    if (!discoveryLookup && this.options.program) {
      const scope = checkScope(input, this.options.program);
      if (!scope.allowed) throw new Error(`Scope restriction: ${scope.reason}`);
    }
    const signal = AbortSignal.any([this.signal, requestSignal].filter((s): s is AbortSignal => !!s));
    await this.limiter.wait(this.options.program?.maxRps ?? 10, signal);
    signal.throwIfAborted();
    if (++this.count > (this.options.maxRequests ?? 100)) throw new Error('Scan request budget exhausted');
    return signal;
  }
  async request(input: string, init: RequestInit = {}, discoveryLookup = false) {
    const signal = await this.authorize(input, AbortSignal.any([...(init.signal?[init.signal]:[]),AbortSignal.timeout(10000)]), discoveryLookup);
    const headers = new Headers(discoveryLookup ? {} : this.options.program?.customHeaders);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    return this.fetcher(new URL(input).href, { ...init, headers, redirect: 'manual', signal });
  }
}
export async function readResponseText(response: Response, limit = 150000): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error(`Response exceeds ${limit} byte scan limit`);
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
