import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, request as playwrightRequest, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import type { ActorSpec, HttpResponse, Identity, Json, ResolvedRequest } from '@reprocase/core';

export interface ActorSessionStatus {
  id: string; origin: string; mode: 'browser' | 'direct'; connected: boolean;
  identity?: Identity; url?: string; error?: string;
}
export interface DirectConnection {
  origin: string; token?: string; cookie?: string; headers?: Record<string, string>;
  login?: { path: string; method?: string; body?: Json };
}
export interface BrowserAction {
  type: 'navigate' | 'click' | 'fill' | 'fillSecret' | 'press' | 'handoff';
  ref?: string; url?: string; value?: string; secretRef?: string;
}
interface Session {
  status: ActorSessionStatus; api: APIRequestContext; browser?: Browser; context?: BrowserContext; page?: Page;
  headers: Record<string, string>; fields: Map<string, Locator>; secretRefs: Map<string, { kind: string; value: string }>;
  recording: boolean; entries: Json[]; generation: number;
}

const MAX_BODY = 2 * 1024 * 1024;
const forbidden = /^(host|origin|connection|content-length|transfer-encoding|upgrade|proxy-.*|sec-.*)$/i;
const sensitive = /authorization|cookie|password|passwd|secret|token|api[-_]?key|session|csrf/i;
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function originOf(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) origin without embedded credentials.');
  return url.origin;
}
function scopedURL(origin: string, path: string): string {
  const url = new URL(path, origin);
  if (url.origin !== origin || /\\/.test(path)) throw new Error('The request leaves the bound account origin.');
  return url.href;
}
function pointer(value: Json, path: string): Json | undefined {
  if (path === '') return value;
  if (!path.startsWith('/')) throw new Error('Identity fields require JSON Pointer paths.');
  let current: unknown = value;
  for (const part of path.slice(1).split('/').map(v => v.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current as Json;
}
function scalar(value: Json | undefined): value is string | number {
  return (typeof value === 'string' && value.length > 0) || (typeof value === 'number' && Number.isFinite(value));
}
function safeHeaders(headers: Record<string, string>, allowAuth = false): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value) || forbidden.test(name)) throw new Error(`Unsupported request header: ${name}`);
    if (!allowAuth && /^(authorization|cookie)$/i.test(name)) throw new Error('Authentication must come from the selected account binding.');
    result[name.toLowerCase()] = value;
  }
  return result;
}
function installedChromium(): string | undefined {
  const project = process.env.REPROCASE_APP_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const caches = [join(project, '.browsers'), ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'ms-playwright')] : [])];
  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    const directories = readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const directory of directories) {
      const paths = [join(cache, directory, 'chrome-win64', 'chrome.exe'), join(cache, directory, 'chrome-linux64', 'chrome'), join(cache, directory, 'chrome-linux', 'chrome'), join(cache, directory, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'), join(cache, directory, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')];
      const executable = paths.find(path => existsSync(path));
      if (executable) return executable;
    }
  }
  return undefined;
}

/** One actor owns one isolated session. Live credentials are never persisted by this manager. */
export class BrowserManager {
  private sessions = new Map<string, Session>();
  private secrets = new Set<string>();

