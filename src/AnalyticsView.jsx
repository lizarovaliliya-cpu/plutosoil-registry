import React, { useState, useMemo } from "react";
import { TrendingUp, BarChart3, Fuel, Users, Wallet, ShoppingCart } from "lucide-react";
import { fmtInt, toNum, colorForName } from "./utils.js";
import { FUELS, STATUSES } from "./shared.jsx";

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const PAYMENT_METHODS = ["Наличные", "Безналичный", "Карта"];

const isoOf = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const todayIso = () => isoOf(new Date());
const daysAgoIso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d); };

function Panel({ title, icon: Icon, children }) {
  return (
    <div className="ps-panel">
      <div className="ps-panel__title">{Icon && <Icon size={14} />} {title}</div>
      {children}
    </div>
  );
}

function BarList({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <div className="ps-empty" style={{ padding: "14px 0" }}>Нет данных</div>;
  return (
    <div className="ps-barlist">
      {rows.map((r) => (
        <div key={r.label} className="ps-barlist__row">
          <span className="ps-barlist__label">{r.label}</span>
          <div className="ps-barlist__track">
            <div className="ps-barlist__fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color || "var(--petrol-2)" }} />
          </div>
          <span className="ps-barlist__value">{r.sub || `${fmtInt(r.value)} ₽`}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsView({ sales, clients, rows }) {
  const [period, setPeriod] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const openCustomPeriod = () => {
    setPeriod("custom");
    if (!customFrom) setCustomFrom(daysAgoIso(29));
    if (!customTo) setCustomTo(todayIso());
  };

  const inRange = (iso) => {
    if (!iso) return false;
    if (period === "today") return iso === todayIso();
    if (period === "7d") return iso >= daysAgoIso(6);
    if (period === "30d") return iso >= daysAgoIso(29);
    if (period === "custom") return (!customFrom || iso >= customFrom) && (!customTo || iso <= customTo);
    return true;
  };

  const filteredSales = useMemo(() => sales.filter((s) => inRange(s.saleDate)), [sales, period, customFrom, customTo]);

  const totalSum = filteredSales.reduce((a, s) => a + toNum(s.sum), 0);
  const dealsCount = filteredSales.length;
  const avgCheck = dealsCount ? totalSum / dealsCount : 0;
  const agentFeeTotal = filteredSales.reduce((a, s) => a + toNum(s.agentFee), 0);

  const newClientsCount = useMemo(
    () => clients.filter((c) => c.createdAt && inRange(isoOf(new Date(c.createdAt)))).length,
    [clients, period, customFrom, customTo]
  );

  const byFuel = useMemo(() => {
    const map = new Map(FUELS.map((f) => [f, 0]));
    filteredSales.forEach((s) => { if (map.has(s.fuel)) map.set(s.fuel, map.get(s.fuel) + toNum(s.sum)); });
    return FUELS.map((f) => ({ label: f, value: map.get(f) }));
  }, [filteredSales]);

  const byManager = useMemo(() => {
    const map = new Map();
    filteredSales.forEach((s) => {
      const key = s.createdBy || "Без менеджера";
      const cur = map.get(key) || { value: 0, count: 0 };
      cur.value += toNum(s.sum); cur.count += 1;
      map.set(key, cur);
    });
    return [...map.entries()]
      .map(([label, v]) => ({ label, value: v.value, sub: `${fmtInt(v.value)} ₽ · ${v.count}`, color: colorForName(label) }))
      .sort((a, b) => b.value - a.value);
  }, [filteredSales]);

  const byPayment = useMemo(() => {
    const map = new Map(PAYMENT_METHODS.map((p) => [p, 0]));
    let other = 0;
    filteredSales.forEach((s) => {
      if (map.has(s.paymentMethod)) map.set(s.paymentMethod, map.get(s.paymentMethod) + toNum(s.sum));
      else other += toNum(s.sum);
    });
    const out = PAYMENT_METHODS.map((p) => ({ label: p, value: map.get(p) }));
    if (other > 0) out.push({ label: "Не указано", value: other });
    return out;
  }, [filteredSales]);

  const funnel = useMemo(() => {
    const map = new Map(STATUSES.map((s) => [s.value, 0]));
    rows.forEach((r) => { const v = r.status || ""; if (map.has(v)) map.set(v, map.get(v) + 1); });
    return STATUSES.map((s) => ({ label: s.label, value: map.get(s.value), color: s.color, sub: `${map.get(s.value)}` }));
  }, [rows]);

  const trend = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: `${MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` });
    }
    const sums = new Map(months.map((m) => [m.key, 0]));
    sales.forEach((s) => {
      if (!s.saleDate) return;
      const key = s.saleDate.slice(0, 7);
      if (sums.has(key)) sums.set(key, sums.get(key) + toNum(s.sum));
    });
    return months.map((m) => ({ label: m.label, value: sums.get(m.key) }));
  }, [sales]);

  const maxTrend = Math.max(1, ...trend.map((t) => t.value));

  const topClients = useMemo(() => {
    const map = new Map();
    filteredSales.forEach((s) => map.set(s.clientId, (map.get(s.clientId) || 0) + toNum(s.sum)));
    return [...map.entries()]
      .map(([clientId, sum]) => ({ client: clients.find((c) => c.id === clientId), sum }))
      .filter((r) => r.client)
      .sort((a, b) => b.sum - a.sum)
      .slice(0, 5);
  }, [filteredSales, clients]);

  const periodLabel = period === "all" ? "за всё время" : period === "today" ? "за сегодня" : period === "7d" ? "за 7 дней" : period === "30d" ? "за 30 дней" : "за период";

  return (
    <>
      <div className="ps-toolbar">
        <div className="ps-chips">
          <button className={`ps-chip ${period === "all" ? "ps-chip--on" : ""}`} onClick={() => setPeriod("all")}>Всё время</button>
          <button className={`ps-chip ${period === "today" ? "ps-chip--on" : ""}`} onClick={() => setPeriod("today")}>Сегодня</button>
          <button className={`ps-chip ${period === "7d" ? "ps-chip--on" : ""}`} onClick={() => setPeriod("7d")}>7 дней</button>
          <button className={`ps-chip ${period === "30d" ? "ps-chip--on" : ""}`} onClick={() => setPeriod("30d")}>30 дней</button>
          <button className={`ps-chip ${period === "custom" ? "ps-chip--on" : ""}`} onClick={openCustomPeriod}>Период</button>
        </div>
        {period === "custom" && (
          <div className="ps-period-range">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span>—</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}
      </div>

      <div className="ps-kpi-grid">
        <div className="ps-kpi-card">
          <div className="ps-kpi-card__label">Выручка {periodLabel}</div>
          <div className="ps-kpi-card__value">{fmtInt(totalSum)} ₽</div>
        </div>
        <div className="ps-kpi-card">
          <div className="ps-kpi-card__label">Сделок {periodLabel}</div>
          <div className="ps-kpi-card__value">{dealsCount}</div>
        </div>
        <div className="ps-kpi-card">
          <div className="ps-kpi-card__label">Средний чек</div>
          <div className="ps-kpi-card__value">{fmtInt(avgCheck)} ₽</div>
        </div>
        <div className="ps-kpi-card">
          <div className="ps-kpi-card__label">Новых клиентов {periodLabel}</div>
          <div className="ps-kpi-card__value">{newClientsCount}</div>
        </div>
        <div className="ps-kpi-card">
          <div className="ps-kpi-card__label">Агентское вознаграждение {periodLabel}</div>
          <div className="ps-kpi-card__value">{fmtInt(agentFeeTotal)} ₽</div>
        </div>
      </div>

      <div className="ps-analytics-grid">
        <div className="ps-panel ps-panel--wide">
          <div className="ps-panel__title"><TrendingUp size={14} /> Динамика выручки, последние 6 месяцев</div>
          <div className="ps-trend">
            {trend.map((t) => (
              <div key={t.label} className="ps-trend__col">
                <span className="ps-trend__value">{t.value > 0 ? fmtInt(t.value) : ""}</span>
                <div className="ps-trend__bar-wrap"><div className="ps-trend__bar" style={{ height: `${(t.value / maxTrend) * 100}%` }} /></div>
                <span className="ps-trend__label">{t.label}</span>
              </div>
            ))}
          </div>
        </div>

        <Panel title="Воронка заявок по статусам" icon={BarChart3}>
          <BarList rows={funnel} />
        </Panel>

        <Panel title="Выручка по топливу" icon={Fuel}>
          <BarList rows={byFuel} />
        </Panel>

        <Panel title="Выручка по менеджерам" icon={Users}>
          <BarList rows={byManager} />
        </Panel>

        <Panel title="Способ оплаты" icon={Wallet}>
          <BarList rows={byPayment} />
        </Panel>

        <Panel title="Топ клиентов по выручке" icon={ShoppingCart}>
          {topClients.length === 0 ? (
            <div className="ps-empty" style={{ padding: "14px 0" }}>Нет данных</div>
          ) : (
            <div className="ps-topclients">
              {topClients.map((r, i) => (
                <div key={r.client.id} className="ps-topclients__row">
                  <span className="ps-topclients__rank">{i + 1}</span>
                  <span className="ps-topclients__name">{r.client.company || "Без названия"}</span>
                  <span className="ps-topclients__sum">{fmtInt(r.sum)} ₽</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
