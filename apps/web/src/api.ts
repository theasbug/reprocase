const query = new URLSearchParams(window.location.hash.slice(1));
const incoming = query.get('token');
if (incoming) {
  sessionStorage.setItem('reprocase.token', incoming);
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

export function setToken(token: string) { sessionStorage.setItem('reprocase.token', token.trim()); }
export function hasToken() { return !!sessionStorage.getItem('reprocase.token'); }

export async function api<T = unknown>(path: string, body?: unknown, method?: string): Promise<T> {
  let response: Response;
  try { response = await fetch(path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      Authorization: `Bearer ${sessionStorage.getItem('reprocase.token') ?? ''}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }); } catch { throw new Error('Local service connection failed / Yerel servise bağlanılamadı. Keep ReproCase open, then reopen this session. No action was retried.'); }
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof data === 'string' ? data : data.message ?? data.error ?? JSON.stringify(data);
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
  return data as T;
}

export async function authenticatedImage(path: string) {
  const response = await fetch(path, {headers:{Authorization:`Bearer ${sessionStorage.getItem('reprocase.token')??''}`}});
  if(!response.ok)throw new Error('Screenshot unavailable');
  return URL.createObjectURL(await response.blob());
}

export function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
