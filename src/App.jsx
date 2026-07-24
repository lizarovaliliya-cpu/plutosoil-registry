import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Search, Plus, Trash2, Download, Users, RefreshCw, Clock, X, Fuel,
  ArrowUpDown, ArrowUp, ArrowDown, Gauge, LogIn, LogOut, WifiOff, ShoppingCart
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient.js";
import { SEED_DATA } from "./seedData.js";
import {
  genId, todayStr, toNum, fmtInt, fmtT, timeAgo, colorForName,
  fromDbClient, toDbClient, fromDbSale,
} from "./utils.js";
import Sidebar from "./Sidebar.jsx";
import ClientsView from "./ClientsView.jsx";
import SalesView from "./SalesView.jsx";
import SellModal from "./SellModal.jsx";

/* ============================================================
   PlutosOil — Реестр покупателей топлива
   Реестр в реальном времени на Supabase: несколько менеджеров
   видят правки друг друга мгновенно (Postgres Realtime),
   плюс присутствие "кто сейчас в реестре" (Supabase Presence).
   ============================================================ */

const FUELS = ["АИ-92", "АИ-95", "ДТ К5"];
const DENSITY = { "АИ-92": 0.745, "АИ-95": 0.75, "ДТ К5": 0.84 }; // кг/л, из исходного реестра

const STATUSES = [
  { value: "", label: "Новый", color: "#7A8794", bg: "#EEF1F4" },
  { value: "КП отправлено", label: "КП отправлено", color: "#175983", bg: "#DCEAF3" },
  { value: "Проект договора", label: "Проект договора", color: "#7C5CBF", bg: "#EEE8FA" },
  { value: "Счёт выставлен", label: "Счёт выставлен", color: "#B9770E", bg: "#FBEEDA" },
  { value: "Уточняет", label: "Уточняет", color: "#C9750E", bg: "#FCEBD3" },
  { value: "Думает", label: "Думает", color: "#D68A1E", bg: "#FDF0DC" },
  { value: "Купили", label: "Купили", color: "#1E8A56", bg: "#E1F4EA" },
  { value: "Отказ", label: "Отказ", color: "#C13B3B", bg: "#FBE4E4" },
];
const statusMeta = (v) => STATUSES.find((s) => s.value === (v || "")) || STATUSES[0];

/* ---- преобразование camelCase (UI) <-> snake_case (Supabase) ---- */
const fromDb = (r) => ({
  id: r.id, no: r.no, name: r.name || "", contact: r.contact || "", source: r.source || "",
  phone: r.phone || "", fuel: r.fuel || "", weeklyNeed: r.weekly_need ?? "", updateDate: r.update_date || "",
  status: r.status || "", statedNeed: r.stated_need || "", purchased: r.purchased ?? "",
  purchaseSum: r.purchase_sum ?? "", comment: r.comment || "", updatedBy: r.updated_by || "",
  updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0, clientId: r.client_id || null,
});
const toDb = (r) => ({
  id: r.id, no: toNum(r.no), name: r.name, contact: r.contact, source: r.source, phone: r.phone,
  fuel: r.fuel, weekly_need: r.weeklyNeed === "" ? null : toNum(r.weeklyNeed),
  update_date: r.updateDate, status: r.status, stated_need: r.statedNeed,
  purchased: r.purchased === "" ? null : toNum(r.purchased),
  purchase_sum: r.purchaseSum === "" ? null : toNum(r.purchaseSum),
  comment: r.comment, updated_by: r.updatedBy,
});

