import type { Handler } from "@netlify/functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sale, SaleItem } from "../../src/lib/types";
import {
  authorize, bodyObject, expectedDatabaseError, fail, isValidCheckoutItems, json,
} from "./_shared/http";

const roles = ["admin", "kasir"] as const;

async function loadSale(db: SupabaseClient, id: string) {
  const { data: sale, error } = await db.from("sales")
    .select("id, receipt_number, created_at, total, payment_method, amount_received, change_due, cashier_id")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Unable to load sale.");
  if (!sale) return null;
  const [{ data: items, error: itemsError }, { data: cashier, error: cashierError }] = await Promise.all([
    db.from("sale_items")
      .select("id, product_id, product_name, sku, quantity, unit_price, unit_cost, subtotal")
      .eq("sale_id", id).order("product_name"),
    db.from("profiles").select("full_name").eq("id", sale.cashier_id).single(),
  ]);
  if (itemsError || cashierError) throw new Error("Unable to load sale details.");
  return {
    ...sale,
    cashier_name: cashier.full_name,
    items: items as SaleItem[],
  } as Sale;
}

export const handler: Handler = async (event) => {
  const access = await authorize(event, roles);
  if (access.response) return access.response;
  const { db, profile } = access.context!;

  if (event.httpMethod === "GET") {
    const id = event.queryStringParameters?.id;
    try {
      if (id) {
        const sale = await loadSale(db, id);
        if (!sale) return fail(404, "Transaksi tidak ditemukan.");
        if (profile.role === "kasir") {
          const { data: owner, error: ownerError } = await db.from("sales")
            .select("cashier_id").eq("id", id).single();
          if (ownerError) {
            console.error("Unable to verify sale ownership:", ownerError.message);
            return fail(500, "Kepemilikan transaksi tidak dapat diperiksa.");
          }
          if (owner?.cashier_id !== profile.id) return fail(403, "Anda hanya dapat melihat transaksi sendiri.");
        }
        return json(200, sale);
      }

      let query = db.from("sales")
        .select("id, receipt_number, created_at, total, payment_method, amount_received, change_due, cashier_id")
        .order("created_at", { ascending: false }).limit(100);
      if (profile.role === "kasir") query = query.eq("cashier_id", profile.id);
      const { data: sales, error } = await query;
      if (error) {
        console.error("Unable to list sales:", error.message);
        return fail(500, "Riwayat penjualan tidak dapat dimuat.");
      }
      const cashierIds = [...new Set(sales.map((sale) => sale.cashier_id))];
      const { data: profiles, error: profilesError } = cashierIds.length
        ? await db.from("profiles").select("id, full_name").in("id", cashierIds)
        : { data: [] };
      if (profilesError) {
        console.error("Unable to load cashier names:", profilesError.message);
        return fail(500, "Nama kasir tidak dapat dimuat.");
      }
      const cashiers = new Map((profiles ?? []).map((item) => [item.id, item.full_name]));
      return json(200, sales.map((sale) => ({
        ...sale,
        cashier_name: cashiers.get(sale.cashier_id) ?? "Pengguna",
      })));
    } catch (error) {
      console.error("Unable to load sale details:", error);
      return fail(500, "Detail transaksi tidak dapat dimuat.");
    }
  }

  if (event.httpMethod !== "POST") return fail(405, "Metode permintaan tidak didukung.");
  const body = bodyObject(event);
  if (!body || !isValidCheckoutItems(body.items) ||
      (body.payment_method !== "tunai" && body.payment_method !== "qris" && body.payment_method !== "transfer") ||
      (body.payment_method === "tunai" &&
        (!Number.isSafeInteger(body.amount_received) || Number(body.amount_received) < 0 ||
          Number(body.amount_received) > 1_000_000_000)) ||
      (body.payment_method !== "tunai" && body.amount_received !== undefined)) {
    return fail(400, "Keranjang atau metode pembayaran tidak valid.");
  }
  const { data: id, error } = await db.rpc("record_sale", {
    p_cashier_id: profile.id,
    p_items: body.items,
    p_payment_method: body.payment_method,
    p_amount_received: body.payment_method === "tunai" ? body.amount_received : null,
  });
  if (error) return expectedDatabaseError(error) ?? fail(500, "Transaksi gagal disimpan.");
  try {
    const sale = await loadSale(db, id);
    if (!sale) return fail(500, "Transaksi tersimpan tetapi tanda terima tidak dapat dimuat.");
    return json(201, sale);
  } catch (error) {
    console.error("Sale committed, but the receipt could not be loaded:", error);
    return fail(500, "Transaksi tersimpan, tetapi tanda terima tidak dapat dimuat.");
  }
};
