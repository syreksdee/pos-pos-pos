import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
  })
  : null;

export async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload !== null && typeof payload === "object" &&
      "error" in payload && typeof payload.error === "string"
      ? payload.error
      : "Permintaan tidak dapat diproses.";
    throw new Error(message);
  }
  return payload as T;
}

export const apiPost = <T>(path: string, token: string, body: unknown) =>
  api<T>(path, token, { method: "POST", body: JSON.stringify(body) });

export const apiPatch = <T>(path: string, token: string, body: unknown) =>
  api<T>(path, token, { method: "PATCH", body: JSON.stringify(body) });