  knownSecrets(): string[] { return [...this.secrets]; }
  private remember(value: unknown): void {
    if (typeof value === 'string' && value) this.secrets.add(value);
  }
  private rememberHeaders(headers: Record<string, string>): void {
    for (const [key, value] of Object.entries(headers)) {
      if (!sensitive.test(key)) continue;
      this.remember(value);
      if (/authorization/i.test(key)) this.remember(value.replace(/^[A-Za-z]+\s+/, ''));
      if (/^cookie$/i.test(key)) {
        for (const cookie of value.split(';')) this.remember(cookie.split('=').slice(1).join('=').trim());
      } else if (/^set-cookie$/i.test(key)) {
        // Set-Cookie attributes are not cookies. In particular, Path=/ must never
        // enter the secret registry and replace every slash in unrelated data.
        for (const cookie of value.split(/\n|,(?=\s*[^;,=\s]+=)/)) {
          const pair = cookie.split(';')[0]!;
          this.remember(pair.split('=').slice(1).join('=').trim());
        }
      }
    }
  }
  private rememberBody(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (sensitive.test(key) && typeof item === 'string') this.remember(item);
      else if (item && typeof item === 'object') this.rememberBody(item);
    }
  }
  private rememberURL(value: string): void {
    try { for (const [key, item] of new URL(value).searchParams) if (sensitive.test(key)) this.remember(item); } catch { /* Never treat a malformed URL as a source of executable input. */ }
  }
  private redactText(value: string): string {
    let output = value;
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) {
      if (secret.length >= 4 || output === secret) output = output.split(secret).join('[REDACTED]');
    }
    return output;
  }
  private redactURL(value: string): string {
    try {
      const url = new URL(value);
      url.username = ''; url.password = ''; url.hash = '';
      url.pathname = url.pathname.split('/').map(part => {
        let decoded = part; try { decoded = decodeURIComponent(part); } catch { /* Display malformed data without executing it. */ }
        return this.secrets.has(decoded) ? '[REDACTED]' : part;
      }).join('/');
      for (const [name, item] of [...url.searchParams]) if (sensitive.test(name) || this.secrets.has(item)) url.searchParams.set(name, '[REDACTED]');
      return url.toString();
    } catch { return this.redactText(value); }
  }
  private redact<T>(value: T, key = ''): T {
    if (sensitive.test(key) && value !== undefined && value !== null) return '[REDACTED]' as T;
    if (typeof value === 'string' && key === 'url') return this.redactURL(value) as T;
    if (typeof value === 'string' && key === 'origin') return value;
    if (typeof value === 'string') return this.redactText(value) as T;
    if (Array.isArray(value)) return value.map(v => this.redact(v)) as T;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.redact(v, k)])) as T;
    return value;
  }
  status(key: string): ActorSessionStatus | undefined {
    const session = this.sessions.get(key);
    if (!session) return undefined;
    const pageURL = session.page?.isClosed() ? undefined : session.page?.url();
    return { ...session.status, identity: session.status.identity ? this.redact(session.status.identity) : undefined, error: session.status.error ? this.redactText(session.status.error) : undefined, url: pageURL ? this.redactURL(pageURL) : undefined };
  }
  statuses(): ActorSessionStatus[] { return [...this.sessions.keys()].map(key => this.status(key)!); }
  private get(key: string): Session {
    const session = this.sessions.get(key);
    if (!session) throw new Error('Connect this account before using it.');
    return session;
  }

  async open(key: string, originInput: string): Promise<ActorSessionStatus> {
    const origin = originOf(originInput);
    await this.close(key);
    const configured = process.env.REPROCASE_CHROMIUM_EXECUTABLE;
    const executablePath = configured || (existsSync(chromium.executablePath()) ? undefined : installedChromium());
    let browser: Browser;
    try {
      browser = await chromium.launch({ headless: process.env.REPROCASE_HEADLESS === '1', executablePath, env: { ...process.env, DEBUG: '' } });
    } catch {
      throw new Error('Chromium could not start. Run npm run browsers:install, or set REPROCASE_CHROMIUM_EXECUTABLE to your Chromium executable.');
    }
    const context = await browser.newContext({ ignoreHTTPSErrors: false });
    const page = await context.newPage();
    const session: Session = { status: { id: key, origin, mode: 'browser', connected: false }, browser, context, page, api: context.request, headers: {}, fields: new Map(), secretRefs: new Map(), recording: false, entries: [], generation: 0 };
    this.sessions.set(key, session);
    context.on('request', req => {
      if (new URL(req.url()).origin !== origin) return;
      const headers = req.headers();
      this.rememberHeaders(headers);
      this.rememberURL(req.url());
      // A SPA's bearer header is reused only for its explicitly bound API origin.
      if (headers.authorization) session.headers.authorization = headers.authorization;
      for (const [name, value] of Object.entries(headers)) if (/^(x-csrf-token|x-xsrf-token)$/i.test(name)) session.headers[name] = value;
    });
    context.on('response', response => { void this.recordBrowserResponse(session, response).catch(() => {}); });
    page.on('close', () => { session.status.connected = false; session.status.error = 'The account browser was closed.'; });
    try { await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
    catch { session.status.error = 'The page did not finish loading. You can navigate or complete login in the browser.'; }
    return this.status(key)!;
  }

  async connectDirect(key: string, input: DirectConnection): Promise<ActorSessionStatus> {
    try { return await this.connectDirectInternal(key, input); }
    catch (error) { throw new Error(this.redactText(error instanceof Error ? error.message : String(error))); }
  }
  private async connectDirectInternal(key: string, input: DirectConnection): Promise<ActorSessionStatus> {
    const origin = originOf(input.origin);
    const headers = safeHeaders(input.headers ?? {}, true);
    if (input.token) headers.authorization = `Bearer ${input.token}`;
    await this.close(key);
    this.rememberHeaders(headers);
    this.remember(input.token);
    this.remember(input.cookie);
    if (input.cookie) this.rememberHeaders({ cookie: input.cookie });
    const api = await playwrightRequest.newContext({ ignoreHTTPSErrors: false });
    if (input.cookie) {
      const cookies = input.cookie.split(';').map(v => v.trim()).filter(v => v.includes('=')).map(v => {
        const index = v.indexOf('='); return { name: v.slice(0, index), value: v.slice(index + 1), url: origin };
      });
      await api.storageState();
      // API contexts do not accept addCookies on every supported Playwright version.
      await api.dispose();
      const cookieAPI = await playwrightRequest.newContext({ ignoreHTTPSErrors: false, storageState: { cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: new URL(origin).hostname, path: '/', expires: -1, httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'Lax' as const })), origins: [] } });
      this.sessions.set(key, { status: { id: key, origin, mode: 'direct', connected: false }, api: cookieAPI, headers, fields: new Map(), secretRefs: new Map(), recording: false, entries: [], generation: 0 });
    } else {
      this.sessions.set(key, { status: { id: key, origin, mode: 'direct', connected: false }, api, headers, fields: new Map(), secretRefs: new Map(), recording: false, entries: [], generation: 0 });
    }
    if (input.login) {
      this.rememberBody(input.login.body);
      const result = await this.request(key, { url: scopedURL(origin, input.login.path), method: input.login.method ?? 'POST', headers: {}, body: input.login.body });
      if (result.status < 200 || result.status >= 300) throw new Error(`The login recipe returned HTTP ${result.status}. Connect manually or update the recipe.`);
      // Cookie sessions are already updated. A common bearer response is supported as an experimental convenience.
      if (!headers.authorization && !result.headers['set-cookie'] && result.body && typeof result.body === 'object' && !Array.isArray(result.body)) {
        const token = result.body.token ?? result.body.access_token;
        if (typeof token === 'string') { this.get(key).headers.authorization = `Bearer ${token}`; this.remember(token); }
      }
    }
    return this.status(key)!;
  }

  async request(key: string, request: ResolvedRequest, signal?: AbortSignal): Promise<HttpResponse> {
    const session = this.get(key);
    if (signal?.aborted) throw new Error('Request cancelled before dispatch.');
    if (originOf(request.url) !== session.status.origin) throw new Error('This account is not bound to the requested origin.');
    const method = request.method.toUpperCase();
    if (!methods.has(method)) throw new Error('Unsupported HTTP method.');
    const headers = { ...session.headers, ...safeHeaders(request.headers) };
    this.rememberHeaders(headers);
    this.rememberURL(request.url);
    const startedAt = new Date().toISOString();
    let abortListener: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      abortListener = () => reject(new Error('Request cancelled; an in-flight server action may have completed. Do not retry a mutation automatically.'));
      signal?.addEventListener('abort', abortListener, { once: true });
    });
    let response: Awaited<ReturnType<APIRequestContext['fetch']>> | undefined;
    try {
      const fetchOptions: Parameters<APIRequestContext['fetch']>[1] = { method, headers, timeout: 30000, maxRedirects: 0, maxRetries: 0, failOnStatusCode: false };
      if (request.body !== undefined) {
        if (request.contentType === 'form' && request.body && typeof request.body === 'object' && !Array.isArray(request.body)) {
          fetchOptions.form = Object.fromEntries(Object.entries(request.body).map(([k, v]) => [k, String(v ?? '')]));
        } else if (request.contentType === 'multipart' && request.body && typeof request.body === 'object' && !Array.isArray(request.body)) {
          delete headers['content-type'];
          fetchOptions.multipart = Object.fromEntries(Object.entries(request.body).map(([k, v]) => [k, String(v ?? '')]));
        } else {
          fetchOptions.data = request.body;
        }
      }
      const pending = session.api.fetch(request.url, fetchOptions);
      // If cancellation wins, dispose the eventual response without retrying or exposing its data.
      void pending.then(value => { if (signal?.aborted) void value.dispose(); }, () => {});
      response = await Promise.race([pending, cancelled]);
      const resultHeaders = response.headers();
      this.rememberHeaders(resultHeaders);
      if (Number(resultHeaders['content-length'] ?? 0) > MAX_BODY) throw new Error('Response exceeds the 2 MiB evidence limit.');
      const buffer = await response.body();
      if (buffer.byteLength > MAX_BODY) throw new Error('Response exceeds the 2 MiB evidence limit.');
      const text = buffer.toString('utf8');
      let body: Json;
      try { body = text ? JSON.parse(text) as Json : null; } catch { body = text; }
      this.rememberBody(body);
      const result = { status: response.status(), headers: resultHeaders, body };
      if (session.recording) this.addEntry(session, request, result, startedAt);
      if (result.status === 401) { session.status.connected = false; session.status.error = 'The session expired or was rejected.'; }
      return result;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      throw new Error(this.redactText(text));
    } finally {
      if (abortListener) signal?.removeEventListener('abort', abortListener);
      await response?.dispose().catch(() => {});
    }
  }

  async verify(key: string, probe: ActorSpec['identity']): Promise<Identity> {
    const session = this.get(key);
    session.status.connected = false;
    const response = await this.request(key, { url: scopedURL(session.status.origin, probe.path), method: 'GET', headers: {} });
    if (response.status !== 200) { session.status.connected = false; throw new Error(`Identity probe returned HTTP ${response.status}.`); }
    const id = pointer(response.body, probe.idPointer);
    if (!scalar(id)) { session.status.connected = false; throw new Error('The identity probe did not return a nonempty account ID.'); }
    const identity: Identity = { id };
    if (probe.tenantPointer) {
      const tenant = pointer(response.body, probe.tenantPointer);
      if (!scalar(tenant)) throw new Error('The identity probe did not return the expected tenant.');
      identity.tenant = tenant;
    }
    if (probe.rolePointer) {
      const role = pointer(response.body, probe.rolePointer);
      if (!scalar(role)) throw new Error('The identity probe did not return the expected role.');
      identity.role = role;
    }
    if (session.status.identity && JSON.stringify(session.status.identity) !== JSON.stringify(identity)) {
      session.status.connected = false; session.status.identity = undefined;
      throw new Error('The account identity or role changed. Revalidate this binding and the case preconditions.');
    }
    session.status.identity = identity; session.status.connected = true; session.status.error = undefined;
    return identity;
  }

  setSecrets(key: string, values: { username?: string; password?: string }): Record<string, string> {
    const session = this.get(key); const refs: Record<string, string> = {};
    for (const [kind, value] of Object.entries(values)) {
      if (!value) continue;
      this.remember(value);
      const ref = `credential_${randomUUID()}`;
      session.secretRefs.set(ref, { kind, value }); refs[kind] = ref;
    }
    return refs;
  }

  async snapshot(key: string): Promise<{ url: string; text: string; fields: { ref: string; tag: string; type: string; label: string }[] }> {
    const session = this.get(key); const page = session.page;
    if (!page || page.isClosed()) throw new Error('Open an account browser before using browser tools.');
    if (originOf(page.url()) !== session.status.origin) throw new Error('Login is on another origin. Complete this step manually in the browser.');
    session.fields.clear(); session.generation += 1;
    const locator = page.locator('input, textarea, select, button, a[href], [role="button"]');
    const fields: { ref: string; tag: string; type: string; label: string }[] = [];
    const count = Math.min(await locator.count(), 60);
    for (let i = 0; i < count; i += 1) {
      const field = locator.nth(i);
      if (!await field.isVisible().catch(() => false)) continue;
      const info = await field.evaluate(element => {
        const input = element as HTMLInputElement;
        return { tag: element.tagName.toLowerCase(), type: element.getAttribute('type') ?? '', label: (input.labels?.[0]?.textContent || element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.getAttribute('name') || element.textContent || '').trim().slice(0, 180) };
      });
      const ref = `g${session.generation}e${i}`;
      session.fields.set(ref, field); fields.push({ ref, ...info });
    }
    const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    return this.redact({ url: page.url(), text: text.slice(0, 6000), fields });
  }

  async action(key: string, action: BrowserAction): Promise<{ state: string; message?: string }> {
    try { return await this.performAction(key, action); }
    catch (error) { throw new Error(this.redactText(error instanceof Error ? error.message : String(error))); }
  }
  private async performAction(key: string, action: BrowserAction): Promise<{ state: string; message?: string }> {
    const session = this.get(key); const page = session.page;
    if (!page || page.isClosed()) throw new Error('Open an account browser first.');
    if (action.type === 'handoff') return { state: 'needs_user', message: 'Complete the current step in the browser, then verify the account.' };
    if (action.type === 'navigate') {
      if (!action.url) throw new Error('A navigation URL is required.');
      await page.goto(scopedURL(session.status.origin, action.url), { waitUntil: 'domcontentloaded', timeout: 30000 });
      session.fields.clear(); return { state: 'done' };
    }
    if (originOf(page.url()) !== session.status.origin) throw new Error('Complete cross-origin login manually. Browser tools are bound to the selected origin.');
    const locator = action.ref ? session.fields.get(action.ref) : undefined;
    if (!locator) throw new Error('The page reference is missing or stale. Take a new snapshot.');
    if (action.type === 'click') {
      const destination = await locator.evaluate(element => {
        const link = element.closest('a[href]') as HTMLAnchorElement | null;
        const control = element as HTMLButtonElement;
        return link?.href || (control.form && (control.type === 'submit' || element.tagName === 'INPUT') ? control.form.action : null);
      });
      if (destination && originOf(destination) !== session.status.origin) throw new Error('This action goes to another origin. Continue manually.');
      await locator.click({ timeout: 10000 });
    } else if (action.type === 'fillSecret') {
      const secret = action.secretRef ? session.secretRefs.get(action.secretRef) : undefined;
      if (!secret) throw new Error('This credential reference is unavailable for this account.');
      const input = await locator.evaluate(element => ({ type: (element as HTMLInputElement).type, tag: element.tagName, action: (element as HTMLInputElement).form?.action }));
      if (input.action && originOf(input.action) !== session.status.origin) throw new Error('Credentials cannot be entered into a cross-origin form.');
      if (secret.kind === 'password' && input.type !== 'password') throw new Error('Password references can only fill password inputs. Complete unusual login forms manually.');
      if (secret.kind === 'username' && !['email', 'text', 'tel'].includes(input.type)) throw new Error('The username field type is unsupported.');
      await locator.fill(secret.value, { timeout: 10000 });
    } else if (action.type === 'fill') {
      const type = await locator.getAttribute('type');
      if (type === 'password') throw new Error('Use a credential reference for password fields.');
      await locator.fill(action.value ?? '', { timeout: 10000 });
    } else if (action.type === 'press') {
      if (!['Enter', 'Tab', 'Escape'].includes(action.value ?? '')) throw new Error('Unsupported key.');
      await locator.press(action.value!, { timeout: 10000 });
    } else throw new Error('Unsupported browser action.');
    return { state: 'done' };
  }

  recording(key: string, enabled: boolean): void { this.get(key).recording = enabled; }
  traffic(key: string): { log: { version: '1.2'; entries: Json[] } } { return { log: { version: '1.2', entries: this.redact(this.get(key).entries) } }; }
  private addEntry(session: Session, request: ResolvedRequest, response: HttpResponse, startedDateTime: string): void {
    if (session.entries.length >= 250) return;
    const actorId = session.status.id.includes(':') ? session.status.id.slice(session.status.id.indexOf(':') + 1) : session.status.id;
    session.entries.push(this.redact({ actorId, startedDateTime, time: 0, request: { method: request.method, url: request.url, headers: Object.entries(request.headers).map(([name, value]) => ({ name, value })), ...(request.body !== undefined ? { postData: { mimeType: 'application/json', text: JSON.stringify(this.redact(request.body)) } } : {}) }, response: { status: response.status, headers: Object.entries(response.headers).map(([name, value]) => ({ name, value })), content: { mimeType: 'application/json', text: JSON.stringify(this.redact(response.body)) } } }) as Json);
  }
  private async recordBrowserResponse(session: Session, response: import('playwright').Response): Promise<void> {
    if (!session.recording || originOf(response.url()) !== session.status.origin) return;
    const request = response.request();
    if (!['xhr', 'fetch', 'document'].includes(request.resourceType())) return;
    const requestHeaders = await request.allHeaders(); const responseHeaders = await response.allHeaders();
    this.rememberHeaders(requestHeaders); this.rememberHeaders(responseHeaders);
    if (Number(responseHeaders['content-length'] ?? 0) > MAX_BODY) return;
    const raw = await response.body(); if (raw.byteLength > MAX_BODY) return;
    let body: Json = raw.toString('utf8');
    try { body = JSON.parse(body as string) as Json; } catch { /* Text is valid evidence too. */ }
    let requestBody: Json | undefined;
    const postData = request.postData();
    if (postData) { try { requestBody = JSON.parse(postData) as Json; } catch { requestBody = postData.replace(/((?:password|token|secret|code)=[^&]*)/gi, '[REDACTED]'); } }
    this.rememberBody(requestBody); this.rememberBody(body);
    this.addEntry(session, { url: request.url(), method: request.method(), headers: requestHeaders, body: requestBody }, { status: response.status(), headers: responseHeaders, body }, new Date().toISOString());
  }
  async close(key?: string): Promise<void> {
    const keys = key ? [key] : [...this.sessions.keys()];
    for (const id of keys) {
      const session = this.sessions.get(id); if (!session) continue;
      this.sessions.delete(id);
      if (session.browser) await session.browser.close().catch(() => {});
      else await session.api.dispose().catch(() => {});
      session.secretRefs.clear(); session.fields.clear(); session.entries.length = 0;
    }
    if (!this.sessions.size) this.secrets.clear();
  }
}
