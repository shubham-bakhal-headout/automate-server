const BASE = import.meta.env.VITE_API_URL ?? '';

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  const json = await res.json() as { data: T };
  return json.data;
}

export async function apiRequest(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res;
}
