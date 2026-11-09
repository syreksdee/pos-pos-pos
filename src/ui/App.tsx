import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine, ArrowLeftRight, ArrowUpRight, BadgePlus, BarChart3, Boxes,
  Check, ChevronDown, CircleDollarSign, ClipboardList, CreditCard, LayoutDashboard,
  LogOut, Minus, Package, Plus, Printer, Search, ShieldCheck, ShoppingBag,
  ShoppingCart, Store, TrendingUp, X,
} from "lucide-react";
import { api, apiPatch, apiPost, supabase } from "../lib/api";
import { rupiah, shortDate } from "../lib/format";
import type { InventoryMovement, Product, Profile, Role, Sale } from "../lib/types";

type Section = "overview" | "cashier" | "products" | "inventory" | "sales" | "reports";
type ReportData = {
  period: { from: string; to: string };
  totals: { sales_count: number; revenue: number; profit: number; items_sold: number; low_stock_count: number };
  sales: Sale[];
  top_products: { product_id: string; name: string; sku: string; quantity: number; revenue: number }[];
  stock: Product[];
  movements: InventoryMovement[];
};
type Cart = Record<string, number>;

const navigation: Record<Role, { id: Section; label: string; icon: typeof Store }[]> = {
  admin: [
    { id: "overview", label: "Ringkasan", icon: LayoutDashboard },
    { id: "products", label: "Produk", icon: Package },
    { id: "inventory", label: "Stok & mutasi", icon: ArrowLeftRight },
    { id: "sales", label: "Penjualan", icon: ClipboardList },
    { id: "reports", label: "Laporan", icon: BarChart3 },
  ],
  kasir: [
    { id: "cashier", label: "Kasir", icon: ShoppingCart },
    { id: "sales", label: "Transaksi saya", icon: ClipboardList },
  ],
  gudang: [
    { id: "products", label: "Produk", icon: Package },
    { id: "inventory", label: "Stok & mutasi", icon: ArrowLeftRight },
  ],
};

const defaultSection: Record<Role, Section> = {
  admin: "overview",
  kasir: "cashier",
  gudang: "products",
};

const sectionTitles: Record<Section, string> = {
  overview: "Ringkasan",
  cashier: "Kasir",
  products: "Produk",
  inventory: "Stok & mutasi",
  sales: "Riwayat penjualan",
  reports: "Laporan",
};

function readHash(role: Role): Section {
  const section = window.location.hash.slice(2) as Section;
  return navigation[role].some((item) => item.id === section) ? section : defaultSection[role];
}

function roleName(role: Role) {
  return role === "admin" ? "Administrator" : role === "kasir" ? "Kasir" : "Gudang";
}

function useToday() {
  return new Date().toISOString().slice(0, 10);
}

