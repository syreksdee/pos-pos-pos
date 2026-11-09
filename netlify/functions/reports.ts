import type { Handler } from "@netlify/functions";
import { authorize, fail, json, validDateRange } from "./_shared/http";
import { aggregateSales } from "./_shared/reports";

const roles = ["admin"] as const;

export const handler: Handler = async (event) => {
  const access = await authorize(event, roles);
  if (access.response) return access.response;
  if (event.httpMethod !== "GET") return fail(405, "Metode permintaan tidak didukung.");

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = event.queryStringParameters?.from ?? monthAgo;
  const to = event.queryStringParameters?.to ?? today;
  if (!validDateRange(from, to)) {
    return fail(400, "Rentang tanggal tidak valid atau melebihi 366 hari.");
  }
  const { db } = access.context!;
  const start = `${from}T00:00:00.000Z`;
  const end = `${to}T23:59:59.999Z`;

  const [
    { data: products, error: productsError },
    { data: sales, error: salesError },
    { data: movements, error: movementsError },
  ] = await Promise.all([
    db.from("products")
      .select("id, sku, name, category, unit, price, cost, stock, min_stock, active")
      .order("name"),
    db.from("sales")
      .select("id, receipt_number, created_at, total, payment_method, amount_received, change_due, cashier_id")
      .gte("created_at", start).lte("created_at", end)
      .order("created_at", { ascending: false }).limit(5000),
    db.from("inventory_movements")
      .select("id, created_at, movement_type, quantity_change, stock_after, note, product_id, actor_id")
      .gte("created_at", start).lte("created_at", end)
      .order("created_at", { ascending: false }).limit(5000),
  ]);
  if (productsError || salesError || movementsError) {
    console.error("Unable to load report data:", productsError?.message, salesError?.message, movementsError?.message);
    return fail(500, "Laporan tidak dapat dimuat.");
  }

  const saleIds = (sales ?? []).map((sale) => sale.id);
  const [{ data: items, error: itemsError }, { data: profiles, error: profilesError }] =
    await Promise.all([
      saleIds.length
        ? db.from("sale_items")
          .select("id, sale_id, product_id, product_name, sku, quantity, unit_price, unit_cost, subtotal")
          .in("sale_id", saleIds)
        : Promise.resolve({ data: [], error: null }),
      db.from("profiles").select("id, full_name"),
    ]);
  if (itemsError || profilesError) {
    console.error("Unable to load report details:", itemsError?.message, profilesError?.message);
    return fail(500, "Rincian laporan tidak dapat dimuat.");
  }

  const profileNames = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
  const productById = new Map((products ?? []).map((product) => [product.id, product]));
  const aggregate = aggregateSales(sales ?? [], items ?? []);

  return json(200, {
    period: { from, to },
    totals: {
      sales_count: sales?.length ?? 0,
      revenue: aggregate.revenue,
      profit: aggregate.profit,
      items_sold: aggregate.items_sold,
      low_stock_count: products?.filter((product) => product.active && product.stock <= product.min_stock).length ?? 0,
    },
    sales: (sales ?? []).map((sale) => ({
      ...sale,
      cashier_name: profileNames.get(sale.cashier_id) ?? "Pengguna",
      items: aggregate.item_by_sale.get(sale.id) ?? [],
    })),
    top_products: aggregate.top_products,
    stock: (products ?? []).map((product) => ({
      ...product,
      status: product.stock === 0 ? "Habis" : product.stock <= product.min_stock ? "Menipis" : "Aman",
    })),
    movements: (movements ?? []).map((movement) => {
      const product = productById.get(movement.product_id);
      return {
        ...movement,
        product_name: product?.name ?? "Produk dihapus",
        sku: product?.sku ?? "-",
        actor_name: profileNames.get(movement.actor_id) ?? "Pengguna",
      };
    }),
  });
};
