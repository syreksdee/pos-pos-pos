import type { Handler } from "@netlify/functions";
import {
  authorize, bodyObject, expectedDatabaseError, fail, isUuid, json, validMoney, validText,
} from "./_shared/http";

const staffRoles = ["admin", "gudang"] as const;
const readRoles = ["admin", "kasir", "gudang"] as const;

export const handler: Handler = async (event) => {
  const method = event.httpMethod;
  const access = await authorize(event, method === "GET" ? readRoles : staffRoles);
  if (access.response) return access.response;
  const { db, profile } = access.context!;

  if (method === "GET") {
    let query = db.from("products").select("*").order("name");
    if (profile.role === "kasir") query = query.eq("active", true);
    const { data, error } = await query;
    if (error) {
      console.error("Unable to list products:", error.message);
      return fail(500, "Daftar produk tidak dapat dimuat.");
    }
    return json(200, data);
  }

  const body = bodyObject(event);
  if (!body) return fail(400, "Isi permintaan tidak valid.");
  const values = {
    sku: typeof body.sku === "string" ? body.sku.trim() : "",
    name: typeof body.name === "string" ? body.name.trim() : "",
    category: typeof body.category === "string" ? body.category.trim() : "Umum",
    unit: typeof body.unit === "string" ? body.unit.trim() : "pcs",
    price: body.price,
    cost: body.cost,
    min_stock: body.min_stock,
  };
  if (!validText(values.sku, 1, 64) || !validText(values.name, 1, 160) ||
      !validText(values.category, 1, 80) || !validMoney(values.price) ||
      !validText(values.unit, 1, 24) ||
      !validMoney(values.cost) || !Number.isSafeInteger(values.min_stock) ||
      Number(values.min_stock) < 0 || Number(values.min_stock) > 1_000_000) {
    return fail(400, "Periksa kembali SKU, nama, kategori, harga, modal, dan batas stok.");
  }

  if (method === "POST") {
    const { data, error } = await db.from("products").insert(values).select("*").single();
    if (error) return expectedDatabaseError(error) ?? fail(500, "Produk tidak dapat disimpan.");
    return json(201, data);
  }

  if (method === "PATCH") {
    if (!isUuid(body.id)) return fail(400, "ID produk tidak valid.");
    const id = body.id;
    const { data, error } = await db.from("products")
      .update({ ...values, active: body.active !== false, updated_at: new Date().toISOString() })
      .eq("id", id).select("*").maybeSingle();
    if (error) return expectedDatabaseError(error) ?? fail(500, "Produk tidak dapat diperbarui.");
    if (!data) return fail(404, "Produk tidak ditemukan.");
    return json(200, data);
  }

  return fail(405, "Metode permintaan tidak didukung.");
};
