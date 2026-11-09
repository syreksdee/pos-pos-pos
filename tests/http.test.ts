import { describe, expect, it } from "vitest";
import { hasRole, isValidCheckoutItems, validDateRange } from "../netlify/functions/_shared/http";

const productId = "123e4567-e89b-42d3-a456-426614174000";

describe("authorization and request validation", () => {
  it("allows only explicitly assigned roles", () => {
    expect(hasRole("admin", ["admin"])).toBe(true);
    expect(hasRole("kasir", ["admin", "kasir"])).toBe(true);
    expect(hasRole("gudang", ["admin", "kasir"])).toBe(false);
  });

  it("accepts valid checkout lines and rejects malformed or unsafe quantities", () => {
    expect(isValidCheckoutItems([{ product_id: productId, quantity: 2 }])).toBe(true);
    expect(isValidCheckoutItems([])).toBe(false);
    expect(isValidCheckoutItems([{ product_id: productId, quantity: 0 }])).toBe(false);
    expect(isValidCheckoutItems([{ product_id: "not-an-id", quantity: 1 }])).toBe(false);
    expect(isValidCheckoutItems([{ product_id: productId, quantity: 1.5 }])).toBe(false);
  });

  it("limits report date ranges to valid periods of at most 366 days", () => {
    expect(validDateRange("2026-01-01", "2026-01-31")).toBe(true);
    expect(validDateRange("2026-02-30", "2026-03-01")).toBe(false);
    expect(validDateRange("2026-03-01", "2026-02-28")).toBe(false);
    expect(validDateRange("2025-01-01", "2026-02-01")).toBe(false);
  });
});
