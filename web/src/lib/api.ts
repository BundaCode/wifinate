const TOKEN_KEY = 'wifinate.token';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string | null) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* mode privat */ }
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public fields?: Record<string, string>) { super(message); }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers, body });
  } catch {
    throw new ApiError('Tidak bisa terhubung ke server Wifinate. Periksa koneksi internet Anda.', 0);
  }
  if (res.status === 401 && token) {
    setToken(null);
    window.dispatchEvent(new Event('wifinate:logout'));
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(data?.message ?? `Terjadi kesalahan (${res.status})`, res.status, data?.fields);
  return data as T;
}

/** Unduh / buka file (PDF, CSV) dengan token login. */
export async function openFile(path: string, opts: { download?: string } = {}) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.message ?? 'Gagal membuka file', res.status);
  }
  const url = URL.createObjectURL(await res.blob());
  if (opts.download) {
    const a = document.createElement('a');
    a.href = url; a.download = opts.download; a.click();
  } else {
    window.open(url, '_blank');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const tzOffset = () => -new Date().getTimezoneOffset();