/* ---------- инлайн-редактируемая ячейка ---------- */
function Cell({ value, onCommit, type = "text", options, align, mono, placeholder }) {
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value]);
  const commit = () => { if (local !== (value ?? "")) onCommit(local); };

  if (type === "select") {
    return (
      <select className="ps-select" value={local ?? ""} onChange={(e) => { setLocal(e.target.value); onCommit(e.target.value); }}
        style={{ color: statusMeta(local).color, background: statusMeta(local).bg }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (type === "fuel") {
    return (
      <select className="ps-select ps-select--fuel" value={local ?? ""} onChange={(e) => { setLocal(e.target.value); onCommit(e.target.value); }}>
        <option value="">—</option>
        {FUELS.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
    );
  }
  return (
    <input className="ps-input" style={{ textAlign: align || "left", fontFamily: mono ? "var(--font-mono)" : "inherit" }}
      type={type} value={local ?? ""} placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} />
  );
}

function FuelGauge({ fuel, stats }) {
  const pct = stats.weekly > 0 ? Math.min(100, (stats.purchased / stats.weekly) * 100) : 0;
  return (
    <div className="ps-gauge">
      <div className="ps-gauge__top"><span className="ps-gauge__fuel">{fuel}</span><span className="ps-gauge__pct">{pct.toFixed(0)}%</span></div>
      <div className="ps-gauge__track"><div className="ps-gauge__fill" style={{ width: `${pct}%` }} /></div>
      <div className="ps-gauge__nums"><span><b>{fmtInt(stats.purchased)}</b> л куплено</span><span className="ps-gauge__need">из {fmtInt(stats.weekly)} л/нед</span></div>
      <div className="ps-gauge__meta">{stats.count} заявок · ≈{fmtT(stats.weekly * DENSITY[fuel])} т/нед · {fmtInt(stats.sum)} ₽ выручки</div>
    </div>
  );
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [connError, setConnError] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [managerName, setManagerName] = useState("");
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [presenceList, setPresenceList] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(null);
  const [fuelFilter, setFuelFilter] = useState(null);
  const [sortKey, setSortKey] = useState("no");
  const [sortDir, setSortDir] = useState("asc");
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [view, setView] = useState("registry");
  const [clients, setClients] = useState([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [sales, setSales] = useState([]);
  const [salesLoaded, setSalesLoaded] = useState(false);
  const [sellModal, setSellModal] = useState(null); // { clientId } | null
  const [, forceTick] = useState(0);
  const presenceChannelRef = useRef(null);

  /* ---- вход по email/паролю (Supabase Auth) ---- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthChecked(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user?.email) setManagerName(session.user.email.split("@")[0]);
    else { setManagerName(""); setRows([]); setLoaded(false); }
  }, [session]);

  const handleSignIn = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword });
    setAuthLoading(false);
    if (error) setAuthError(error.message === "Invalid login credentials" ? "Неверный email или пароль." : error.message);
  };

  /* ---- начальная загрузка + realtime подписка (только для вошедших) ---- */
  useEffect(() => {
    if (!session) return;
    let rowsChannel;
    (async () => {
      const { data, error } = await supabase.from("registry_rows").select("*").order("no", { ascending: true });
      if (error) { setConnError(true); setLoaded(true); return; }
      if (!data || data.length === 0) {
        const { error: insErr } = await supabase.from("registry_rows").insert(SEED_DATA);
        if (insErr) { setConnError(true); setLoaded(true); return; }
        setRows(SEED_DATA.map(fromDb));
      } else {
        setRows(data.map(fromDb));
      }
      setLoaded(true);
      setLastSync(Date.now());

      rowsChannel = supabase.channel("registry-rows-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "registry_rows" }, (payload) => {
          setRows((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((r) => r.id !== payload.old.id);
            const incoming = fromDb(payload.new);
            const exists = prev.some((r) => r.id === incoming.id);
            const next = exists ? prev.map((r) => (r.id === incoming.id ? incoming : r)) : [...prev, incoming];
            return next;
          });
          setLastSync(Date.now());
        })
        .subscribe();
    })();
    return () => { if (rowsChannel) supabase.removeChannel(rowsChannel); };
  }, [session]);

  /* ---- клиенты: загрузка + realtime ---- */
  useEffect(() => {
    if (!session) { setClients([]); setClientsLoaded(false); return; }
    let channel;
    (async () => {
      const { data } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
      setClients((data || []).map(fromDbClient));
      setClientsLoaded(true);
      channel = supabase.channel("clients-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, (payload) => {
          setClients((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((c) => c.id !== payload.old.id);
            const incoming = fromDbClient(payload.new);
            const exists = prev.some((c) => c.id === incoming.id);
            return exists ? prev.map((c) => (c.id === incoming.id ? incoming : c)) : [incoming, ...prev];
          });
        })
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [session]);

  /* ---- продажи: загрузка + realtime ---- */
  useEffect(() => {
    if (!session) { setSales([]); setSalesLoaded(false); return; }
    let channel;
    (async () => {
      const { data } = await supabase.from("sales").select("*").order("sale_date", { ascending: false });
      setSales((data || []).map(fromDbSale));
      setSalesLoaded(true);
      channel = supabase.channel("sales-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, (payload) => {
          setSales((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((s) => s.id !== payload.old.id);
            const incoming = fromDbSale(payload.new);
            const exists = prev.some((s) => s.id === incoming.id);
            return exists ? prev.map((s) => (s.id === incoming.id ? incoming : s)) : [incoming, ...prev];
          });
        })
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [session]);

  const createClient = async (draft) => {
    const maxNo = clients.reduce((m, c) => Math.max(m, toNum(c.clientNo)), 0);
    const payload = { ...toDbClient(draft), client_no: maxNo + 1, created_by: managerName || "Гость" };
    const { data, error } = await supabase.from("clients").insert([payload]).select().single();
    if (!error && data) setClients((prev) => [fromDbClient(data), ...prev]);
  };
  const updateClient = async (draft) => {
    const { error } = await supabase.from("clients").update(toDbClient(draft)).eq("id", draft.id);
    if (!error) setClients((prev) => prev.map((c) => (c.id === draft.id ? { ...draft } : c)));
  };
  const deleteClient = async (id) => {
    await supabase.from("clients").delete().eq("id", id);
    setClients((prev) => prev.filter((c) => c.id !== id));
  };

  /* ---- присутствие менеджеров (Supabase Presence) ---- */
  useEffect(() => {
    if (!managerName) return;
    const channel = supabase.channel("presence-room", { config: { presence: { key: managerName } } });
    presenceChannelRef.current = channel;
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      setPresenceList(Object.keys(state));
    });
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") await channel.track({ online_at: Date.now() });
    });
    return () => supabase.removeChannel(channel);
  }, [managerName]);

  useEffect(() => {
    const iv = setInterval(() => forceTick((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const commitField = useCallback(async (id, field, value) => {
    const updatedBy = managerName || "Гость";
    const updatedAt = Date.now();
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value, updatedBy, updatedAt } : r)));
    setSyncing(true);
    const dbField = {
      name: "name", contact: "contact", source: "source", phone: "phone", fuel: "fuel",
      weeklyNeed: "weekly_need", updateDate: "update_date", status: "status", statedNeed: "stated_need",
      purchased: "purchased", purchaseSum: "purchase_sum", comment: "comment",
    }[field];
    const val = ["weeklyNeed", "purchased", "purchaseSum"].includes(field) ? (value === "" ? null : toNum(value)) : value;
    const { error } = await supabase.from("registry_rows").update({ [dbField]: val, updated_by: updatedBy }).eq("id", id);
    setConnError(!!error);
    setSyncing(false);
    setLastSync(Date.now());
  }, [managerName]);

  const addRow = async () => {
    const maxNo = rows.reduce((m, r) => Math.max(m, toNum(r.no)), 0);
    const row = {
      id: genId(), no: maxNo + 1, name: "", contact: "", source: "", phone: "",
      fuel: "ДТ К5", weeklyNeed: "", updateDate: todayStr(), status: "", statedNeed: "",
      purchased: "", purchaseSum: "", comment: "", updatedBy: managerName || "Гость", updatedAt: Date.now(),
    };
    setRows((prev) => [...prev, row]);
    setSyncing(true);
    const { error } = await supabase.from("registry_rows").insert([toDb(row)]);
    setConnError(!!error);
    setSyncing(false);
    setLastSync(Date.now());
  };

  const removeRow = async (id) => {
    if (deleteConfirm !== id) { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm((c) => (c === id ? null : c)), 3000); return; }
    setDeleteConfirm(null);
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSyncing(true);
    const { error } = await supabase.from("registry_rows").delete().eq("id", id);
    setConnError(!!error);
    setSyncing(false);
    setLastSync(Date.now());
  };

  const actualize = (id) => commitField(id, "updateDate", todayStr());

  const filtered = useMemo(() => {
    let out = rows;
    if (statusFilter !== null) out = out.filter((r) => (r.status || "") === statusFilter);
    if (fuelFilter) out = out.filter((r) => r.fuel === fuelFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) => [r.name, r.contact, r.phone, r.source, r.comment, r.statedNeed].some((v) => (v || "").toString().toLowerCase().includes(q)));
    }
    const dir = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (["no", "weeklyNeed", "purchased", "purchaseSum"].includes(sortKey)) { av = toNum(av); bv = toNum(bv); }
      else { av = (av || "").toString().toLowerCase(); bv = (bv || "").toString().toLowerCase(); }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return out;
  }, [rows, search, statusFilter, fuelFilter, sortKey, sortDir]);

  const summary = useMemo(() => {
    const byFuel = {};
    FUELS.forEach((f) => (byFuel[f] = { count: 0, weekly: 0, purchased: 0, sum: 0 }));
    const clientSet = new Set();
    let totalSum = 0, totalPurchased = 0;
    rows.forEach((r) => {
      clientSet.add(`${r.no}|${r.name}`);
      totalSum += toNum(r.purchaseSum);
      totalPurchased += toNum(r.purchased);
      if (byFuel[r.fuel]) {
        byFuel[r.fuel].count++;
        byFuel[r.fuel].weekly += toNum(r.weeklyNeed);
        byFuel[r.fuel].purchased += toNum(r.purchased);
        byFuel[r.fuel].sum += toNum(r.purchaseSum);
      }
    });
    return { byFuel, totalClients: clientSet.size, totalSum, totalPurchased, totalRows: rows.length };
  }, [rows]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };
  const SortIcon = ({ colKey }) => sortKey !== colKey
    ? <ArrowUpDown size={12} className="ps-sorticon ps-sorticon--idle" />
    : (sortDir === "asc" ? <ArrowUp size={12} className="ps-sorticon" /> : <ArrowDown size={12} className="ps-sorticon" />);

  const exportExcel = () => {
    const headers = ["№", "Наименование", "Контактное лицо", "Источник", "Номер телефона", "Вид топлива",
      "Недельная потребность, л", "Дата актуализации", "Статус", "Заявленная потребность (исх.)",
      "Куплено", "Сумма покупки, ₽", "Комментарий", "Изменил", "Когда изменено"];
    const body = filtered.map((r) => [r.no, r.name, r.contact, r.source, r.phone, r.fuel, toNum(r.weeklyNeed) || r.weeklyNeed,
      r.updateDate, r.status, r.statedNeed, toNum(r.purchased) || r.purchased, toNum(r.purchaseSum) || r.purchaseSum,
      r.comment, r.updatedBy, r.updatedAt ? new Date(r.updatedAt).toLocaleString("ru-RU") : ""]);
    const ws1 = XLSX.utils.aoa_to_sheet([headers, ...body]);
    ws1["!cols"] = headers.map(() => ({ wch: 16 }));
    const sumHeaders = ["Вид топлива", "Кол-во заявок", "Потребность на неделю, л", "Куплено, л", "Выручка, ₽", "Потребность на неделю, т (ориент.)"];
    const sumBody = FUELS.map((f) => { const s = summary.byFuel[f]; return [f, s.count, s.weekly, s.purchased, s.sum, +(s.weekly * DENSITY[f] / 1000).toFixed(2)]; });
    sumBody.push(["ИТОГО", summary.totalRows, FUELS.reduce((a, f) => a + summary.byFuel[f].weekly, 0), summary.totalPurchased, summary.totalSum, ""]);
    const ws2 = XLSX.utils.aoa_to_sheet([sumHeaders, ...sumBody]);
    ws2["!cols"] = sumHeaders.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Реестр покупателей");
    XLSX.utils.book_append_sheet(wb, ws2, "Сводная");
    XLSX.writeFile(wb, `Реестр_покупателей_PlutosOil_${todayStr().replace(/\./g, "-")}.xlsx`);
  };

  if (!authChecked) {
    return (
      <div className="ps-app">
        <GlobalStyle />
        <div className="ps-gate"><div className="ps-gate__card">Загрузка…</div></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="ps-app">
        <GlobalStyle />
        <div className="ps-gate">
          <div className="ps-gate__card">
            <div className="ps-gate__brand"><Fuel size={22} /> PlutosOil</div>
            <h1>Реестр покупателей топлива</h1>
            <p>Доступ только для сотрудников. Войдите под своим email и паролем.</p>
            <form onSubmit={handleSignIn}>
              <input autoFocus type="email" autoComplete="username" className="ps-gate__input" placeholder="Email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
              <input type="password" autoComplete="current-password" className="ps-gate__input" placeholder="Пароль" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
              <button type="submit" className="ps-btn ps-btn--primary" disabled={!authEmail.trim() || !authPassword || authLoading}>
                <LogIn size={16} /> {authLoading ? "Входим…" : "Войти"}
              </button>
            </form>
            {authError && <p style={{ color: "#C13B3B", marginTop: 12 }}>{authError}</p>}
            <p style={{ fontSize: 12, color: "#8A94A0", marginTop: 16 }}>Нет учётной записи? Обратитесь к администратору реестра — доступы выдаются вручную.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ps-app">
      <GlobalStyle />
      <div className="ps-shell">
        <Sidebar view={view} setView={setView} />
        <div className="ps-main">
          <header className="ps-header">
            <div className="ps-header__brand"><Fuel size={20} /><span>PlutosOil</span><span className="ps-header__sub">{{ registry: "Реестр покупателей", clients: "Клиенты", sales: "Продажи" }[view]}</span></div>
            <div className="ps-header__presence">
              <Users size={14} />
              <div className="ps-avatars">
                {presenceList.length === 0 && <span className="ps-header__you">{managerName}</span>}
                {presenceList.map((name) => <span key={name} className="ps-avatar" style={{ background: colorForName(name) }} title={name}>{name.trim().slice(0, 1).toUpperCase()}</span>)}
              </div>
            </div>
            <div className="ps-header__sync">
              {connError ? <><WifiOff size={13} /> нет связи с базой</> : <><RefreshCw size={13} className={syncing ? "ps-spin" : ""} />{syncing ? "сохранение…" : lastSync ? `синхронизировано ${timeAgo(lastSync)}` : "…"}</>}
            </div>
            <button className="ps-btn ps-header__sell" onClick={() => setSellModal({ clientId: null })}><ShoppingCart size={14} /> Продать</button>
            <button className="ps-btn ps-header__logout" onClick={() => supabase.auth.signOut()}><LogOut size={14} /> Выйти</button>
          </header>

          {view === "clients" ? (
            <ClientsView
              clients={clients} loaded={clientsLoaded} rows={rows} sales={sales} managerName={managerName}
              onCreate={createClient} onUpdate={updateClient} onDelete={deleteClient}
              onSell={(clientId) => setSellModal({ clientId })}
            />
          ) : view === "sales" ? (
            <SalesView
              sales={sales} salesLoaded={salesLoaded} clients={clients} managerName={managerName}
              onOpenSell={(clientId) => setSellModal({ clientId })}
            />
          ) : (
            <>
              <div className="ps-dash">
                {FUELS.map((f) => <FuelGauge key={f} fuel={f} stats={summary.byFuel[f]} />)}
                <div className="ps-dash__total">
                  <div className="ps-dash__total-row"><Gauge size={14} /><span>Итого по реестру</span></div>
                  <div className="ps-dash__total-num">{summary.totalClients}</div>
                  <div className="ps-dash__total-label">клиентов · {summary.totalRows} заявок</div>
                  <div className="ps-dash__total-sum">{fmtInt(summary.totalSum)} ₽</div>
                  <div className="ps-dash__total-label">выручка от закупок на сейчас</div>
                </div>
              </div>

              <div className="ps-toolbar">
                <div className="ps-search">
                  <Search size={15} />
                  <input placeholder="Поиск: компания, контакт, телефон, комментарий…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  {search && <X size={14} className="ps-search__clear" onClick={() => setSearch("")} />}
                </div>
                <div className="ps-chips">
                  <button className={`ps-chip ${fuelFilter === null ? "ps-chip--on" : ""}`} onClick={() => setFuelFilter(null)}>Все виды</button>
                  {FUELS.map((f) => <button key={f} className={`ps-chip ${fuelFilter === f ? "ps-chip--on" : ""}`} onClick={() => setFuelFilter(fuelFilter === f ? null : f)}>{f}</button>)}
                </div>
                <div className="ps-chips">
                  <button className={`ps-chip ${statusFilter === null ? "ps-chip--on" : ""}`} onClick={() => setStatusFilter(null)}>Все статусы</button>
                  {STATUSES.filter((s) => s.value).map((s) => (
                    <button key={s.value} className={`ps-chip ${statusFilter === s.value ? "ps-chip--on" : ""}`}
                      style={statusFilter === s.value ? { background: s.bg, color: s.color, borderColor: s.color } : {}}
                      onClick={() => setStatusFilter(statusFilter === s.value ? null : s.value)}>{s.label}</button>
                  ))}
                </div>
                <div className="ps-toolbar__spacer" />
                <button className="ps-btn" onClick={exportExcel}><Download size={15} /> Excel</button>
                <button className="ps-btn ps-btn--primary" onClick={addRow}><Plus size={15} /> Покупатель</button>
              </div>

              <div className="ps-tablewrap">
                <table className="ps-table">
                  <thead>
                    <tr>
                      <th onClick={() => toggleSort("no")}>№ <SortIcon colKey="no" /></th>
                      <th onClick={() => toggleSort("name")} className="ps-th-wide">Наименование <SortIcon colKey="name" /></th>
                      <th>Контакт</th><th>Источник</th><th>Телефон</th><th>Топливо</th>
                      <th onClick={() => toggleSort("weeklyNeed")}>Потр., л/нед <SortIcon colKey="weeklyNeed" /></th>
                      <th className="ps-th-wide">Заявлено (исх.)</th>
                      <th onClick={() => toggleSort("updateDate")}>Актуализация <SortIcon colKey="updateDate" /></th>
                      <th onClick={() => toggleSort("status")}>Статус <SortIcon colKey="status" /></th>
                      <th onClick={() => toggleSort("purchased")}>Куплено, л <SortIcon colKey="purchased" /></th>
                      <th onClick={() => toggleSort("purchaseSum")}>Сумма, ₽ <SortIcon colKey="purchaseSum" /></th>
                      <th className="ps-th-wide">Комментарий</th><th>Изменил</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id}>
                        <td className="ps-td-no">{r.no}</td>
                        <td><Cell value={r.name} onCommit={(v) => commitField(r.id, "name", v)} placeholder="Компания" /></td>
                        <td><Cell value={r.contact} onCommit={(v) => commitField(r.id, "contact", v)} placeholder="Контакт" /></td>
                        <td><Cell value={r.source} onCommit={(v) => commitField(r.id, "source", v)} placeholder="Источник" /></td>
                        <td><Cell value={r.phone} onCommit={(v) => commitField(r.id, "phone", v)} mono placeholder="+7…" /></td>
                        <td><Cell type="fuel" value={r.fuel} onCommit={(v) => commitField(r.id, "fuel", v)} /></td>
                        <td><Cell type="number" align="right" mono value={r.weeklyNeed} onCommit={(v) => commitField(r.id, "weeklyNeed", v)} /></td>
                        <td><Cell value={r.statedNeed} onCommit={(v) => commitField(r.id, "statedNeed", v)} placeholder="со слов клиента" /></td>
                        <td className="ps-td-date">
                          <Cell value={r.updateDate} onCommit={(v) => commitField(r.id, "updateDate", v)} mono placeholder="дд.мм.гггг" />
                          <button className="ps-mini" title="Проставить сегодняшнюю дату" onClick={() => actualize(r.id)}><Clock size={12} /></button>
                        </td>
                        <td><Cell type="select" options={STATUSES} value={r.status} onCommit={(v) => commitField(r.id, "status", v)} /></td>
                        <td><Cell type="number" align="right" mono value={r.purchased} onCommit={(v) => commitField(r.id, "purchased", v)} /></td>
                        <td><Cell type="number" align="right" mono value={r.purchaseSum} onCommit={(v) => commitField(r.id, "purchaseSum", v)} /></td>
                        <td><Cell value={r.comment} onCommit={(v) => commitField(r.id, "comment", v)} placeholder="—" /></td>
                        <td className="ps-td-meta">{r.updatedBy ? (<><span style={{ color: colorForName(r.updatedBy) }}>{r.updatedBy}</span><br /><span className="ps-td-meta__time">{timeAgo(r.updatedAt)}</span></>) : "—"}</td>
                        <td><button className={`ps-del ${deleteConfirm === r.id ? "ps-del--confirm" : ""}`} onClick={() => removeRow(r.id)}>{deleteConfirm === r.id ? "Точно?" : <Trash2 size={14} />}</button></td>
                      </tr>
                    ))}
                    {filtered.length === 0 && <tr><td colSpan={15} className="ps-empty">{loaded ? "Ничего не найдено — попробуйте изменить поиск или фильтры." : "Загрузка…"}</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="ps-footnote">Плотность для перевода в тонны (ориентировочно): АИ-92 — 0,745 кг/л, АИ-95 — 0,750 кг/л, ДТ К5 — 0,840 кг/л (из исходного реестра).</div>
            </>
          )}
        </div>
      </div>
      {sellModal && (
        <SellModal
          clients={clients} managerName={managerName} presetClientId={sellModal.clientId}
          onClose={() => setSellModal(null)}
        />
      )}
    </div>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
      html,body,#root{height:100%;font-family:'Inter',sans-serif;}
      .ps-app { --ink:#10151C; --paper:#F2F5F7; --panel:#FFFFFF; --line:#DEE4E9; --petrol:#0E3A53; --petrol-2:#175983; --amber:#E8871E; --green:#1E8A56; --red:#C13B3B; --violet:#7C5CBF; --font-display:'Space Grotesk',sans-serif; --font-body:'Inter',sans-serif; --font-mono:'IBM Plex Mono',monospace; font-family: var(--font-body); color: var(--ink); background: var(--paper); min-height:100vh; }
      .ps-app * { box-sizing: border-box; }
      .ps-shell { display:flex; min-height:100vh; }
      .ps-main { flex:1; min-width:0; display:flex; flex-direction:column; }
      .ps-sidebar { width:208px; flex-shrink:0; background: var(--ink); color:#fff; display:flex; flex-direction:column; padding:18px 12px; gap:2px; }
      .ps-sidebar__brand { font-family: var(--font-display); font-weight:700; font-size:15px; display:flex; align-items:center; gap:8px; padding:0 8px 18px; opacity:0.95; }
      .ps-sidebar__item { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:9px; color:rgba(255,255,255,0.65); font-size:13px; font-weight:500; cursor:pointer; border:none; background:transparent; text-align:left; width:100%; }
      .ps-sidebar__item:hover { background:rgba(255,255,255,0.06); color:#fff; }
      .ps-sidebar__item--on { background: var(--petrol-2); color:#fff; }
      .ps-sidebar__item--soon { cursor:default; opacity:0.4; }
      .ps-sidebar__item--soon:hover { background:transparent; color:rgba(255,255,255,0.65); }
      .ps-sidebar__badge { margin-left:auto; font-size:9.5px; text-transform:uppercase; letter-spacing:0.04em; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:10px; }
      .ps-gate { min-height: 480px; display:flex; align-items:center; justify-content:center; padding: 32px; }
      .ps-gate__card { background: var(--panel); border:1px solid var(--line); border-radius: 16px; padding: 36px; max-width: 380px; box-shadow: 0 1px 2px rgba(16,21,28,0.04); }
      .ps-gate__brand { font-family: var(--font-display); font-weight:700; color: var(--petrol); display:flex; align-items:center; gap:8px; }
      .ps-gate__card h1 { font-family: var(--font-display); font-size: 22px; margin: 14px 0 8px; }
      .ps-gate__card p { font-size: 13.5px; color:#5B6770; line-height:1.5; margin-bottom:20px; }
      .ps-gate__input { width:100%; padding:11px 12px; border:1px solid var(--line); border-radius:10px; font-size:14px; margin-bottom:12px; font-family: var(--font-body); }
      .ps-gate__input:focus { outline:2px solid var(--petrol-2); outline-offset:1px; }
      .ps-btn { display:inline-flex; align-items:center; gap:6px; padding:9px 14px; border-radius:9px; border:1px solid var(--line); background: var(--panel); font-size:13px; font-weight:500; cursor:pointer; color:var(--ink); white-space:nowrap; }
      .ps-btn:hover { border-color:#C3CBD2; }
      .ps-btn--primary { background: var(--petrol); border-color: var(--petrol); color:#fff; width:100%; justify-content:center; }
      .ps-btn--primary:hover { background: var(--petrol-2); }
      .ps-btn--primary:disabled { opacity:0.5; cursor:not-allowed; }
      .ps-header { display:flex; align-items:center; gap:20px; padding:14px 22px; background: var(--petrol); color:#fff; flex-wrap:wrap; }
      .ps-header__brand { font-family: var(--font-display); font-weight:700; font-size:15px; display:flex; align-items:center; gap:8px; }
      .ps-header__sub { font-family: var(--font-body); font-weight:400; opacity:0.65; font-size:12.5px; border-left:1px solid rgba(255,255,255,0.3); padding-left:10px; }
      .ps-header__presence { display:flex; align-items:center; gap:8px; margin-left:auto; opacity:0.9; font-size:12px; }
      .ps-avatars { display:flex; gap:4px; }
      .ps-avatar { width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:600; color:#fff; border:1.5px solid rgba(255,255,255,0.6); }
      .ps-header__you { font-size:12px; opacity:0.85; }
      .ps-header__sync { display:flex; align-items:center; gap:6px; font-size:11.5px; opacity:0.75; }
      .ps-header__logout { background:transparent; border-color:rgba(255,255,255,0.3); color:#fff; opacity:0.85; }
      .ps-header__logout:hover { background:rgba(255,255,255,0.1); border-color:rgba(255,255,255,0.5); opacity:1; }
      .ps-header__sell { background: var(--amber); border-color: var(--amber); color:#10151C; font-weight:600; }
      .ps-header__sell:hover { filter: brightness(1.05); }
      .ps-spin { animation: ps-spin 0.9s linear infinite; }
      @keyframes ps-spin { to { transform: rotate(360deg); } }
      .ps-dash { display:grid; grid-template-columns: repeat(3, 1fr) 1.1fr; gap:12px; padding:16px 22px; }
      .ps-gauge { background: var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px 16px; }
      .ps-gauge__top { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px; }
      .ps-gauge__fuel { font-family: var(--font-display); font-weight:600; font-size:14px; color: var(--petrol); }
      .ps-gauge__pct { font-family: var(--font-mono); font-size:13px; color: var(--amber); font-weight:600; }
      .ps-gauge__track { position:relative; height:8px; background:#EAEDF0; border-radius:6px; overflow:hidden; margin-bottom:8px; }
      .ps-gauge__fill { height:100%; background: linear-gradient(90deg, var(--petrol-2), var(--amber)); border-radius:6px; transition: width 0.4s ease; }
      .ps-gauge__nums { display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:4px; }
      .ps-gauge__nums b { font-family: var(--font-mono); }
      .ps-gauge__need { color:#8A94A0; }
      .ps-gauge__meta { font-size:11px; color:#8A94A0; }
      .ps-dash__total { background: var(--ink); color:#fff; border-radius:14px; padding:14px 16px; display:flex; flex-direction:column; justify-content:center; }
      .ps-dash__total-row { display:flex; align-items:center; gap:6px; font-size:12px; opacity:0.7; margin-bottom:6px; }
      .ps-dash__total-num { font-family: var(--font-display); font-size:26px; font-weight:700; line-height:1; }
      .ps-dash__total-label { font-size:11px; opacity:0.6; margin-bottom:8px; }
      .ps-dash__total-sum { font-family: var(--font-mono); font-size:16px; color: var(--amber); }
      .ps-toolbar { display:flex; align-items:center; gap:10px; padding: 0 22px 12px; flex-wrap:wrap; }
      .ps-toolbar__spacer { flex:1; }
      .ps-search { display:flex; align-items:center; gap:7px; background: var(--panel); border:1px solid var(--line); border-radius:9px; padding:8px 12px; min-width:260px; color:#6B7680; }
      .ps-search input { border:none; outline:none; font-size:13px; flex:1; background:transparent; color: var(--ink); }
      .ps-search__clear { cursor:pointer; }
      .ps-chips { display:flex; gap:6px; flex-wrap:wrap; }
      .ps-chip { border:1px solid var(--line); background: var(--panel); border-radius:20px; padding:6px 12px; font-size:12px; cursor:pointer; color:#5B6770; }
      .ps-chip--on { background: var(--petrol); border-color: var(--petrol); color:#fff; }
      .ps-tablewrap { overflow:auto; margin:0 22px 8px; border:1px solid var(--line); border-radius:14px; background:var(--panel); flex:1; }
      .ps-table { border-collapse:collapse; width:100%; font-size:12.5px; min-width:1500px; }
      .ps-table thead th { position:sticky; top:0; background:#F6F8F9; border-bottom:1px solid var(--line); text-align:left; padding:10px 10px; font-family: var(--font-display); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:#5B6770; cursor:pointer; white-space:nowrap; user-select:none; z-index:1; }
      .ps-th-wide { min-width:150px; }
      .ps-sorticon { vertical-align:-1px; margin-left:2px; }
      .ps-sorticon--idle { opacity:0.3; }
      .ps-table tbody tr:nth-child(even) { background:#FAFBFC; }
      .ps-table tbody tr:hover { background:#F0F4F7; }
      .ps-table td { border-bottom:1px solid #EEF1F3; padding:2px 4px; vertical-align:middle; }
      .ps-td-no { text-align:center; font-family: var(--font-mono); color:#8A94A0; padding:2px 8px !important; }
      .ps-td-date { display:flex; align-items:center; gap:2px; white-space:nowrap; }
      .ps-td-meta { font-size:11px; color:#5B6770; white-space:nowrap; padding:4px 8px !important; }
      .ps-td-meta__time { color:#AEB6BD; }
      .ps-empty { text-align:center; padding:28px !important; color:#8A94A0; }
      .ps-input { width:100%; min-width:70px; border:1px solid transparent; background:transparent; padding:7px 8px; font-size:12.5px; border-radius:6px; color:var(--ink); }
      .ps-input:hover { background:#F3F6F8; }
      .ps-input:focus { outline:none; border-color: var(--petrol-2); background:#fff; box-shadow: 0 0 0 2px rgba(23,89,131,0.12); }
      .ps-input::placeholder { color:#C3CBD2; }
      .ps-select { border:1px solid transparent; border-radius:20px; padding:5px 10px; font-size:11.5px; font-weight:600; cursor:pointer; }
      .ps-select--fuel { background:#EEF1F4; color: var(--petrol); }
      .ps-select:focus { outline:none; }
      .ps-mini { border:none; background:#F0F4F7; border-radius:6px; padding:4px 5px; cursor:pointer; color:#6B7680; flex-shrink:0; }
      .ps-mini:hover { background:#E3E9EC; color: var(--petrol); }
      .ps-del { border:none; background:transparent; color:#C3CBD2; cursor:pointer; padding:5px; border-radius:6px; }
      .ps-del:hover { color: var(--red); background:#FBE4E4; }
      .ps-del--confirm { color:#fff; background: var(--red); font-size:10.5px; padding:5px 8px; white-space:nowrap; }
      .ps-footnote { padding:8px 22px 16px; font-size:11px; color:#8A94A0; }

      .ps-client-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:12px; padding:0 22px 22px; overflow:auto; flex:1; align-content:start; }
      .ps-client-card { text-align:left; background: var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px 16px; cursor:pointer; display:flex; flex-direction:column; gap:6px; font-family: var(--font-body); }
      .ps-client-card:hover { border-color: var(--petrol-2); box-shadow: 0 1px 4px rgba(16,21,28,0.06); }
      .ps-client-card__top { display:flex; align-items:center; gap:8px; margin-bottom:2px; }
      .ps-client-card__icon { color: var(--petrol-2); flex-shrink:0; }
      .ps-client-card__title { font-family: var(--font-display); font-weight:600; font-size:14px; color: var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ps-client-card__row { display:flex; align-items:center; gap:6px; font-size:12px; color:#5B6770; }
      .ps-client-card__bottom { display:flex; align-items:center; justify-content:space-between; margin-top:8px; }
      .ps-client-card__stat { font-size:11px; color:#8A94A0; }

      .ps-drawer__overlay { position:fixed; inset:0; background:rgba(16,21,28,0.35); display:flex; justify-content:flex-end; z-index:50; }
      .ps-drawer__panel { width:min(460px, 100%); background: var(--paper); height:100%; display:flex; flex-direction:column; box-shadow:-4px 0 20px rgba(16,21,28,0.15); }
      .ps-drawer__head { display:flex; align-items:center; justify-content:space-between; padding:18px 22px; border-bottom:1px solid var(--line); background: var(--panel); }
      .ps-drawer__head h2 { font-family: var(--font-display); font-size:17px; margin:0; }
      .ps-drawer__body { flex:1; overflow:auto; padding:18px 22px; display:flex; flex-direction:column; gap:12px; }
      .ps-drawer__foot { display:flex; align-items:center; gap:8px; padding:14px 22px; border-top:1px solid var(--line); background: var(--panel); }
      .ps-field { display:flex; flex-direction:column; gap:5px; font-size:12.5px; color:#5B6770; }
      .ps-field input, .ps-field textarea, .ps-field select { border:1px solid var(--line); border-radius:9px; padding:9px 11px; font-size:13.5px; font-family: var(--font-body); color: var(--ink); resize: vertical; background: var(--panel); }
      .ps-field input:focus, .ps-field textarea:focus, .ps-field select:focus { outline:2px solid var(--petrol-2); outline-offset:1px; }
      .ps-sell-sum { font-family: var(--font-mono); font-size:20px; font-weight:600; color: var(--petrol); padding:8px 0; }
      .ps-sales-total { font-size:12.5px; color:#5B6770; white-space:nowrap; }
      .ps-history__row-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
      .ps-req-toggle { display:flex; align-items:center; gap:6px; border:none; background:transparent; color: var(--petrol-2); font-size:12.5px; font-weight:600; cursor:pointer; padding:4px 0; align-self:flex-start; }
      .ps-fieldset { display:flex; flex-direction:column; gap:12px; background:#EEF1F4; border-radius:12px; padding:14px; }
      .ps-file-btn { display:inline-flex; width:auto; cursor:pointer; }
      .ps-file-chip { display:flex; align-items:center; gap:6px; background:#EEF1F4; border-radius:9px; padding:7px 10px; font-size:12.5px; }
      .ps-file-chip__name { color: var(--petrol-2); cursor:pointer; text-decoration:underline; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ps-history { border-top:1px solid var(--line); padding-top:12px; }
      .ps-history__head { font-family: var(--font-display); font-weight:600; font-size:12.5px; color: var(--petrol); margin-bottom:8px; }
      .ps-history__empty { font-size:12px; color:#8A94A0; }
      .ps-history__row { display:grid; grid-template-columns: 1fr 1fr 1.2fr 1fr; gap:6px; font-size:12px; padding:6px 0; border-bottom:1px solid #EEF1F3; }
      .ps-history__fuel { font-weight:600; color: var(--petrol-2); }
      .ps-history__sum { font-family: var(--font-mono); text-align:right; }
      @media (max-width: 900px) { .ps-dash { grid-template-columns: 1fr 1fr; } }
    `}</style>
  );
}
