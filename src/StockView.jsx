import React, { useState, useMemo } from "react";
import { Plus, Search, X, Warehouse, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { fmtInt, toNum, colorForName, todayStr } from "./utils.js";
import { FUELS } from "./shared.jsx";

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const formatDay = (isoDate) => {
  if (!isoDate) return "Без даты";
  const d = new Date(isoDate + "T00:00:00");
  if (isNaN(d)) return isoDate;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${WEEKDAYS[d.getDay()]}`;
};

export default function StockView({ receipts, receiptsLoaded, sales, managerName, onOpenReceipt }) {
  const [search, setSearch] = useState("");
  const [fuelFilter, setFuelFilter] = useState(null);

  const balances = useMemo(() => {
    const map = {};
    FUELS.forEach((f) => (map[f] = { received: 0, sold: 0 }));
    receipts.forEach((r) => { if (map[r.fuel]) map[r.fuel].received += toNum(r.volume); });
    sales.forEach((s) => { if (map[s.fuel]) map[s.fuel].sold += toNum(s.volume); });
    return map;
  }, [receipts, sales]);

  const totalBalance = FUELS.reduce((a, f) => a + (balances[f].received - balances[f].sold), 0);

  const filtered = useMemo(() => {
    let out = receipts;
    if (fuelFilter) out = out.filter((r) => r.fuel === fuelFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) => [r.supplier, r.comment, r.createdBy].some((v) => (v || "").toLowerCase().includes(q)));
    }
    return [...out].sort((a, b) => (b.receiptDate || "").localeCompare(a.receiptDate || "") || b.createdAt - a.createdAt);
  }, [receipts, fuelFilter, search]);

  const days = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      const key = r.receiptDate || "";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const exportExcel = () => {
    const headers = ["Дата", "Топливо", "Объём, л", "Цена, ₽/л", "Сумма, ₽", "Поставщик", "Менеджер", "Комментарий"];
    const body = filtered.map((r) => [r.receiptDate, r.fuel, toNum(r.volume), toNum(r.price) || "", toNum(r.sum), r.supplier, r.createdBy, r.comment]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
    ws["!cols"] = headers.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Приход топлива");
    XLSX.writeFile(wb, `PlutosOil_склад_${todayStr().replace(/\./g, "-")}.xlsx`);
  };

  return (
    <>
      <div className="ps-kpi-grid" style={{ gridTemplateColumns: `repeat(${FUELS.length + 1}, 1fr)` }}>
        {FUELS.map((f) => {
          const b = balances[f];
          const balance = b.received - b.sold;
          return (
            <div key={f} className="ps-kpi-card">
              <div className="ps-kpi-card__label">Остаток {f}</div>
              <div className="ps-kpi-card__value">{fmtInt(balance)} л</div>
              <div className="ps-price-row__meta">приход {fmtInt(b.received)} л · продано {fmtInt(b.sold)} л</div>
            </div>
          );
        })}
        <div className="ps-kpi-card">
          <div className="ps-kpi-card__label">Остаток всего</div>
          <div className="ps-kpi-card__value">{fmtInt(totalBalance)} л</div>
        </div>
      </div>

      <div className="ps-toolbar">
        <div className="ps-search">
          <Search size={15} />
          <input placeholder="Поиск: поставщик, менеджер, комментарий…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <X size={14} className="ps-search__clear" onClick={() => setSearch("")} />}
        </div>
        <div className="ps-chips">
          <button className={`ps-chip ${fuelFilter === null ? "ps-chip--on" : ""}`} onClick={() => setFuelFilter(null)}>Все виды</button>
          {FUELS.map((f) => <button key={f} className={`ps-chip ${fuelFilter === f ? "ps-chip--on" : ""}`} onClick={() => setFuelFilter(fuelFilter === f ? null : f)}>{f}</button>)}
        </div>
        <div className="ps-toolbar__spacer" />
        <button className="ps-btn" onClick={exportExcel}><Download size={15} /> Excel</button>
        <button className="ps-btn ps-btn--primary" style={{ width: "auto" }} onClick={() => onOpenReceipt(null)}><Plus size={15} /> Приход</button>
      </div>

      <div className="ps-journal">
        {days.map(([day, entries]) => {
          const daySum = entries.reduce((a, r) => a + toNum(r.sum), 0);
          const dayVol = entries.reduce((a, r) => a + toNum(r.volume), 0);
          return (
            <div key={day} className="ps-journal__day">
              <div className="ps-journal__day-head">
                <span className="ps-journal__day-title">{formatDay(day)}</span>
                <span className="ps-journal__day-stats">{fmtInt(dayVol)} л · {fmtInt(daySum)} ₽</span>
              </div>
              <div className="ps-journal__entries">
                {entries.map((r) => (
                  <button key={r.id} type="button" className="ps-journal__entry" style={{ gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1.2fr" }} onClick={() => onOpenReceipt(r)}>
                    <span className="ps-history__fuel">{r.fuel || "—"}</span>
                    <span className="ps-journal__vol">{fmtInt(toNum(r.volume))} л</span>
                    <span>{r.supplier || "—"}</span>
                    <span className="ps-journal__sum">{toNum(r.sum) > 0 ? `${fmtInt(toNum(r.sum))} ₽` : "—"}</span>
                    <span className="ps-journal__manager">{r.createdBy ? <span style={{ color: colorForName(r.createdBy) }}>{r.createdBy}</span> : "—"}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {days.length === 0 && (
          <div className="ps-empty">
            {receiptsLoaded ? <><Warehouse size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Приходов пока нет — нажмите «Приход».</> : "Загрузка…"}
          </div>
        )}
      </div>
    </>
  );
}
