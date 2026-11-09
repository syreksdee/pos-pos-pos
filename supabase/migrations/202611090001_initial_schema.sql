create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'kasir', 'gudang');
create type public.payment_method as enum ('tunai', 'qris', 'transfer');
create type public.inventory_movement_type as enum ('masuk', 'koreksi', 'penjualan');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  role public.app_role not null,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (length(trim(sku)) between 1 and 64),
  name text not null check (length(trim(name)) between 1 and 160),
  category text not null default 'Umum' check (length(trim(category)) between 1 and 80),
  unit text not null default 'pcs' check (length(trim(unit)) between 1 and 24),
  price numeric(14, 2) not null check (price >= 0),
  cost numeric(14, 2) not null check (cost >= 0),
  stock integer not null default 0 check (stock >= 0),
  min_stock integer not null default 5 check (min_stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.sale_receipt_sequence;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique default
    ('POS-' || to_char(now(), 'YYYYMMDD') || '-' ||
      lpad(nextval('public.sale_receipt_sequence')::text, 6, '0')),
  cashier_id uuid not null references public.profiles (id),
  total numeric(14, 2) not null check (total >= 0),
  payment_method public.payment_method not null,
  amount_received numeric(14, 2) not null default 0 check (amount_received >= 0),
  change_due numeric(14, 2) not null default 0 check (change_due >= 0),
  created_at timestamptz not null default now(),
  check (
    (payment_method = 'tunai' and amount_received >= total and change_due = amount_received - total)
    or (payment_method <> 'tunai' and amount_received = 0 and change_due = 0)
  )
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  product_id uuid not null references public.products (id),
  product_name text not null,
  sku text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  unit_cost numeric(14, 2) not null check (unit_cost >= 0),
  subtotal numeric(14, 2) not null check (subtotal >= 0),
  unique (sale_id, product_id)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  actor_id uuid not null references public.profiles (id),
  movement_type public.inventory_movement_type not null,
  quantity_change integer not null check (quantity_change <> 0),
  stock_after integer not null check (stock_after >= 0),
  note text check (note is null or length(note) <= 500),
  sale_id uuid references public.sales (id),
  created_at timestamptz not null default now(),
  check (
    (movement_type = 'penjualan' and quantity_change < 0 and sale_id is not null)
    or (movement_type <> 'penjualan' and sale_id is null)
  )
);

