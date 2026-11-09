import type { Handler } from "@netlify/functions";
import type { InventoryMovement } from "../../src/lib/types";
import { authorize, bodyObject, expectedDatabaseError, fail, isUuid, json, validText } from "./_shared/http";

const roles = ["admin", "gudang"] as const;

export const handler: Handler = async (event) => {
  const access = await authorize(event, roles);
  if (access.response) return access.response;
  const { db, profile } = access.context!;

  if (event.httpMethod === "GET") {
    const { data: movements, error } = await db.from("inventory_movements")
      .select("id, created_at, movement_type, quantity_change, stock_after, note, product_id, actor_id")
      .order("created_at", { ascending: false }).limit(200);
    if (error) {
      console.error("Unable to list inventory movements:", error.message);
      return fail(500, "Riwayat stok tidak dapat dimuat.");
    }
    const productIds = [...new Set(movements.map((item) => item.product_id))];
    const actorIds = [...new Set(movements.map((item) => item.actor_id))];
    const [{ data: products, error: productsError }, { data: actors, error: actorsError }] =
      await Promise.all([
        db.from("products").select("id, name, sku").in("id", productIds),
        db.from("profiles").select("id, full_name").in("id", actorIds),
      ]);
    if (productsError || actorsError) {
      console.error("Unable to load inventory movement details:", productsError?.message, actorsError?.message);
      return fail(500, "Rincian riwayat stok tidak dapat dimuat.");
    }
    const productMap = new Map((products ?? []).map((product) => [product.id, product]));
    const actorMap = new Map((actors ?? []).map((actor) => [actor.id, actor.full_name]));
    const result: InventoryMovement[] = movements.map((movement) => {
      const product = productMap.get(movement.product_id);
      return {
        id: movement.id,
        created_at: movement.created_at,
        movement_type: movement.movement_type,
        quantity_change: movement.quantity_change,
        stock_after: movement.stock_after,
        note: movement.note,
        product_name: product?.name ?? "Produk dihapus",
        sku: product?.sku ?? "-",
        actor_name: actorMap.get(movement.actor_id) ?? "Pengguna",
      };
    });
    return json(200, result);
  }

  if (event.httpMethod !== "POST") return fail(405, "Metode permintaan tidak didukung.");
  const body = bodyObject(event);
  if (!body || !isUuid(body.product_id) ||
      (body.type !== "masuk" && body.type !== "koreksi") ||
      !Number.isSafeInteger(body.quantity) || Number(body.quantity) === 0 ||
      Math.abs(Number(body.quantity)) > 1_000_000 ||
      (body.type === "masuk" && Number(body.quantity) < 1) ||
      (body.note !== undefined && body.note !== null && !validText(body.note, 0, 500))) {
    return fail(400, "Periksa kembali produk, jenis perubahan, jumlah, dan catatan.");
  }
  const { data, error } = await db.rpc("record_stock_movement", {
    p_actor_id: profile.id,
    p_product_id: body.product_id,
    p_quantity_change: body.quantity,
    p_movement_type: body.type,
    p_note: typeof body.note === "string" ? body.note.trim() : null,
  });
  if (error) return expectedDatabaseError(error) ?? fail(500, "Perubahan stok tidak dapat disimpan.");
  return json(201, { stock: data });
};
