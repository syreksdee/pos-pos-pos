export type Role = "admin" | "kasir" | "gudang";

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  cost: number;
  stock: number;
  min_stock: number;
  active: boolean;
}

export interface SaleItem {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  subtotal: number;
}

export interface Sale {
  id: string;
  receipt_number: string;
  created_at: string;
  total: number;
  amount_received: number;
  change_due: number;
  payment_method: "tunai" | "qris" | "transfer";
  cashier_name: string;
  items: SaleItem[];
}

export interface InventoryMovement {
  id: string;
  created_at: string;
  product_name: string;
  sku: string;
  movement_type: "masuk" | "koreksi" | "penjualan";
  quantity_change: number;
  stock_after: number;
  note: string | null;
  actor_name: string;
}