create index sales_created_at_idx on public.sales (created_at desc);
create index sales_cashier_created_at_idx on public.sales (cashier_id, created_at desc);
create index inventory_movements_created_at_idx on public.inventory_movements (created_at desc);
create index inventory_movements_product_created_idx
  on public.inventory_movements (product_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.inventory_movements enable row level security;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid()
$$;
revoke all on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated using (id = auth.uid());
create policy "Authenticated users can read products"
  on public.products for select to authenticated
  using (active or public.current_app_role() in ('admin', 'gudang'));
create policy "Admins can read sales"
  on public.sales for select to authenticated using (
    public.current_app_role() = 'admin'
    or cashier_id = auth.uid()
  );
create policy "Admins and cashiers can read sale items"
  on public.sale_items for select to authenticated using (
    exists (
      select 1 from public.sales s
      where s.id = sale_id and (
        s.cashier_id = auth.uid()
        or public.current_app_role() = 'admin'
      )
    )
  );
create policy "Admins and warehouse users can read inventory history"
  on public.inventory_movements for select to authenticated using (
    public.current_app_role() in ('admin', 'gudang')
  );

create or replace function public.record_sale(
  p_cashier_id uuid,
  p_items jsonb,
  p_payment_method public.payment_method,
  p_amount_received numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale_id uuid;
  v_total numeric(14, 2) := 0;
  v_line record;
  v_stock_after integer;
  v_count integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'Keranjang penjualan kosong.';
  end if;

  if not exists (select 1 from profiles where id = p_cashier_id and role in ('admin', 'kasir')) then
    raise exception using errcode = '42501', message = 'Akun tidak memiliki akses kasir.';
  end if;
  if p_payment_method = 'tunai' and (p_amount_received is null or p_amount_received < 0) then
    raise exception using errcode = '22023', message = 'Jumlah uang tunai tidak valid.';
  end if;
  if p_payment_method <> 'tunai' and p_amount_received is not null then
    raise exception using errcode = '22023', message = 'Jumlah uang hanya boleh diisi untuk pembayaran tunai.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as entry(value)
    where jsonb_typeof(entry.value) <> 'object'
      or coalesce(entry.value->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(entry.value->>'quantity', '') !~ '^[1-9][0-9]*$'
  ) then
    raise exception using errcode = '22023', message = 'Barang atau jumlah pada keranjang tidak valid.';
  end if;

  perform p.id
  from products p
  where p.id in (
    select (entry.value->>'product_id')::uuid
    from jsonb_array_elements(p_items) as entry(value)
  )
  order by p.id
  for update;

  select count(distinct (entry.value->>'product_id')::uuid)::integer
  into v_count
  from jsonb_array_elements(p_items) as entry(value);

  for v_line in
    select p.id, p.name, p.sku, p.price, p.cost, p.stock,
      sum((entry.value->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as entry(value)
    join products p on p.id = (entry.value->>'product_id')::uuid and p.active
    group by p.id
    order by p.id
  loop
    v_count := v_count - 1;
    if not v_line.stock >= v_line.quantity then
      raise exception using errcode = '22023',
        message = format('Stok %s tidak mencukupi (tersedia %s).', v_line.name, v_line.stock);
    end if;
    v_total := v_total + v_line.price * v_line.quantity;
  end loop;

  if v_count <> 0 then
    raise exception using errcode = '22023', message = 'Produk tidak ditemukan atau sudah tidak aktif.';
  end if;
  if p_payment_method = 'tunai' and p_amount_received < v_total then
    raise exception using errcode = '22023', message = 'Uang yang diterima kurang dari total transaksi.';
  end if;

  insert into sales (cashier_id, total, payment_method, amount_received, change_due)
  values (
    p_cashier_id, v_total, p_payment_method,
    coalesce(p_amount_received, 0),
    case when p_payment_method = 'tunai' then p_amount_received - v_total else 0 end
  )
  returning id into v_sale_id;

  for v_line in
    select p.id, p.name, p.sku, p.price, p.cost,
      sum((entry.value->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as entry(value)
    join products p on p.id = (entry.value->>'product_id')::uuid and p.active
    group by p.id
    order by p.id
  loop
    update products set stock = stock - v_line.quantity, updated_at = now()
    where id = v_line.id returning stock into v_stock_after;

    insert into sale_items (
      sale_id, product_id, product_name, sku, quantity, unit_price, unit_cost, subtotal
    ) values (
      v_sale_id, v_line.id, v_line.name, v_line.sku, v_line.quantity,
      v_line.price, v_line.cost, v_line.price * v_line.quantity
    );

    insert into inventory_movements (
      product_id, actor_id, movement_type, quantity_change, stock_after, sale_id
    ) values (
      v_line.id, p_cashier_id, 'penjualan', -v_line.quantity, v_stock_after, v_sale_id
    );
  end loop;

  return v_sale_id;
end;
$$;

create or replace function public.record_stock_movement(
  p_actor_id uuid,
  p_product_id uuid,
  p_quantity_change integer,
  p_movement_type public.inventory_movement_type,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stock_after integer;
begin
  if p_movement_type not in ('masuk', 'koreksi')
    or p_quantity_change = 0
    or (p_movement_type = 'masuk' and p_quantity_change < 0) then
    raise exception using errcode = '22023', message = 'Jenis atau jumlah perubahan stok tidak valid.';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception using errcode = '22023', message = 'Catatan maksimal 500 karakter.';
  end if;
  if not exists (
    select 1 from profiles where id = p_actor_id and role in ('admin', 'gudang')
  ) then
    raise exception using errcode = '42501', message = 'Akun tidak memiliki akses inventaris.';
  end if;

  update products
  set stock = stock + p_quantity_change, updated_at = now()
  where id = p_product_id and stock + p_quantity_change >= 0
  returning stock into v_stock_after;

  if not found then
    if not exists (select 1 from products where id = p_product_id) then
      raise exception using errcode = 'P0002', message = 'Produk tidak ditemukan.';
    end if;
    raise exception using errcode = '22023', message = 'Stok tidak dapat menjadi negatif.';
  end if;

  insert into inventory_movements (
    product_id, actor_id, movement_type, quantity_change, stock_after, note
  ) values (p_product_id, p_actor_id, p_movement_type, p_quantity_change, v_stock_after, p_note);

  return v_stock_after;
end;
$$;

revoke all on function public.record_sale(uuid, jsonb, public.payment_method, numeric) from public, anon, authenticated;
revoke all on function public.record_stock_movement(uuid, uuid, integer, public.inventory_movement_type, text)
  from public, anon, authenticated;
grant execute on function public.record_sale(uuid, jsonb, public.payment_method, numeric) to service_role;
grant execute on function public.record_stock_movement(uuid, uuid, integer, public.inventory_movement_type, text)
  to service_role;
