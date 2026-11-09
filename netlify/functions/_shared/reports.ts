export interface ReportSale {
  id: string;
  total: number;
}

export interface ReportItem {
  sale_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  subtotal: number;
}

export function aggregateSales(sales: ReportSale[], items: ReportItem[]) {
  const soldByProduct = new Map<string, { name: string; sku: string; quantity: number; revenue: number }>();
  const itemBySale = new Map<string, ReportItem[]>();
  let profit = 0;
  for (const item of items) {
    const previous = soldByProduct.get(item.product_id) ?? {
      name: item.product_name,
      sku: item.sku,
      quantity: 0,
      revenue: 0,
    };
    previous.quantity += item.quantity;
    previous.revenue += Number(item.subtotal);
    soldByProduct.set(item.product_id, previous);
    itemBySale.set(item.sale_id, [...(itemBySale.get(item.sale_id) ?? []), item]);
    profit += (Number(item.unit_price) - Number(item.unit_cost)) * item.quantity;
  }
  return {
    revenue: sales.reduce((total, sale) => total + Number(sale.total), 0),
    profit,
    items_sold: items.reduce((total, item) => total + item.quantity, 0),
    item_by_sale: itemBySale,
    top_products: [...soldByProduct.entries()]
      .map(([product_id, value]) => ({ product_id, ...value }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 8),
  };
}
