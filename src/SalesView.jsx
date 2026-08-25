import React, { useState, useMemo } from "react";
import { Plus, Search, X, ShoppingCart, Download, CalendarRange, Truck } from "lucide-react";
import * as XLSX from "xlsx";
import { fmtInt, toNum, colorForName, todayStr } from "./utils.js";
import { FUELS, DENSITY, CONTAINER_LABELS } from "./shared.jsx";

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const formatDay = (isoDate) => {
  if (!isoDate) return "Без даты";
  const d = new Date(isoDate + "T00:00:00");
  if (isNaN(d)) return isoDate;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${WEEKDAYS[d.getDay()]}`;
};

const isoOf = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const todayIso = () => isoOf(new Date());
const yesterdayIso = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoOf(d); };
const daysAgoIso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d); };
const shortDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

const fuelSummary = (items) =>
  items.map((i) => `${i.fuel || "—"}${i.containerMode ? ` (${CONTAINER_LABELS[i.containerMode]})` : ""}`).join(", ");

const shipStatusFor = (sale, shipmentsByGroup) => {
  const groupShipments = shipmentsByGroup.get(sale.id) || [];
  if (groupShipments.length === 0) {
    return sale.shipped ? { state: "full", shippedVolume: null, totalVolume: null } : { state: "none", shippedVolume: null, totalVolume: null };
  }
  const totalVolume = sale.items.reduce((a, i) => a + toNum(i.volume), 0);
  const shippedVolume = groupShipments.reduce((a, s) => a + toNum(s.volume), 0);
  if (totalVolume > 0 && shippedVolume >= totalVolume - 0.001) return { state: "full", shippedVolume, totalVolume };
  if (shippedVolume > 0) return { state: "partial", shippedVolume, totalVolume };
  return { state: "none", shippedVolume, totalVolume };
};

export default function SalesView({ sales, salesLoaded, clients, managerName, prices, shipments, onOpenSell, onOpenShipment }) {
  const [search, setSearch] = useState("");
  const [fuelFilter, setFuelFilter] = useState(null);
  const [managerFilter, setManagerFilter] = useState("");
  const [period, setPeriod] = useState("all"); // 'all' | 'today' | 'yesterday' | 'custom'
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [onlyUnshipped, setOnlyUnshipped] = useState(false);
  const [shipFrom, setShipFrom] = useState("");
  const [shipTo, setShipTo] = useState("");
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const openCustomPeriod = () => {
    setPeriod("custom");
    if (!customFrom) setCustomFrom(daysAgoIso(6));
    if (!customTo) setCustomTo(todayIso());
  };

  const managers = useMemo(() => {
    const set = new Set(sales.map((s) => s.createdBy).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [sales]);

  const enriched = useMemo(
    () => sales.map((s) => ({ ...s, clientName: clientById.get(s.clientId)?.company || "Клиент удалён" })),
    [sales, clientById]
  );

  const shipmentsByGroup = useMemo(() => {
    const map = new Map();
    (shipments || []).forEach((sh) => {
      if (!map.has(sh.groupId)) map.set(sh.groupId, []);
      map.get(sh.groupId).push(sh);
    });
    return map;
  }, [shipments]);

  const filtered = useMemo(() => {
    let out = enriched;
    if (fuelFilter) out = out.filter((s) => s.items.some((i) => i.fuel === fuelFilter));
    if (managerFilter) out = out.filter((s) => s.createdBy === managerFilter);
    if (onlyUnshipped) out = out.filter((s) => !s.shipped);
    if (period === "today") out = out.filter((s) => s.saleDate === todayIso());
    else if (period === "yesterday") out = out.filter((s) => s.saleDate === yesterdayIso());
    else if (period === "custom") {
      out = out.filter((s) => (!customFrom || s.saleDate >= customFrom) && (!customTo || s.saleDate <= customTo));
    }
    if (shipFrom || shipTo) {
      out = out.filter((s) => s.shippedDate && (!shipFrom || s.shippedDate >= shipFrom) && (!shipTo || s.shippedDate <= shipTo));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((s) => [s.clientName, s.comment, s.createdBy, ...s.items.map((i) => i.fuel)].some((v) => (v || "").toLowerCase().includes(q)));
    }
    return [...out].sort((a, b) => (b.saleDate || "").localeCompare(a.saleDate || "") || b.createdAt - a.createdAt);
  }, [enriched, search, fuelFilter, managerFilter, onlyUnshipped, period, customFrom, customTo, shipFrom, shipTo]);

  const grandTotal = filtered.reduce((a, s) => a + toNum(s.sum), 0);
  const unshipped = useMemo(() => filtered.filter((s) => !s.shipped), [filtered]);
  const unshippedSum = unshipped.reduce((a, s) => a + toNum(s.sum), 0);
  const agentFeeTotal = filtered.reduce((a, s) => a + toNum(s.agentFee), 0);

  const densityFor = (fuel) => toNum((prices || []).find((p) => p.fuel === fuel)?.density) || DENSITY[fuel] || 0;
  const { totalVolume, totalTons } = useMemo(() => {
    let volume = 0, tons = 0;
    filtered.forEach((s) => s.items.forEach((it) => {
      const v = toNum(it.volume);
      volume += v;
      tons += (v * densityFor(it.fuel)) / 1000;
    }));
    return { totalVolume: volume, totalTons: tons };
  }, [filtered, prices]);

  const periodLabel = period === "all" ? "За всё время"
    : period === "today" ? "За сегодня"
    : period === "yesterday" ? "За вчера"
    : `С ${shortDate(customFrom)} по ${shortDate(customTo)}`;

  const days = useMemo(() => {
    const map = new Map();
    filtered.forEach((s) => {
      const key = s.saleDate || "";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const exportExcel = () => {
    const headers = ["Дата", "Клиент", "Топливо", "Цена, ₽/л", "Объём, л", "Тара", "Кол-во тары, шт", "Цена тары, ₽", "Залог, ₽", "Сумма, ₽", "Агентское вознаграждение, ₽", "Отгружено", "Дата отгрузки", "Менеджер", "Комментарий"];
    const body = [];
    filtered.forEach((s) => {
      s.items.forEach((it, idx) => {
        body.push([
          s.saleDate, s.clientName, it.fuel, toNum(it.price), toNum(it.volume),
          it.containerMode ? CONTAINER_LABELS[it.containerMode] : "", toNum(it.containerQty) || "", toNum(it.containerPrice) || "", toNum(it.containerDeposit) || "",
          toNum(it.sum), idx === 0 ? (toNum(s.agentFee) || "") : "", s.shipped ? "Да" : "Нет", s.shippedDate || "", s.createdBy, idx === 0 ? s.comment : "",
        ]);
      });
    });
    body.push(["", "", "", "", "", "", "", "", "", grandTotal, agentFeeTotal || "", "", "", "", "ИТОГО"]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
    ws["!cols"] = headers.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Реестр сделок");
    XLSX.writeFile(wb, `PlutosOil_реестр_сделок_${todayStr().replace(/\./g, "-")}.xlsx`);
  };

  return (
    <>
      <div className="ps-toolbar">
        <div className="ps-search">
          <Search size={15} />
          <input placeholder="Поиск: клиент, менеджер, комментарий…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <X size={14} className="ps-search__clear" onClick={() => setSearch("")} />}
        </div>
        <div className="ps-chips">
          <button className={`ps-chip ${fuelFilter === null ? "ps-chip--on" : ""}`} onClick={() => setFuelFilter(null)}>Все виды</button>
          {FUELS.map((f) => <button key={f} className={`ps-chip ${fuelFilter === f ? "ps-chip--on" : ""}`} onClick={() => setFuelFilter(fuelFilter === f ? null : f)}>{f}</button>)}
        </div>
        <select className="ps-select-filter" value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)}>
          <option value="">Все менеджеры</option>
          {managers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button className={`ps-chip ${onlyUnshipped ? "ps-chip--on" : ""}`} onClick={() => setOnlyUnshipped((v) => !v)}>Не отгружено</button>
        <div className="ps-toolbar__spacer" />
        <button className="ps-btn" onClick={exportExcel}><Download size={15} /> Excel</button>
        <button className="ps-btn ps-btn--primary" style={{ width: "auto" }} onClick={() => onOpenSell(null)}><Plus size={15} /> Продать</button>
      </div>

      <div className="ps-toolbar ps-toolbar--period">
        <div className="ps-chips">
          <button className={`ps-chip ${period === "all" ? "ps-chip--on" : ""}`} onClick={() => setPeriod("all")}>Всё время</button>
          <button className={`ps-chip ${period === "today" ? "ps-chip--on" : ""}`} onClick={() => setPeriod("today")}>Сегодня</button>
          <button className={`ps-chip ${period === "yesterday" ? "ps-chip--on" : ""}`} onClick={() => setPeriod("yesterday")}>Вчера</button>
          <button className={`ps-chip ${period === "custom" ? "ps-chip--on" : ""}`} onClick={openCustomPeriod}><CalendarRange size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Период</button>
        </div>
        {period === "custom" && (
          <div className="ps-period-range">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span>—</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}
      </div>

      <div className="ps-toolbar ps-toolbar--period">
        <div className="ps-period-range">
          <span style={{ color: "#5B6770" }}>Дата отгрузки:</span>
          <input type="date" value={shipFrom} onChange={(e) => setShipFrom(e.target.value)} />
          <span>—</span>
          <input type="date" value={shipTo} onChange={(e) => setShipTo(e.target.value)} />
          {(shipFrom || shipTo) && (
            <button type="button" className="ps-link-btn" onClick={() => { setShipFrom(""); setShipTo(""); }}>
              <X size={12} /> Сбросить
            </button>
          )}
        </div>
      </div>

      <div className="ps-period-summary">
        <span className="ps-period-summary__label">{periodLabel}</span>
        <span className="ps-period-summary__stat"><b>{filtered.length}</b> сделок</span>
        <span className="ps-period-summary__divider" />
        <span className="ps-period-summary__stat"><b>{fmtInt(totalVolume)}</b> л{totalTons > 0 ? ` · ≈${totalTons.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} т` : ""}</span>
        <span className="ps-period-summary__divider" />
        <span className="ps-period-summary__stat ps-period-summary__stat--sum"><b>{fmtInt(grandTotal)}</b> ₽ выручка</span>
        {unshipped.length > 0 && (
          <>
            <span className="ps-period-summary__divider" />
            <span className="ps-period-summary__stat ps-period-summary__stat--warn"><b>{unshipped.length}</b> не отгружено ({fmtInt(unshippedSum)} ₽)</span>
          </>
        )}
        {agentFeeTotal > 0 && (
          <>
            <span className="ps-period-summary__divider" />
            <span className="ps-period-summary__stat">агентское вознаграждение <b>{fmtInt(agentFeeTotal)}</b> ₽</span>
          </>
        )}
      </div>

      <div className="ps-journal">
        {days.map(([day, entries]) => {
          const daySum = entries.reduce((a, s) => a + toNum(s.sum), 0);
          return (
            <div key={day} className="ps-journal__day">
              <div className="ps-journal__day-head">
                <span className="ps-journal__day-title">{formatDay(day)}</span>
                <span className="ps-journal__day-stats">{entries.length} {entries.length === 1 ? "сделка" : "сделки"} · {fmtInt(daySum)} ₽</span>
              </div>
              <div className="ps-journal__entries">
                {entries.map((s) => (
                  <div key={s.id} role="button" tabIndex={0} className="ps-journal__entry"
                    onClick={() => onOpenSell(s.clientId, s)}
                    onKeyDown={(e) => { if (e.key === "Enter") onOpenSell(s.clientId, s); }}>
                    <span className="ps-journal__client">{s.clientName}</span>
                    <span className="ps-history__fuel">{fuelSummary(s.items)}</span>
                    <span className="ps-journal__vol">{fmtInt(s.items.reduce((a, i) => a + toNum(i.volume), 0))} л</span>
                    <span className="ps-journal__payment">{s.paymentMethod || "—"}</span>
                    <span className="ps-journal__sum">
                      {fmtInt(toNum(s.sum))} ₽
                      {toNum(s.agentFee) > 0 && <span className="ps-tara-badge"> · агент {fmtInt(toNum(s.agentFee))}</span>}
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                      {(() => {
                        const status = shipStatusFor(s, shipmentsByGroup);
                        if (status.state === "full") {
                          return <span className="ps-ship-badge ps-ship-badge--done">Отгружено{s.shippedDate ? " " + shortDate(s.shippedDate) : ""}</span>;
                        }
                        if (status.state === "partial") {
                          return <span className="ps-ship-badge ps-ship-badge--partial">Частично {fmtInt(status.shippedVolume)}/{fmtInt(status.totalVolume)} л</span>;
                        }
                        return <span className="ps-ship-badge ps-ship-badge--pending">Не отгружено</span>;
                      })()}
                      {s.paid
                        ? <span className="ps-ship-badge ps-ship-badge--done">Оплачено{s.paidDate ? " " + shortDate(s.paidDate) : ""}</span>
                        : <span className="ps-ship-badge ps-ship-badge--pending">Не оплачено</span>}
                      <button type="button" className="ps-ship-btn" onClick={(e) => { e.stopPropagation(); onOpenShipment(s); }}>
                        <Truck size={11} /> Отгрузка
                      </button>
                    </span>
                    <span className="ps-journal__manager">{s.createdBy ? <span style={{ color: colorForName(s.createdBy) }}>{s.createdBy}</span> : "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {days.length === 0 && (
          <div className="ps-empty">
            {salesLoaded ? <><ShoppingCart size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Продаж пока нет — нажмите «Продать».</> : "Загрузка…"}
          </div>
        )}
      </div>
    </>
  );
}
