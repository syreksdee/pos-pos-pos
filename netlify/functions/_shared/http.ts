import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { HandlerEvent } from "@netlify/functions";
import type { Profile, Role } from "../../../src/lib/types";

export interface RequestContext {
  db: SupabaseClient;
  profile: Profile;
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export const json = (statusCode: number, data: unknown): ApiResponse => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  body: JSON.stringify(data),
});

export const fail = (statusCode: number, message: string): ApiResponse =>
  json(statusCode, { error: message });

export const hasRole = (role: Role, allowed: readonly Role[]) => allowed.includes(role);

export async function authorize(
  event: HandlerEvent,
  allowed: readonly Role[],
): Promise<{ context?: RequestContext; response?: ApiResponse }> {
  const authorization = event.headers.authorization ?? event.headers.Authorization;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { response: fail(401, "Silakan masuk untuk melanjutkan.") };

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
    return { response: fail(500, "Layanan belum dikonfigurasi. Hubungi administrator.") };
  }

  const db = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await db.auth.getUser(token);
  if (authError || !authData.user) {
    return { response: fail(401, "Sesi masuk tidak valid atau sudah berakhir.") };
  }

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Unable to load the authenticated user's profile:", profileError.message);
    return { response: fail(500, "Profil pengguna tidak dapat dimuat.") };
  }
  if (!profile) return { response: fail(403, "Akun belum memiliki akses ke aplikasi.") };
  if (!hasRole(profile.role as Role, allowed)) {
    return { response: fail(403, "Peran akun Anda tidak diizinkan untuk tindakan ini.") };
  }

  return { context: { db, profile: profile as Profile } };
}

export function bodyObject(event: HandlerEvent): Record<string, unknown> | null {
  if (!event.body) return null;
  try {
    const body: unknown = JSON.parse(event.body);
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function validText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

export function validMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export interface CheckoutLine {
  product_id: string;
  quantity: number;
}

export function isValidCheckoutItems(value: unknown): value is CheckoutLine[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 100 &&
    value.every((item) =>
      item !== null &&
      typeof item === "object" &&
      isUuid((item as Record<string, unknown>).product_id) &&
      Number.isSafeInteger((item as Record<string, unknown>).quantity) &&
      ((item as Record<string, number>).quantity > 0) &&
      ((item as Record<string, number>).quantity <= 100_000),
    );
}

export function validDateRange(from: string | null, to: string | null) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !to || !datePattern.test(from) || !datePattern.test(to)) return false;
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T23:59:59.999Z`);
  return Number.isFinite(start) && Number.isFinite(end) &&
    new Date(start).toISOString().slice(0, 10) === from &&
    new Date(end).toISOString().slice(0, 10) === to &&
    start <= end &&
    end - start <= 366 * 24 * 60 * 60 * 1000;
}

export const expectedDatabaseError = (error: { code?: string; message?: string }) => {
  if (error.code === "23505") return fail(409, "SKU atau nomor transaksi sudah digunakan.");
  if (error.code === "P0002") return fail(404, "Data yang diminta tidak ditemukan.");
  if (error.code === "42501") return fail(403, "Akun Anda tidak diizinkan melakukan tindakan ini.");
  if (error.code === "22023") return fail(400, error.message || "Data yang dikirim tidak valid.");
  return null;
}
