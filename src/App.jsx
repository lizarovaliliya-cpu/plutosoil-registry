import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Users, RefreshCw, LogIn, LogOut, WifiOff, ShoppingCart, Fuel, Tag } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient.js";
import { SEED_DATA } from "./seedData.js";
import {
  genId, todayStr, toNum, fmtInt, timeAgo, colorForName,
  fromDbClient, toDbClient, fromDbSale, fromDbPrice,
} from "./utils.js";
import { FUELS, DENSITY } from "./shared.jsx";
import Sidebar from "./Sidebar.jsx";
import ClientsView from "./ClientsView.jsx";
import SalesView from "./SalesView.jsx";
import AnalyticsView from "./AnalyticsView.jsx";
import SellModal from "./SellModal.jsx";
import PricesModal from "./PricesModal.jsx";

/* ============================================================
   PlutosOil — Реестр покупателей топлива
   Реестр в реальном времени на Supabase: несколько менеджеров
   видят правки друг друга мгновенно (Postgres Realtime),
   плюс присутствие "кто сейчас в реестре" (Supabase Presence).
   ============================================================ */

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
  comment: r.comment, updated_by: r.updatedBy, client_id: r.clientId || null,
});

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
  const [authName, setAuthName] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [presenceList, setPresenceList] = useState([]);
  const [view, setView] = useState("clients");
  const [clients, setClients] = useState([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [sales, setSales] = useState([]);
  const [salesLoaded, setSalesLoaded] = useState(false);
  const [prices, setPrices] = useState([]);
  const [sellModal, setSellModal] = useState(null); // { clientId } | null
  const [pricesModalOpen, setPricesModalOpen] = useState(false);
  const [, forceTick] = useState(0);
  const presenceChannelRef = useRef(null);

  /* ---- вход по email/паролю (Supabase Auth) ---- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthChecked(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user) setManagerName(session.user.user_metadata?.full_name || session.user.email.split("@")[0]);
    else { setManagerName(""); setRows([]); setLoaded(false); }
  }, [session]);

  const handleSignIn = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword });
    if (!error && authName.trim() && data?.user?.user_metadata?.full_name !== authName.trim()) {
      await supabase.auth.updateUser({ data: { full_name: authName.trim() } });
    }
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

  /* ---- цены на топливо: загрузка + realtime ---- */
  useEffect(() => {
    if (!session) { setPrices([]); return; }
    let channel;
    (async () => {
      const { data } = await supabase.from("fuel_prices").select("*");
      setPrices((data || []).map(fromDbPrice));
      channel = supabase.channel("fuel-prices-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "fuel_prices" }, (payload) => {
          setPrices((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((p) => p.fuel !== payload.old.fuel);
            const incoming = fromDbPrice(payload.new);
            const exists = prev.some((p) => p.fuel === incoming.fuel);
            return exists ? prev.map((p) => (p.fuel === incoming.fuel ? incoming : p)) : [...prev, incoming];
          });
        })
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [session]);

  const updatePrice = async (fuel, field, value) => {
    const num = value === "" ? null : toNum(value);
    const updatedBy = managerName || "Гость";
    setPrices((prev) => {
      const exists = prev.some((p) => p.fuel === fuel);
      const patch = { fuel, [field]: value === "" ? "" : num, updatedBy, updatedAt: Date.now() };
      return exists ? prev.map((p) => (p.fuel === fuel ? { ...p, ...patch } : p)) : [...prev, { priceCash: "", priceCashless: "", ...patch }];
    });
    const dbField = field === "priceCash" ? "price_cash" : "price_cashless";
    await supabase.from("fuel_prices").upsert({ fuel, [dbField]: num, updated_by: updatedBy }, { onConflict: "fuel" });
  };

  const createClient = async (draft) => {
    const maxNo = clients.reduce((m, c) => Math.max(m, toNum(c.clientNo)), 0);
    const payload = { ...toDbClient(draft), client_no: maxNo + 1, created_by: managerName || "Гость" };
    const { data, error } = await supabase.from("clients").insert([payload]).select().single();
    if (error || !data) return null;
    const created = fromDbClient(data);
    setClients((prev) => [created, ...prev]);
    return created;
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

  const addDealForClient = async (client) => {
    const maxNo = rows.reduce((m, r) => Math.max(m, toNum(r.no)), 0);
    const row = {
      id: genId(), no: maxNo + 1, name: client.company, contact: client.contactName, source: client.source,
      phone: client.phone, fuel: "", weeklyNeed: "", updateDate: todayStr(), status: "", statedNeed: "",
      purchased: "", purchaseSum: "", comment: "", updatedBy: managerName || "Гость", updatedAt: Date.now(),
      clientId: client.id,
    };
    setRows((prev) => [...prev, row]);
    setSyncing(true);
    const { error } = await supabase.from("registry_rows").insert([toDb(row)]);
    setConnError(!!error);
    setSyncing(false);
    setLastSync(Date.now());
  };

  const removeRow = async (id) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSyncing(true);
    const { error } = await supabase.from("registry_rows").delete().eq("id", id);
    setConnError(!!error);
    setSyncing(false);
    setLastSync(Date.now());
  };

  const actualize = (id) => commitField(id, "updateDate", todayStr());

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

  const exportExcel = () => {
    const headers = ["№", "Наименование", "Контактное лицо", "Источник", "Номер телефона", "Вид топлива",
      "Недельная потребность, л", "Дата актуализации", "Статус", "Заявленная потребность (исх.)",
      "Куплено", "Сумма покупки, ₽", "Комментарий", "Изменил", "Когда изменено"];
    const body = rows.map((r) => [r.no, r.name, r.contact, r.source, r.phone, r.fuel, toNum(r.weeklyNeed) || r.weeklyNeed,
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
    XLSX.utils.book_append_sheet(wb, ws1, "Клиенты и заявки");
    XLSX.utils.book_append_sheet(wb, ws2, "Сводная");
    XLSX.writeFile(wb, `PlutosOil_${todayStr().replace(/\./g, "-")}.xlsx`);
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
              <input type="text" className="ps-gate__input" placeholder="Ваше имя (как показывать вас в системе)" value={authName} onChange={(e) => setAuthName(e.target.value)} />
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
            <div className="ps-header__brand"><Fuel size={20} /><span>PlutosOil</span><span className="ps-header__sub">{{ clients: "Клиенты", sales: "Реестр сделок", analytics: "Аналитика" }[view]}</span></div>
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
            <button className="ps-btn" onClick={() => setPricesModalOpen(true)}><Tag size={14} /> Цены</button>
            <button className="ps-btn ps-header__sell" onClick={() => setSellModal({ clientId: null })}><ShoppingCart size={14} /> Продать</button>
            <button className="ps-btn ps-header__logout" onClick={() => supabase.auth.signOut()}><LogOut size={14} /> Выйти</button>
          </header>

          {view === "sales" ? (
            <SalesView
              sales={sales} salesLoaded={salesLoaded} clients={clients} managerName={managerName}
              onOpenSell={(clientId, sale) => setSellModal({ clientId, sale })}
            />
          ) : view === "analytics" ? (
            <AnalyticsView sales={sales} clients={clients} rows={rows} />
          ) : (
            <ClientsView
              clients={clients} loaded={clientsLoaded} rows={rows} sales={sales} managerName={managerName}
              summary={summary}
              onCreate={createClient} onUpdate={updateClient} onDelete={deleteClient}
              onSell={(clientId, sale) => setSellModal({ clientId, sale })}
              onCommitField={commitField} onRemoveRow={removeRow} onActualize={actualize}
              onAddDeal={addDealForClient} onExportExcel={exportExcel}
            />
          )}
        </div>
      </div>
      {sellModal && (
        <SellModal
          clients={clients} managerName={managerName} presetClientId={sellModal.clientId} sale={sellModal.sale}
          prices={prices} onCreateClient={createClient} onClose={() => setSellModal(null)}
        />
      )}
      {pricesModalOpen && (
        <PricesModal prices={prices} onUpdate={updatePrice} onClose={() => setPricesModalOpen(false)} />
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
      .ps-select-filter { border:1px solid var(--line); background: var(--panel); border-radius:9px; padding:8px 12px; font-size:12.5px; color: var(--ink); }
      .ps-toolbar--period { padding-top:0; margin-top:-4px; }
      .ps-period-range { display:flex; align-items:center; gap:8px; font-size:12.5px; color:#5B6770; }
      .ps-period-range input { border:1px solid var(--line); background: var(--panel); border-radius:9px; padding:7px 10px; font-size:12.5px; color: var(--ink); font-family: var(--font-body); }
      .ps-tablewrap { overflow:auto; margin:0 22px 8px; border:1px solid var(--line); border-radius:14px; background:var(--panel); flex:1; }
      .ps-table { border-collapse:collapse; width:100%; font-size:12.5px; }
      .ps-table thead th { position:sticky; top:0; background:#F6F8F9; border-bottom:1px solid var(--line); text-align:left; padding:10px 10px; font-family: var(--font-display); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:#5B6770; cursor:pointer; white-space:nowrap; user-select:none; z-index:1; }
      .ps-th-wide { min-width:150px; }
      .ps-sorticon { vertical-align:-1px; margin-left:2px; }
      .ps-sorticon--idle { opacity:0.3; }
      .ps-table tbody tr:nth-child(even) { background:#FAFBFC; }
      .ps-table tbody tr:hover { background:#F0F4F7; }
      .ps-table td { border-bottom:1px solid #EEF1F3; padding:9px 10px; vertical-align:middle; }
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

      .ps-client-row { cursor:pointer; }
      .ps-client-row:hover { background:#F0F4F7; }
      .ps-client-row__name { font-family: var(--font-display); font-weight:600; }

      .ps-drawer__overlay { position:fixed; inset:0; background:rgba(16,21,28,0.35); display:flex; justify-content:flex-end; z-index:50; }
      .ps-drawer__panel { width:min(500px, 100%); background: var(--paper); height:100%; display:flex; flex-direction:column; box-shadow:-4px 0 20px rgba(16,21,28,0.15); }
      .ps-drawer__head { display:flex; align-items:center; justify-content:space-between; padding:18px 22px; border-bottom:1px solid var(--line); background: var(--panel); }
      .ps-drawer__head h2 { font-family: var(--font-display); font-size:17px; margin:0; }
      .ps-drawer__body { flex:1; overflow:auto; padding:18px 22px; display:flex; flex-direction:column; gap:12px; }
      .ps-drawer__foot { display:flex; align-items:center; gap:8px; padding:14px 22px; border-top:1px solid var(--line); background: var(--panel); }
      .ps-field { display:flex; flex-direction:column; gap:5px; font-size:12.5px; color:#5B6770; }
      .ps-field input, .ps-field textarea, .ps-field select { border:1px solid var(--line); border-radius:9px; padding:9px 11px; font-size:13.5px; font-family: var(--font-body); color: var(--ink); resize: vertical; background: var(--panel); }
      .ps-field input:focus, .ps-field textarea:focus, .ps-field select:focus { outline:2px solid var(--petrol-2); outline-offset:1px; }
      .ps-sell-sum { font-family: var(--font-mono); font-size:20px; font-weight:600; color: var(--petrol); padding:8px 0; }
      .ps-sell-sum__breakdown { font-size:11.5px; color:#8A94A0; margin-top:-4px; }
      .ps-field-row { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
      .ps-field-head { display:flex; align-items:center; justify-content:space-between; }
      .ps-link-btn { display:inline-flex; align-items:center; gap:3px; border:none; background:transparent; color: var(--petrol-2); font-size:12px; font-weight:600; cursor:pointer; padding:0; }
      .ps-link-btn:hover { color: var(--petrol); text-decoration:underline; }
      .ps-new-client { display:flex; flex-direction:column; gap:8px; background:#EEF1F4; border-radius:12px; padding:12px; margin-top:5px; }
      .ps-new-client input, .ps-new-client select { width:100%; border:1px solid var(--line); border-radius:9px; padding:9px 11px; font-size:13.5px; font-family: var(--font-body); color: var(--ink); background: var(--panel); }
      .ps-new-client input:focus, .ps-new-client select:focus { outline:2px solid var(--petrol-2); outline-offset:1px; }
      .ps-new-client__actions { display:flex; justify-content:flex-end; gap:8px; }
      .ps-check-field { display:flex; align-items:center; gap:8px; font-size:13.5px; color: var(--ink); cursor:pointer; }
      .ps-check-field input { width:16px; height:16px; cursor:pointer; }
      .ps-price-row { border:1px solid var(--line); border-radius:12px; padding:12px 14px; background: var(--panel); display:flex; flex-direction:column; gap:8px; }
      .ps-price-row__fuel { font-family: var(--font-display); font-weight:600; font-size:13.5px; color: var(--petrol); }
      .ps-price-row__grid { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
      .ps-price-row__meta { font-size:11px; color:#AEB6BD; }
      .ps-period-summary { display:flex; align-items:center; gap:14px; margin:0 22px 16px; padding:14px 20px; background: var(--ink); color:#fff; border-radius:14px; }
      .ps-period-summary__label { font-family: var(--font-display); font-weight:600; font-size:13px; opacity:0.7; }
      .ps-period-summary__stat { font-size:13.5px; opacity:0.9; }
      .ps-period-summary__stat b { font-family: var(--font-mono); font-size:18px; font-weight:700; margin-right:4px; }
      .ps-period-summary__stat--sum b { color: var(--amber); }
      .ps-period-summary__stat--warn b { color:#E8871E; }
      .ps-ship-badge { font-size:10.5px; font-weight:600; padding:3px 8px; border-radius:20px; white-space:nowrap; }
      .ps-ship-badge--done { background:#E1F4EA; color:#1E8A56; }
      .ps-ship-badge--pending { background:#FCEBD3; color:#C9750E; }
      .ps-period-summary__divider { width:1px; height:20px; background:rgba(255,255,255,0.2); }
      .ps-history__row-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
      .ps-req-toggle { display:flex; align-items:center; gap:6px; border:none; background:transparent; color: var(--petrol-2); font-size:12.5px; font-weight:600; cursor:pointer; padding:4px 0; align-self:flex-start; }
      .ps-suggest { position:absolute; top:100%; left:0; right:0; margin-top:4px; background: var(--panel); border:1px solid var(--line); border-radius:10px; box-shadow:0 4px 16px rgba(16,21,28,0.12); z-index:20; overflow:hidden; }
      .ps-suggest__hint { font-size:10.5px; text-transform:uppercase; letter-spacing:0.03em; color:#8A94A0; padding:8px 12px 4px; }
      .ps-suggest__item { display:flex; flex-direction:column; gap:1px; width:100%; text-align:left; padding:8px 12px; border:none; background:transparent; cursor:pointer; }
      .ps-suggest__item:hover { background:#EEF1F4; }
      .ps-suggest__company { font-size:13px; font-weight:600; color: var(--ink); }
      .ps-suggest__meta { font-size:11.5px; color:#8A94A0; }
      .ps-fieldset { display:flex; flex-direction:column; gap:12px; background:#EEF1F4; border-radius:12px; padding:14px; }
      .ps-file-btn { display:inline-flex; width:auto; cursor:pointer; }
      .ps-file-chip { display:flex; align-items:center; gap:6px; background:#EEF1F4; border-radius:9px; padding:7px 10px; font-size:12.5px; }
      .ps-file-chip__name { color: var(--petrol-2); cursor:pointer; text-decoration:underline; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ps-history { border-top:1px solid var(--line); padding-top:12px; }
      .ps-history__head { font-family: var(--font-display); font-weight:600; font-size:12.5px; color: var(--petrol); margin-bottom:8px; }
      .ps-history__empty { font-size:12px; color:#8A94A0; }
      .ps-history__row { display:grid; grid-template-columns: 1fr 1fr 1fr 1.2fr 1fr; gap:6px; font-size:12px; padding:6px 0; border-bottom:1px solid #EEF1F3; align-items:center; }
      .ps-history__row--clickable { width:100%; text-align:left; border:none; background:transparent; font-family: var(--font-body); color: var(--ink); cursor:pointer; border-radius:6px; }
      .ps-history__row--clickable:hover { background:#F0F4F7; }
      .ps-history__fuel { font-weight:600; color: var(--petrol-2); }
      .ps-tara-badge { font-weight:400; color:#8A94A0; font-size:11px; }
      .ps-history__sum { font-family: var(--font-mono); text-align:right; }

      .ps-leadrow { border:1px solid var(--line); border-radius:12px; padding:10px 12px; background: var(--panel); display:flex; flex-direction:column; gap:6px; }
      .ps-leadrow__top { display:flex; align-items:center; gap:6px; }
      .ps-leadrow__top .ps-select { flex-shrink:0; }
      .ps-leadrow__spacer { flex:1; }
      .ps-leadrow__grid { display:grid; grid-template-columns: 1fr 1fr; gap:6px; }
      .ps-leadrow__mini { display:flex; flex-direction:column; gap:2px; font-size:10.5px; color:#8A94A0; }
      .ps-leadrow__mini .ps-td-date { border:1px solid var(--line); border-radius:6px; padding:0 2px; }

      .ps-journal { overflow:auto; margin:0 22px 22px; flex:1; display:flex; flex-direction:column; gap:18px; }
      .ps-journal__day-head { display:flex; align-items:baseline; justify-content:space-between; padding-bottom:6px; border-bottom:2px solid var(--ink); margin-bottom:8px; }
      .ps-journal__day-title { font-family: var(--font-display); font-weight:700; font-size:14px; text-transform:uppercase; letter-spacing:0.03em; color: var(--ink); }
      .ps-journal__day-stats { font-size:12px; color:#8A94A0; }
      .ps-journal__entries { display:flex; flex-direction:column; gap:1px; background: var(--line); border-radius:10px; overflow:hidden; }
      .ps-journal__entry { display:grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1.3fr 1fr; gap:10px; align-items:center; background: var(--panel); padding:10px 14px; font-size:12.5px; border:none; width:100%; text-align:left; font-family: var(--font-body); color: var(--ink); cursor:pointer; }
      .ps-journal__entry:hover { background:#F0F4F7; }
      .ps-journal__client { font-weight:600; }
      .ps-journal__vol { font-family: var(--font-mono); color:#5B6770; }
      .ps-journal__payment { color:#5B6770; }
      .ps-journal__sum { font-family: var(--font-mono); font-weight:600; color: var(--petrol); }
      .ps-journal__manager { text-align:right; font-size:12px; }
      @media (max-width: 900px) { .ps-dash { grid-template-columns: 1fr 1fr; } }

      .ps-kpi-grid { display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; padding:0 22px 16px; }
      .ps-kpi-card { background: var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px 16px; }
      .ps-kpi-card__label { font-size:12px; color:#8A94A0; margin-bottom:8px; }
      .ps-kpi-card__value { font-family: var(--font-display); font-size:22px; font-weight:700; color: var(--petrol); }
      .ps-analytics-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap:14px; padding:0 22px 22px; }
      .ps-panel { background: var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px 18px; }
      .ps-panel--wide { grid-column: 1 / -1; }
      .ps-panel__title { display:flex; align-items:center; gap:7px; font-family: var(--font-display); font-weight:600; font-size:13px; color: var(--petrol); margin-bottom:14px; }
      .ps-barlist { display:flex; flex-direction:column; gap:10px; }
      .ps-barlist__row { display:grid; grid-template-columns: 110px 1fr auto; align-items:center; gap:10px; font-size:12.5px; }
      .ps-barlist__label { color:#5B6770; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ps-barlist__track { height:8px; background:#EAEDF0; border-radius:6px; overflow:hidden; }
      .ps-barlist__fill { height:100%; border-radius:6px; transition: width 0.4s ease; }
      .ps-barlist__value { font-family: var(--font-mono); font-size:12px; color: var(--ink); white-space:nowrap; text-align:right; }
      .ps-trend { display:flex; align-items:flex-end; gap:10px; height:160px; padding-top:8px; }
      .ps-trend__col { flex:1; display:flex; flex-direction:column; align-items:center; height:100%; }
      .ps-trend__value { font-family: var(--font-mono); font-size:11px; color:#8A94A0; margin-bottom:4px; height:14px; }
      .ps-trend__bar-wrap { flex:1; width:100%; display:flex; align-items:flex-end; }
      .ps-trend__bar { width:100%; min-height:2px; background: linear-gradient(180deg, var(--amber), var(--petrol-2)); border-radius:6px 6px 0 0; }
      .ps-trend__label { font-size:11px; color:#8A94A0; margin-top:8px; }
      .ps-topclients { display:flex; flex-direction:column; gap:2px; }
      .ps-topclients__row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #EEF1F3; font-size:13px; }
      .ps-topclients__row:last-child { border-bottom:none; }
      .ps-topclients__rank { font-family: var(--font-mono); color:#AEB6BD; width:16px; }
      .ps-topclients__name { flex:1; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ps-topclients__sum { font-family: var(--font-mono); color: var(--petrol); font-weight:600; }
      @media (max-width: 900px) { .ps-kpi-grid { grid-template-columns: 1fr 1fr; } .ps-analytics-grid { grid-template-columns: 1fr; } }
    `}</style>
  );
}
