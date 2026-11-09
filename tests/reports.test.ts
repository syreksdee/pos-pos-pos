import { describe, expect, it } from "vitest";
import { aggregateSales } from "../netlify/functions/_shared/reports";

describe("sales report aggregation", () => {
  it("calculates revenue, gross profit, item counts, and product ranking from stored sale items", () => {
    const report = aggregateSales(
      [{ id: "sale-1", total: 25000 }, { id: "sale-2", total: 10000 }],
      [
        {
          sale_id: "sale-1", product_id: "coffee", product_name: "Kopi", sku: "K01",
          quantity: 2, unit_price: 10000, unit_cost: 7000, subtotal: 20000,
        },
        {
          sale_id: "sale-1", product_id: "bread", product_name: "Roti", sku: "R01",
          quantity: 1, unit_price: 5000, unit_cost: 3000, subtotal: 5000,
        },
        {
          sale_id: "sale-2", product_id: "coffee", product_name: "Kopi", sku: "K01",
          quantity: 1, unit_price: 10000, unit_cost: 7000, subtotal: 10000,
        },
      ],
    );

    expect(report.revenue).toBe(35000);
    expect(report.profit).toBe(11000);
    expect(report.items_sold).toBe(4);
    expect(report.top_products[0]).toMatchObject({
      product_id: "coffee",
      quantity: 3,
      revenue: 30000,
    });
    expect(report.item_by_sale.get("sale-1")).toHaveLength(2);
  });
});