export function App() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [section, setSection] = useState<Section>("overview");
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(useToday);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [receipt, setReceipt] = useState<Sale | null>(null);

  useEffect(() => {
    let active = true;
    if (!supabase) {
      setAuthLoading(false);
      setAuthError("Hubungkan Supabase dengan mengatur VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY.");
      return;
    }

    const loadSession = async (token: string | null) => {
      if (!active) return;
      setSessionToken(token);
      if (!token) {
        setProfile(null);
        setAuthLoading(false);
        return;
      }
      try {
        const current = await api<Profile>("/api/me", token);
        if (active) {
          setProfile(current);
          setSection(readHash(current.role));
          setAuthError("");
        }
      } catch (reason) {
        if (active) {
          setProfile(null);
          setAuthError(reason instanceof Error ? reason.message : "Sesi masuk tidak dapat diperiksa.");
        }
      } finally {
        if (active) setAuthLoading(false);
      }
    };

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setAuthError("Sesi masuk tidak dapat dimuat.");
      void loadSession(data.session?.access_token ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      void loadSession(currentSession?.access_token ?? null);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!profile) return;
    const sync = () => setSection(readHash(profile.role));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [profile]);

  const goTo = (next: Section) => {
    window.location.hash = `/${next}`;
    setSection(next);
    setError("");
  };

  const loadProducts = useCallback(async () => {
    if (!sessionToken) return;
    setProducts(await api<Product[]>("/api/products", sessionToken));
  }, [sessionToken]);

  const loadSales = useCallback(async () => {
    if (!sessionToken) return;
    setSales(await api<Sale[]>("/api/sales", sessionToken));
  }, [sessionToken]);

  const loadMovements = useCallback(async () => {
    if (!sessionToken) return;
    setMovements(await api<InventoryMovement[]>("/api/inventory", sessionToken));
  }, [sessionToken]);

  const loadReport = useCallback(async () => {
    if (!sessionToken) return;
    const query = new URLSearchParams({ from, to });
    setReport(await api<ReportData>(`/api/reports?${query}`, sessionToken));
  }, [from, sessionToken, to]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (section === "overview" || section === "reports") await loadReport();
      if (section === "products" || section === "cashier") await loadProducts();
      if (section === "inventory") {
        await Promise.all([loadProducts(), loadMovements()]);
      }
      if (section === "sales") await loadSales();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Data tidak dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [loadMovements, loadProducts, loadReport, loadSales, section]);

  useEffect(() => {
    if (profile) void refresh();
  }, [profile, refresh]);

  const signIn = async (email: string, password: string) => {
    if (!supabase) return;
    setAuthLoading(true);
    setAuthError("");
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setAuthError("Email atau kata sandi salah. Silakan coba kembali.");
      setAuthLoading(false);
      return;
    }
    if (data.session) {
      setSessionToken(data.session.access_token);
      try {
        const current = await api<Profile>("/api/me", data.session.access_token);
        setProfile(current);
        goTo(defaultSection[current.role]);
      } catch (reason) {
        setAuthError(reason instanceof Error ? reason.message : "Akun belum dapat mengakses aplikasi.");
        await supabase.auth.signOut();
      }
    }
    setAuthLoading(false);
  };

  const signOut = async () => {
    if (supabase) {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) setError("Tidak dapat keluar. Silakan coba kembali.");
    }
    setProfile(null);
    setSessionToken(null);
    setSection("overview");
  };

  const runAction = async (action: () => Promise<void>): Promise<boolean> => {
    setError("");
    try {
      await action();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Tindakan tidak dapat diselesaikan.");
      return false;
    }
  };

  if (authLoading) return <LoadingPage />;
  if (!profile || !sessionToken) {
    return <Login onSignIn={signIn} error={authError} />;
  }

  const saveProduct = async (product: Partial<Product> & { id?: string }) => {
    if (!sessionToken) return;
    if (product.id) await apiPatch<Product>("/api/products", sessionToken, product);
    else await apiPost<Product>("/api/products", sessionToken, product);
    await loadProducts();
  };

  const addMovement = async (movement: {
    product_id: string; type: "masuk" | "koreksi"; quantity: number; note: string;
  }) => {
    if (!sessionToken) return;
    await apiPost("/api/inventory", sessionToken, movement);
    await Promise.all([loadProducts(), loadMovements()]);
  };

  const checkout = async (items: { product_id: string; quantity: number }[], payment_method: Sale["payment_method"], amount_received: number) => {
    if (!sessionToken) return;
    const result = await apiPost<Sale>("/api/sales", sessionToken, {
      items, payment_method, ...(payment_method === "tunai" ? { amount_received } : {}),
    });
    setReceipt(result);
    setProducts(await api<Product[]>("/api/products", sessionToken));
    if (section === "sales") await loadSales();
  };

  const updateReportPeriod = async () => {
    await runAction(loadReport);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/overview" onClick={(event) => {
          event.preventDefault();
          goTo(defaultSection[profile.role]);
        }}>
          <span className="brand-mark"><Store size={20} /></span>
          <span><strong>Ritel</strong><small>POS & INVENTARIS</small></span>
        </a>
        <div className="store-label"><span className="store-dot" /> TOKO UTAMA</div>
        <nav className="side-nav" aria-label="Navigasi utama">
          {navigation[profile.role].map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${section === id ? "active" : ""}`} onClick={() => goTo(id)}>
              <Icon size={18} strokeWidth={1.9} /><span>{label}</span>
              {id === "inventory" && profile.role === "admin" && report?.totals.low_stock_count
                ? <span className="nav-badge">{report.totals.low_stock_count}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="account-card">
            <div className="avatar">{profile.full_name.slice(0, 1).toUpperCase()}</div>
            <div className="account-copy"><strong>{profile.full_name}</strong><span>{roleName(profile.role)}</span></div>
            <button className="icon-button logout-button" aria-label="Keluar" onClick={() => void signOut()}><LogOut size={17} /></button>
          </div>
          <div className="secure-note"><ShieldCheck size={14} /> Akses aman & terkelola</div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark"><Store size={18} /></span><strong>Ritel</strong></div>
          <div className="breadcrumbs"><span>Ritel POS</span><span className="crumb-slash">/</span><strong>{sectionTitles[section]}</strong></div>
          <div className="topbar-right">
            <span className="role-pill"><span />{roleName(profile.role)}</span>
            <span className="today-label">{new Intl.DateTimeFormat("id-ID", { dateStyle: "full" }).format(new Date())}</span>
          </div>
        </header>
        <div className="page-content">
          {error && <div className="alert alert-error" role="alert">{error}<button onClick={() => setError("")} aria-label="Tutup"><X size={16} /></button></div>}
          {loading && <div className="loading-bar" />}
          {section === "overview" && profile.role === "admin" && (
            <Overview report={report} from={from} to={to} setFrom={setFrom} setTo={setTo} onApply={updateReportPeriod} onSale={setSelectedSale} />
          )}
          {section === "cashier" && profile.role === "kasir" && (
            <Cashier products={products} onCheckout={(items, method, amount) => runAction(() => checkout(items, method, amount))} />
          )}
          {section === "products" && (
            <Products products={products} role={profile.role} onSave={(product) => runAction(() => saveProduct(product))} />
          )}
          {section === "inventory" && (
            <Inventory products={products} movements={movements} onSave={(movement) => runAction(() => addMovement(movement))} />
          )}
          {section === "sales" && (
            <Sales sales={sales} onSelect={async (sale) => {
              if (!sessionToken) return;
              await runAction(async () => setSelectedSale(await api<Sale>(`/api/sales?id=${sale.id}`, sessionToken)));
            }} />
          )}
          {section === "reports" && profile.role === "admin" && (
            <Reports report={report} from={from} to={to} setFrom={setFrom} setTo={setTo} onApply={updateReportPeriod} onSale={setSelectedSale} />
          )}
          {selectedSale && <SaleDialog sale={selectedSale} onClose={() => setSelectedSale(null)} />}
          {receipt && <ReceiptDialog sale={receipt} onClose={() => setReceipt(null)} />}
        </div>
      </main>
    </div>
  );
}

function LoadingPage() {
  return <div className="auth-page"><div className="auth-card loading-card"><span className="brand-mark"><Store size={21} /></span><div className="spinner" /><p>Menyiapkan ruang kerja…</p></div></div>;
}

function Login({ onSignIn, error }: { onSignIn: (email: string, password: string) => Promise<void>; error: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setWorking(true);
    try { await onSignIn(email, password); } finally { setWorking(false); }
  };
  return (
    <div className="auth-page">
      <div className="auth-decoration"><div className="decor-orb orb-one" /><div className="decor-orb orb-two" /><span className="decor-line" /></div>
      <div className="auth-card">
        <div className="auth-brand"><span className="brand-mark"><Store size={21} /></span><div><strong>Ritel</strong><span>SISTEM KASIR & INVENTARIS</span></div></div>
        <div className="auth-heading"><span className="eyebrow">SELAMAT DATANG KEMBALI</span><h1>Masuk ke<br />ruang kerja Anda.</h1><p>Kelola transaksi dan stok toko dengan lebih mudah.</p></div>
        <form onSubmit={submit} className="login-form">
          <label>Email akun<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nama@toko.id" /></label>
          <label>Kata sandi<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Masukkan kata sandi" /></label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="button button-primary login-submit" disabled={working}>{working ? "Memeriksa akun…" : "Masuk ke aplikasi"}<ArrowUpRight size={17} /></button>
        </form>
        <div className="no-signup"><ShieldCheck size={15} />Akun dibuat oleh administrator toko.</div>
        <div className="auth-footer"><span>Ritel POS</span><span>© {new Date().getFullYear()} · Sistem internal toko</span></div>
      </div>
    </div>
  );
}

function PeriodFilter({ from, to, setFrom, setTo, onApply }: {
  from: string; to: string; setFrom: (value: string) => void; setTo: (value: string) => void; onApply: () => void;
}) {
  return <div className="period-filter">
    <label>Dari<input aria-label="Tanggal mulai" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
    <span className="filter-dash">—</span>
    <label>Sampai<input aria-label="Tanggal akhir" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    <button className="button button-secondary" onClick={onApply}>Terapkan</button>
  </div>;
}

function MetricCard({ label, value, caption, icon: Icon, tone }: {
  label: string; value: string; caption: string; icon: typeof Store; tone: string;
}) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}><Icon size={18} /></span></div><strong>{value}</strong><small>{caption}</small></div>;
}

function Overview({ report, from, to, setFrom, setTo, onApply, onSale }: {
  report: ReportData | null; from: string; to: string; setFrom: (value: string) => void;
  setTo: (value: string) => void; onApply: () => void; onSale: (sale: Sale) => void;
}) {
  return (
    <div className="page-stack">
      <div className="page-heading heading-with-action"><div><span className="eyebrow">PUSAT KENDALI</span><h1>Selamat pagi 👋</h1><p>Berikut gambaran aktivitas toko Anda hari ini.</p></div><PeriodFilter {...{ from, to, setFrom, setTo, onApply }} /></div>
      <div className="metric-grid">
        <MetricCard label="Total penjualan" value={rupiah(report?.totals.revenue ?? 0)} caption={`${report?.totals.sales_count ?? 0} transaksi dalam periode`} icon={CircleDollarSign} tone="green" />
        <MetricCard label="Laba kotor" value={rupiah(report?.totals.profit ?? 0)} caption="Berdasarkan modal produk terjual" icon={TrendingUp} tone="blue" />
        <MetricCard label="Produk terjual" value={`${report?.totals.items_sold ?? 0}`} caption="Total kuantitas dalam periode" icon={ShoppingBag} tone="orange" />
        <MetricCard label="Stok menipis" value={`${report?.totals.low_stock_count ?? 0}`} caption="Perlu perhatian" icon={Boxes} tone="red" />
      </div>
      <div className="content-grid">
        <section className="panel sales-panel"><div className="panel-heading"><div><h2>Penjualan terbaru</h2><p>Transaksi pada periode yang dipilih</p></div><span className="soft-icon"><ClipboardList size={17} /></span></div>
          <SalesTable sales={(report?.sales ?? []).slice(0, 5)} onSelect={onSale} empty="Belum ada transaksi pada periode ini." /></section>
        <section className="panel top-products-panel"><div className="panel-heading"><div><h2>Produk terlaris</h2><p>Diurutkan dari jumlah terjual</p></div><span className="soft-icon orange"><TrendingUp size={17} /></span></div>
          {(report?.top_products ?? []).length ? <div className="top-product-list">{report!.top_products.slice(0, 5).map((product, index) => <div className="top-product" key={product.product_id}><span className={`product-rank rank-${index + 1}`}>{String(index + 1).padStart(2, "0")}</span><span className="top-product-name"><strong>{product.name}</strong><small>{product.sku}</small></span><span className="product-sold">{product.quantity} <small>terjual</small></span></div>)}</div> : <EmptyState text="Data produk terlaris akan muncul setelah transaksi." />}</section>
      </div>
      <section className="panel low-stock-panel"><div className="panel-heading"><div><h2>Perlu restok</h2><p>Produk aktif dengan stok sama dengan atau di bawah batas minimum</p></div><span className="status-pill status-low">{report?.totals.low_stock_count ?? 0} produk</span></div>
        <StockTable products={(report?.stock ?? []).filter((product) => product.active && product.stock <= product.min_stock).slice(0, 6)} /></section>
    </div>
  );
}

function Cashier({ products, onCheckout }: {
  products: Product[];
  onCheckout: (items: { product_id: string; quantity: number }[], method: Sale["payment_method"], amount: number) => Promise<boolean>;
}) {
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Cart>({});
  const [payment, setPayment] = useState<Sale["payment_method"]>("tunai");
  const [amount, setAmount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const lines = Object.entries(cart).flatMap(([id, quantity]) => {
    const product = productById.get(id);
    return product ? [{ product, quantity }] : [];
  });
  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const filtered = products.filter((product) => product.active && product.stock > 0 &&
    `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(search.toLowerCase()));
  useEffect(() => setAmount(total), [total]);
  const add = (product: Product) => setCart((current) => ({ ...current, [product.id]: (current[product.id] ?? 0) + 1 }));
  const changeQuantity = (id: string, next: number) => {
    const product = productById.get(id);
    if (!next) {
      setCart((current) => { const updated = { ...current }; delete updated[id]; return updated; });
      return;
    }
    if (product && next <= product.stock) setCart((current) => ({ ...current, [id]: next }));
  };
  const submit = async () => {
    if (!lines.length || (payment === "tunai" && amount < total)) return;
    setSubmitting(true);
    const saved = await onCheckout(lines.map(({ product, quantity }) => ({ product_id: product.id, quantity })), payment, amount);
    setSubmitting(false);
    if (saved) {
      setCart({});
      setSearch("");
    }
  };

  return (
    <div className="page-stack">
      <div className="page-heading"><span className="eyebrow">TRANSAKSI BARU</span><h1>Kasir</h1><p>Cari produk berdasarkan nama atau SKU, lalu tambahkan ke keranjang.</p></div>
      <div className="pos-layout">
        <section className="pos-catalog">
          <div className="catalog-toolbar"><label className="search-field"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama produk atau SKU…" /><kbd>SKU</kbd></label><span className="catalog-count">{filtered.length} produk</span></div>
          <div className="product-grid">
            {filtered.map((product, index) => <button className="catalog-card" key={product.id} onClick={() => add(product)}>
              <span className={`product-art art-${index % 5}`}><Package size={23} /></span>
              <span className="catalog-name">{product.name}</span><span className="catalog-sku">{product.sku} · {product.stock} {product.unit}</span>
              <span className="catalog-price">{rupiah(product.price)}<span className="add-product"><Plus size={16} /></span></span>
            </button>)}
            {!filtered.length && <div className="empty-products"><Package size={28} /><strong>Produk tidak ditemukan</strong><span>Coba kata kunci atau SKU lain.</span></div>}
          </div>
        </section>
        <aside className="cart-panel">
          <div className="cart-heading"><div><h2>Keranjang</h2><p>{lines.length} jenis produk</p></div><span className="cart-count">{lines.reduce((sum, item) => sum + item.quantity, 0)}</span></div>
          <div className="cart-lines">
            {lines.map(({ product, quantity }) => <div className="cart-line" key={product.id}>
              <span className="cart-product-icon"><Package size={16} /></span>
              <div className="cart-line-main"><strong>{product.name}</strong><small>{rupiah(product.price)}</small><div className="qty-stepper"><button aria-label={`Kurangi ${product.name}`} onClick={() => changeQuantity(product.id, quantity - 1)}><Minus size={13} /></button><span>{quantity}</span><button aria-label={`Tambah ${product.name}`} disabled={quantity >= product.stock} onClick={() => changeQuantity(product.id, quantity + 1)}><Plus size={13} /></button></div></div>
              <strong className="line-total">{rupiah(product.price * quantity)}</strong>
            </div>)}
            {!lines.length && <div className="cart-empty"><ShoppingCart size={25} /><span>Keranjang masih kosong</span><small>Pilih produk untuk memulai transaksi</small></div>}
          </div>
          <div className="cart-footer">
            <div className="cart-total"><span>Total pembayaran</span><strong>{rupiah(total)}</strong></div>
            <label className="payment-select">Metode pembayaran<span className="select-wrap"><CreditCard size={16} /><select value={payment} onChange={(event) => setPayment(event.target.value as Sale["payment_method"])}><option value="tunai">Tunai</option><option value="qris">QRIS</option><option value="transfer">Transfer</option></select><ChevronDown size={15} /></span></label>
            {payment === "tunai" && <><label className="cash-input">Uang diterima<input type="number" min={total} step={1000} value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label><div className={`change-row ${amount < total ? "change-short" : ""}`}><span>{amount < total ? "Uang kurang" : "Kembalian"}</span><strong>{rupiah(Math.max(0, amount - total))}</strong></div></>}
            <button className="button button-primary checkout-button" disabled={!lines.length || submitting || (payment === "tunai" && amount < total)} onClick={() => void submit()}>
              {submitting ? "Memproses transaksi…" : <>Selesaikan transaksi <ArrowUpRight size={17} /></>}
            </button>
            <div className="secure-checkout"><ShieldCheck size={13} /> Stok diperbarui aman saat transaksi</div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Products({ products, role, onSave }: {
  products: Product[]; role: Role; onSave: (product: Partial<Product> & { id?: string }) => Promise<boolean>;
}) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Product | null | "new">(null);
  const [saving, setSaving] = useState(false);
  const filtered = products.filter((product) => `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(search.toLowerCase()));
  const save = async (value: Partial<Product> & { id?: string }) => {
    setSaving(true);
    const saved = await onSave(value);
    setSaving(false);
    if (saved) setEditing(null);
  };
  return (
    <div className="page-stack">
      <div className="page-heading heading-with-action"><div><span className="eyebrow">KATALOG TOKO</span><h1>Produk</h1><p>Kelola katalog, harga jual, modal, dan batas minimum stok.</p></div>{role !== "kasir" && <button className="button button-primary" onClick={() => setEditing("new")}><Plus size={17} />Tambah produk</button>}</div>
      <section className="panel table-panel">
        <div className="table-toolbar"><label className="search-field search-compact"><Search size={17} /><input placeholder="Cari nama, SKU, atau kategori…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><span className="table-count">{filtered.length} produk</span></div>
        <div className="table-scroll"><table><thead><tr><th>PRODUK</th><th>KATEGORI</th><th>HARGA JUAL</th><th>MODAL</th><th>STOK</th>{role !== "kasir" && <th></th>}</tr></thead><tbody>
          {filtered.map((product) => <tr key={product.id}><td><div className="product-cell"><span className="table-product-icon"><Package size={17} /></span><span><strong>{product.name}</strong><small>{product.sku}</small></span></div></td><td>{product.category}</td><td className="number-cell">{rupiah(product.price)}</td><td className="number-cell muted-cell">{rupiah(product.cost)}</td><td><StockBadge product={product} /></td>{role !== "kasir" && <td className="action-cell"><button className="text-button" onClick={() => setEditing(product)}>Ubah</button></td>}</tr>)}
          {!filtered.length && <tr><td colSpan={6}><EmptyState text="Produk tidak ditemukan." /></td></tr>}
        </tbody></table></div>
        <div className="table-footnote"><ShieldCheck size={14} /> Perubahan stok dicatat di riwayat mutasi agar dapat ditelusuri.</div>
      </section>
      {editing !== null && <ProductDialog product={editing === "new" ? null : editing} saving={saving} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function ProductDialog({ product, saving, onClose, onSave }: {
  product: Product | null; saving: boolean; onClose: () => void;
  onSave: (value: Partial<Product> & { id?: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    sku: product?.sku ?? "", name: product?.name ?? "", category: product?.category ?? "",
    unit: product?.unit ?? "pcs", price: product?.price ?? 0, cost: product?.cost ?? 0,
    min_stock: product?.min_stock ?? 5, active: product?.active ?? true,
  });
  const set = (key: keyof typeof form, value: string | number | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSave({ ...form, ...(product ? { id: product.id } : {}) });
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog product-dialog" role="dialog" aria-modal="true" aria-labelledby="product-dialog-title">
      <div className="dialog-heading"><div><span className="eyebrow">{product ? "PERBARUI KATALOG" : "KATALOG BARU"}</span><h2 id="product-dialog-title">{product ? "Ubah produk" : "Tambah produk"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Tutup"><X size={19} /></button></div>
      <form className="dialog-form" onSubmit={(event) => void submit(event)}>
        <label>SKU / barcode<input required maxLength={64} value={form.sku} onChange={(event) => set("sku", event.target.value)} placeholder="Contoh: BRG-001" /></label>
        <label>Nama produk<input required maxLength={160} value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="Nama produk" /></label>
        <div className="form-grid"><label>Kategori<input required maxLength={80} value={form.category} onChange={(event) => set("category", event.target.value)} placeholder="Contoh: Minuman" /></label><label>Satuan<input required maxLength={24} value={form.unit} onChange={(event) => set("unit", event.target.value)} placeholder="pcs" /></label></div>
        <div className="form-grid"><label>Harga jual (Rp)<input type="number" min="0" max="1000000000" required value={form.price} onChange={(event) => set("price", Number(event.target.value))} /></label><label>Harga modal (Rp)<input type="number" min="0" max="1000000000" required value={form.cost} onChange={(event) => set("cost", Number(event.target.value))} /></label></div>
        <label>Batas minimum stok<input type="number" min="0" max="1000000" required value={form.min_stock} onChange={(event) => set("min_stock", Number(event.target.value))} /></label>
        {product && <label className="toggle-row"><span><strong>Produk aktif</strong><small>Produk nonaktif tidak bisa dipilih saat transaksi.</small></span><input type="checkbox" checked={form.active} onChange={(event) => set("active", event.target.checked)} /></label>}
        {!product && <div className="form-hint"><ArrowDownToLine size={15} /> Stok awal akan ditambahkan melalui menu Stok & mutasi.</div>}
        <div className="dialog-actions"><button type="button" className="button button-ghost" onClick={onClose}>Batal</button><button className="button button-primary" disabled={saving}>{saving ? "Menyimpan…" : product ? "Simpan perubahan" : "Simpan produk"}</button></div>
      </form>
    </section>
  </div>;
}

function Inventory({ products, movements, onSave }: {
  products: Product[]; movements: InventoryMovement[];
  onSave: (movement: { product_id: string; type: "masuk" | "koreksi"; quantity: number; note: string }) => Promise<boolean>;
}) {
  const [type, setType] = useState<"masuk" | "koreksi">("masuk");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const activeProducts = products.filter((product) => product.active);
  useEffect(() => {
    if (!productId && activeProducts[0]) setProductId(activeProducts[0].id);
  }, [activeProducts, productId]);
  const currentProduct = products.find((product) => product.id === productId);
  const newStock = (currentProduct?.stock ?? 0) + (type === "masuk" ? quantity : quantity);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!productId || !Number.isSafeInteger(quantity) || quantity === 0) return;
    setSaving(true);
    const saved = await onSave({ product_id: productId, type, quantity, note });
    setSaving(false);
    if (saved) {
      setQuantity(type === "masuk" ? 1 : 0);
      setNote("");
    }
  };
  return (
    <div className="page-stack">
      <div className="page-heading"><span className="eyebrow">PERGERAKAN PERSEDIAAN</span><h1>Stok & mutasi</h1><p>Catat barang masuk dan koreksi stok. Semua perubahan tersimpan di riwayat.</p></div>
      <div className="inventory-layout">
        <section className="panel inventory-form-panel">
          <div className="panel-heading"><div><h2>Catat perubahan stok</h2><p>Stok diperbarui dan dicatat dalam satu transaksi.</p></div><span className="soft-icon"><ArrowLeftRight size={17} /></span></div>
          <div className="movement-tabs"><button className={type === "masuk" ? "selected" : ""} onClick={() => { setType("masuk"); if (quantity < 1) setQuantity(1); }}><ArrowDownToLine size={15} />Barang masuk</button><button className={type === "koreksi" ? "selected" : ""} onClick={() => setType("koreksi")}><ArrowLeftRight size={15} />Koreksi stok</button></div>
          <form className="inventory-form" onSubmit={(event) => void submit(event)}>
            <label>Produk<select value={productId} onChange={(event) => setProductId(event.target.value)} required><option value="" disabled>Pilih produk…</option>{activeProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
            {currentProduct && <div className="stock-preview"><span>Stok saat ini</span><strong>{currentProduct.stock} {currentProduct.unit}</strong></div>}
            <label>{type === "masuk" ? "Jumlah barang masuk" : "Perubahan stok (gunakan minus untuk mengurangi)"}<input type="number" required step="1" value={quantity} min={type === "masuk" ? 1 : currentProduct ? -currentProduct.stock : -1000000} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
            {currentProduct && <div className="stock-preview preview-new"><span>Stok setelah perubahan</span><strong>{newStock} {currentProduct.unit}</strong></div>}
            <label>Catatan / alasan<input maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder={type === "masuk" ? "Contoh: Pembelian dari pemasok" : "Contoh: Hasil hitung fisik"} /></label>
            <button className="button button-primary save-movement" disabled={saving || !productId || !Number.isSafeInteger(quantity) || quantity === 0}>{saving ? "Menyimpan…" : "Simpan perubahan stok"}<ArrowUpRight size={16} /></button>
          </form>
        </section>
        <section className="panel inventory-table-panel"><div className="panel-heading"><div><h2>Ringkasan stok</h2><p>{activeProducts.length} produk aktif</p></div><span className="soft-icon orange"><Boxes size={17} /></span></div><StockTable products={activeProducts} /></section>
      </div>
      <section className="panel table-panel"><div className="panel-heading history-heading"><div><h2>Riwayat mutasi stok</h2><p>200 perubahan stok terakhir</p></div><span className="status-pill status-neutral">{movements.length} catatan</span></div>
        <div className="table-scroll"><table><thead><tr><th>WAKTU</th><th>PRODUK</th><th>JENIS</th><th>PERUBAHAN</th><th>STOK AKHIR</th><th>CATATAN</th><th>OLEH</th></tr></thead><tbody>
          {movements.map((movement) => <tr key={movement.id}><td className="muted-cell">{shortDate(movement.created_at)}</td><td><div className="product-cell"><span><strong>{movement.product_name}</strong><small>{movement.sku}</small></span></div></td><td><MovementBadge type={movement.movement_type} /></td><td className={`number-cell ${movement.quantity_change < 0 ? "negative-number" : "positive-number"}`}>{movement.quantity_change > 0 ? "+" : ""}{movement.quantity_change}</td><td className="number-cell">{movement.stock_after}</td><td className="note-cell">{movement.note || "—"}</td><td>{movement.actor_name}</td></tr>)}
          {!movements.length && <tr><td colSpan={7}><EmptyState text="Belum ada mutasi stok." /></td></tr>}
        </tbody></table></div>
      </section>
    </div>
  );
}

function Sales({ sales, onSelect }: { sales: Sale[]; onSelect: (sale: Sale) => void }) {
  const [search, setSearch] = useState("");
  const filtered = sales.filter((sale) => `${sale.receipt_number} ${sale.cashier_name}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="page-stack">
    <div className="page-heading"><span className="eyebrow">CATATAN TRANSAKSI</span><h1>Riwayat penjualan</h1><p>Periksa transaksi terbaru dan buka tanda terima untuk melihat rincian.</p></div>
    <section className="panel table-panel">
      <div className="table-toolbar"><label className="search-field search-compact"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nomor transaksi atau kasir…" /></label><span className="table-count">{filtered.length} transaksi terbaru</span></div>
      <SalesTable sales={filtered} onSelect={onSelect} empty="Belum ada transaksi." />
    </section>
  </div>;
}

function Reports({ report, from, to, setFrom, setTo, onApply, onSale }: {
  report: ReportData | null; from: string; to: string; setFrom: (value: string) => void;
  setTo: (value: string) => void; onApply: () => void; onSale: (sale: Sale) => void;
}) {
  const [tab, setTab] = useState<"sales" | "stock" | "incoming" | "corrections">("sales");
  const filteredMovements = (report?.movements ?? []).filter((movement) =>
    tab === "incoming" ? movement.movement_type === "masuk" :
      tab === "corrections" ? movement.movement_type === "koreksi" : true);
  return <div className="page-stack">
    <div className="page-heading heading-with-action"><div><span className="eyebrow">ANALISIS TOKO</span><h1>Laporan</h1><p>Penjualan, laba, stok, dan perubahan persediaan dalam satu tempat.</p></div><PeriodFilter {...{ from, to, setFrom, setTo, onApply }} /></div>
    <div className="metric-grid report-metrics">
      <MetricCard label="Omzet" value={rupiah(report?.totals.revenue ?? 0)} caption={`${report?.totals.sales_count ?? 0} transaksi`} icon={CircleDollarSign} tone="green" />
      <MetricCard label="Laba kotor" value={rupiah(report?.totals.profit ?? 0)} caption="Harga jual dikurangi modal" icon={TrendingUp} tone="blue" />
      <MetricCard label="Barang terjual" value={`${report?.totals.items_sold ?? 0}`} caption="Unit dalam periode terpilih" icon={ShoppingBag} tone="orange" />
      <MetricCard label="Perlu restok" value={`${report?.totals.low_stock_count ?? 0}`} caption="Produk di bawah batas minimum" icon={Boxes} tone="red" />
    </div>
    <section className="panel reports-panel">
      <div className="report-tabs" role="tablist">
        <button className={tab === "sales" ? "active" : ""} onClick={() => setTab("sales")}>Penjualan & laba</button>
        <button className={tab === "stock" ? "active" : ""} onClick={() => setTab("stock")}>Laporan stok</button>
        <button className={tab === "incoming" ? "active" : ""} onClick={() => setTab("incoming")}>Barang masuk</button>
        <button className={tab === "corrections" ? "active" : ""} onClick={() => setTab("corrections")}>Koreksi stok</button>
      </div>
      {tab === "sales" && <div className="report-content">
        <div className="report-subhead"><div><h2>Rincian penjualan</h2><p>Nilai laba dihitung dari harga jual dan modal saat transaksi.</p></div><span className="period-label">{report?.period.from} — {report?.period.to}</span></div>
        <div className="table-scroll"><SalesTable sales={report?.sales ?? []} onSelect={onSale} empty="Tidak ada penjualan pada rentang tanggal ini." showProfit /></div>
        <div className="report-best-sellers"><h3>Produk terlaris</h3><div className="best-seller-grid">{(report?.top_products ?? []).slice(0, 4).map((item) => <div key={item.product_id}><span className="table-product-icon"><Package size={16} /></span><span><strong>{item.name}</strong><small>{item.quantity} unit · {rupiah(item.revenue)}</small></span></div>)}{!report?.top_products.length && <EmptyState text="Belum ada produk terjual." />}</div></div>
      </div>}
      {tab === "stock" && <div className="report-content"><div className="report-subhead"><div><h2>Posisi stok saat ini</h2><p>Persediaan terbaru beserta status stok minimum.</p></div></div><StockTable products={report?.stock ?? []} /></div>}
      {(tab === "incoming" || tab === "corrections") && <div className="report-content"><div className="report-subhead"><div><h2>{tab === "incoming" ? "Riwayat barang masuk" : "Riwayat koreksi stok"}</h2><p>Periode {report?.period.from} — {report?.period.to}</p></div></div><MovementTable movements={filteredMovements} /></div>}
    </section>
  </div>;
}

function SalesTable({ sales, onSelect, empty, showProfit = false }: {
  sales: Sale[]; onSelect: (sale: Sale) => void; empty?: string; showProfit?: boolean;
}) {
  return <div className="table-scroll"><table><thead><tr><th>NO. TRANSAKSI</th><th>WAKTU</th><th>KASIR</th><th>ITEM</th><th>PEMBAYARAN</th><th>TOTAL</th>{showProfit && <th>LABA</th>}<th></th></tr></thead><tbody>
    {sales.map((sale) => {
      const profit = sale.items?.reduce((sum, item) => sum + (Number(item.unit_price) - Number(item.unit_cost)) * item.quantity, 0);
      return <tr key={sale.id}><td><strong className="receipt-code">{sale.receipt_number}</strong></td><td className="muted-cell">{shortDate(sale.created_at)}</td><td>{sale.cashier_name}</td><td>{sale.items ? sale.items.reduce((sum, item) => sum + item.quantity, 0) : "—"}</td><td><span className="payment-label">{sale.payment_method.toUpperCase()}</span></td><td className="number-cell">{rupiah(sale.total)}</td>{showProfit && <td className="number-cell positive-number">{rupiah(profit ?? 0)}</td>}<td><button className="text-button" onClick={() => onSelect(sale)}>Rincian</button></td></tr>;
    })}
    {!sales.length && <tr><td colSpan={showProfit ? 8 : 7}><EmptyState text={empty ?? "Belum ada transaksi."} /></td></tr>}
  </tbody></table></div>;
}

function StockTable({ products }: { products: Product[] }) {
  return <div className="table-scroll"><table><thead><tr><th>PRODUK</th><th>KATEGORI</th><th>STOK TERSEDIA</th><th>BATAS MINIMUM</th><th>STATUS</th></tr></thead><tbody>
    {products.map((product) => <tr key={product.id}><td><div className="product-cell"><span className="table-product-icon"><Package size={16} /></span><span><strong>{product.name}</strong><small>{product.sku}</small></span></div></td><td>{product.category}</td><td className={`number-cell ${product.stock <= product.min_stock ? "negative-number" : ""}`}>{product.stock} {product.unit}</td><td className="number-cell muted-cell">{product.min_stock} {product.unit}</td><td><StockBadge product={product} /></td></tr>)}
    {!products.length && <tr><td colSpan={5}><EmptyState text="Semua stok aman atau belum ada produk." /></td></tr>}
  </tbody></table></div>;
}

function MovementTable({ movements }: { movements: InventoryMovement[] }) {
  return <div className="table-scroll"><table><thead><tr><th>WAKTU</th><th>PRODUK</th><th>PERUBAHAN</th><th>STOK AKHIR</th><th>CATATAN</th><th>OLEH</th></tr></thead><tbody>
    {movements.map((movement) => <tr key={movement.id}><td className="muted-cell">{shortDate(movement.created_at)}</td><td><div className="product-cell"><span><strong>{movement.product_name}</strong><small>{movement.sku}</small></span></div></td><td className={`number-cell ${movement.quantity_change < 0 ? "negative-number" : "positive-number"}`}>{movement.quantity_change > 0 ? "+" : ""}{movement.quantity_change}</td><td className="number-cell">{movement.stock_after}</td><td>{movement.note || "—"}</td><td>{movement.actor_name}</td></tr>)}
    {!movements.length && <tr><td colSpan={6}><EmptyState text="Tidak ada riwayat pada rentang tanggal ini." /></td></tr>}
  </tbody></table></div>;
}

function StockBadge({ product }: { product: Product }) {
  const empty = product.stock === 0;
  const low = !empty && product.stock <= product.min_stock;
  return <span className={`status-pill ${empty ? "status-empty" : low ? "status-low" : "status-safe"}`}><span />{empty ? "Habis" : low ? "Menipis" : "Aman"}</span>;
}

function MovementBadge({ type }: { type: InventoryMovement["movement_type"] }) {
  return <span className={`movement-badge movement-${type}`}>{type === "masuk" ? "Barang masuk" : type === "koreksi" ? "Koreksi" : "Penjualan"}</span>;
}

function SaleDialog({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  return <div className="modal-backdrop sale-print-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog sale-dialog" role="dialog" aria-modal="true" aria-labelledby="sale-dialog-title">
      <div className="dialog-heading"><div><span className="eyebrow">RINCIAN TRANSAKSI</span><h2 id="sale-dialog-title">{sale.receipt_number}</h2></div><button className="icon-button" onClick={onClose} aria-label="Tutup"><X size={19} /></button></div>
      <div className="receipt-meta"><span><small>Tanggal</small><strong>{shortDate(sale.created_at)}</strong></span><span><small>Kasir</small><strong>{sale.cashier_name}</strong></span><span><small>Pembayaran</small><strong>{sale.payment_method.toUpperCase()}</strong></span></div>
      <div className="table-scroll"><table><thead><tr><th>PRODUK</th><th>QTY</th><th>HARGA</th><th>SUBTOTAL</th></tr></thead><tbody>{sale.items.map((item) => <tr key={item.id}><td><strong>{item.product_name}</strong><small className="table-subtext">{item.sku}</small></td><td>{item.quantity}</td><td className="number-cell">{rupiah(item.unit_price)}</td><td className="number-cell">{rupiah(item.subtotal)}</td></tr>)}</tbody></table></div>
      <div className="receipt-summary"><span>Total pembayaran</span><strong>{rupiah(sale.total)}</strong>{sale.payment_method === "tunai" && <><span>Uang diterima</span><strong>{rupiah(sale.amount_received)}</strong><span>Kembalian</span><strong>{rupiah(sale.change_due)}</strong></>}</div>
      <div className="dialog-actions"><button className="button button-ghost" onClick={onClose}>Tutup</button><button className="button button-primary" onClick={() => window.print()}><Printer size={16} />Cetak tanda terima</button></div>
    </section>
  </div>;
}

function ReceiptDialog({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  return <div className="modal-backdrop receipt-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog receipt-dialog" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
      <button className="icon-button receipt-close" onClick={onClose} aria-label="Tutup"><X size={18} /></button>
      <div className="receipt-paper">
        <div className="receipt-brand"><span className="brand-mark"><Store size={18} /></span><strong>Ritel</strong><small>TOKO UTAMA</small></div>
        <div className="receipt-title"><span>TANDA TERIMA</span><strong id="receipt-title">{sale.receipt_number}</strong></div>
        <div className="receipt-line"><span>{shortDate(sale.created_at)}</span><span>{sale.cashier_name}</span></div>
        <div className="receipt-items">{sale.items.map((item) => <div key={item.id}><div><strong>{item.product_name}</strong><span>{item.quantity} × {rupiah(item.unit_price)}</span></div><strong>{rupiah(item.subtotal)}</strong></div>)}</div>
        <div className="receipt-total-line"><span>TOTAL</span><strong>{rupiah(sale.total)}</strong></div>
        <div className="receipt-line"><span>Pembayaran</span><span>{sale.payment_method.toUpperCase()}</span></div>
        {sale.payment_method === "tunai" && <><div className="receipt-line"><span>Uang diterima</span><span>{rupiah(sale.amount_received)}</span></div><div className="receipt-line"><span>Kembalian</span><span>{rupiah(sale.change_due)}</span></div></>}
        <p className="receipt-thanks">Terima kasih telah berbelanja.</p>
        <small className="receipt-note">Barang yang sudah dibeli tidak dapat ditukar.</small>
      </div>
      <div className="receipt-actions"><button className="button button-ghost" onClick={onClose}>Tutup</button><button className="button button-primary" onClick={() => window.print()}><Printer size={16} />Cetak tanda terima</button></div>
    </section>
  </div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><span className="empty-state-icon"><ClipboardList size={18} /></span><span>{text}</span></div>;
}
