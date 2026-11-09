begin;

select plan(16);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'admin-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'kasir-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'gudang-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, full_name, role) values
  ('00000000-0000-4000-8000-000000000001', 'Admin Uji', 'admin'),
  ('00000000-0000-4000-8000-000000000002', 'Kasir Uji', 'kasir'),
  ('00000000-0000-4000-8000-000000000003', 'Gudang Uji', 'gudang');

insert into public.products (id, sku, name, category, price, cost, stock)
values ('10000000-0000-4000-8000-000000000001', 'TEST-001', 'Produk Uji', 'Uji', 10000, 6000, 3);

select ok(
  not has_function_privilege('authenticated',
    'public.record_sale(uuid,jsonb,public.payment_method,numeric)', 'EXECUTE'),
  'authenticated users cannot call the privileged checkout RPC'
);
select ok(
  has_function_privilege('service_role',
    'public.record_sale(uuid,jsonb,public.payment_method,numeric)', 'EXECUTE'),
  'the server service role can call the checkout RPC'
);
select throws_ok(
  $$select public.record_sale(
    '00000000-0000-4000-8000-000000000003',
    '[{"product_id":"10000000-0000-4000-8000-000000000001","quantity":1}]',
    'qris', null
  )$$,
  '42501', 'Akun tidak memiliki akses kasir.',
  'warehouse role cannot check out'
);
select throws_ok(
  $$select public.record_sale(
    '00000000-0000-4000-8000-000000000002',
    '[{"product_id":"10000000-0000-4000-8000-000000000001","quantity":4}]',
    'tunai', 50000
  )$$,
  '22023', 'Stok Produk Uji tidak mencukupi (tersedia 3).',
  'checkout rejects a quantity above stock'
);
select is(
  (select stock from public.products where id = '10000000-0000-4000-8000-000000000001'),
  3,
  'rejected checkout leaves stock unchanged'
);

create temporary table checkout_result (sale_id uuid);
insert into checkout_result
select public.record_sale(
  '00000000-0000-4000-8000-000000000002',
  '[{"product_id":"10000000-0000-4000-8000-000000000001","quantity":2}]',
  'tunai', 25000
);
select ok((select sale_id is not null from checkout_result), 'valid checkout creates a sale');
select is(
  (select stock from public.products where id = '10000000-0000-4000-8000-000000000001'),
  1,
  'checkout decrements stock atomically'
);
select is(
  (select total from public.sales where id = (select sale_id from checkout_result)),
  20000::numeric,
  'sale total uses the stored product price'
);
select is(
  (select change_due from public.sales where id = (select sale_id from checkout_result)),
  5000::numeric,
  'cash change is recorded'
);
select is(
  (select count(*)::integer from public.sale_items where sale_id = (select sale_id from checkout_result)),
  1,
  'checkout records sale line items'
);
select is(
  (select quantity_change from public.inventory_movements
    where sale_id = (select sale_id from checkout_result)),
  -2,
  'checkout records the matching stock movement'
);
select is(
  (select sum((unit_price - unit_cost) * quantity) from public.sale_items
    where sale_id = (select sale_id from checkout_result)),
  8000::numeric,
  'profit report basis is preserved on sale items'
);
select is(
  public.record_stock_movement(
    '00000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    4, 'masuk', 'Penerimaan uji'
  ),
  5,
  'warehouse user can atomically receive stock'
);
select is(
  public.record_stock_movement(
    '00000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    -2, 'koreksi', 'Hitung fisik'
  ),
  3,
  'warehouse user can make a signed stock correction'
);
select throws_ok(
  $$select public.record_stock_movement(
    '00000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    -5, 'koreksi', 'Jumlah melebihi stok'
  )$$,
  '22023', 'Stok tidak dapat menjadi negatif.',
  'stock correction cannot create negative stock'
);
select is(
  (select stock from public.products where id = '10000000-0000-4000-8000-000000000001'),
  3,
  'rejected stock correction leaves the balance unchanged'
);

select * from finish();
rollback;
