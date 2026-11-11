import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function acquireWorkspace(workspace: string): () => void {
  mkdirSync(workspace, { recursive: true });
  const path = join(workspace, 'owner.lock');
  if (existsSync(path)) {
    let active = true;
    try { const old = JSON.parse(readFileSync(path, 'utf8')); try { process.kill(old.pid, 0); } catch (error: any) { active = error.code !== 'ESRCH'; } } catch { /* An unreadable lock is not permission to steal a workspace. */ }
    if (active) throw new Error('This workspace is already in use. Connect to its running local service or select another workspace.');
    unlinkSync(path);
  }
  const owner = randomUUID();
  writeFileSync(path, JSON.stringify({ pid: process.pid, owner }), { flag: 'wx', mode: 0o600 });
  let released = false;
  return () => {
    if (released) return; released = true;
    try { if (JSON.parse(readFileSync(path, 'utf8')).owner === owner) unlinkSync(path); } catch { /* Never remove another process's lock. */ }
  };
}
export async function connectRuntime(workspace: string): Promise<undefined | ((path: string, method?: string, body?: unknown) => Promise<any>)> {
  const file = join(workspace, 'runtime.json');
  if (!existsSync(file)) return undefined;
  const runtime = JSON.parse(readFileSync(file, 'utf8'));
  const url = new URL(runtime.origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !/^[a-f0-9]{64}$/.test(runtime.token)) throw new Error('Workspace runtime record is not a valid local endpoint');
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${url.origin}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(method === 'GET' ? 5000 : 120000), headers: { authorization: `Bearer ${runtime.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw Object.assign(new Error(value?.error ?? 'Local service operation failed'), { statusCode: response.status });
    return value;
  };
  try { await call('/api/state'); return call; }
  catch (error: any) {
    if (error.statusCode) throw error;
    // A dead runtime file is harmless; acquireWorkspace still refuses a live owner's lock.
    return undefined;
  }
}
