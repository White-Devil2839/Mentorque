const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

interface Options {
  method?: string;
  body?: unknown;
  token?: string | null;
}

export async function api<T = any>(
  path: string,
  { method = "GET", body, token }: Options = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || `Request failed (${res.status})`);
  }
  return data as T;
}
