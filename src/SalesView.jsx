import React, { useState, useMemo } from "react";
import { Plus, Search, X, ShoppingCart, Download } from "lucide-react";
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

export default function SalesView({ sales, salesLoaded, clients, managerName, onOpenSell }) {
  const [search, setSearch] = useState("");
  const [fuelFilter, setFuelFilter] = useState(null);
  const [managerFilter, setManagerFilter] = useState("");
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const managers = useMemo(() => {
    const set = new Set(sales.map((s) => s.createdBy).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [sales]);

  const enriched = useMemo(
    () => sales.map((s) => ({ ...s, clientName: clientById.get(s.clientId)?.company || "Клиент удалён" })),
    [sales, clientById]
  );

  const filtered = useMemo(() => {
    let out = enriched;
    if (fuelFilter) out = out.filter((s) => s.fuel === fuelFilter);
    if (managerFilter) out = out.filter((s) => s.createdBy === managerFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((s) => [s.clientName, s.fuel, s.comment, s.createdBy].some((v) => (v || "").toLowerCase().includes(q)));
    }
    return [...out].sort((a, b) => (b.saleDate || "").localeCompare(a.saleDate || "") || b.createdAt - a.createdAt);
  }, [enriched, search, fuelFilter, managerFilter]);

  const grandTotal = filtered.reduce((a, s) => a + toNum(s.sum), 0);

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
    const headers = ["Дата", "Клиент", "Топливо", "Цена, ₽/л", "Объём, л", "Сумма, ₽", "Менеджер", "Комментарий"];
    const body = filtered.map((s) => [s.saleDate, s.clientName, s.fuel, toNum(s.price), toNum(s.volume), toNum(s.sum), s.createdBy, s.comment]);
    body.push(["", "", "", "", "", grandTotal, "", "ИТОГО"]);
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
        <div className="ps-toolbar__spacer" />
        <span className="ps-sales-total">{filtered.length} сделок · {fmtInt(grandTotal)} ₽</span>
        <button className="ps-btn" onClick={exportExcel}><Download size={15} /> Excel</button>
        <button className="ps-btn ps-btn--primary" style={{ width: "auto" }} onClick={() => onOpenSell(null)}><Plus size={15} /> Продать</button>
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
                  <div key={s.id} className="ps-journal__entry">
                    <span className="ps-journal__client">{s.clientName}</span>
                    <span className="ps-history__fuel">{s.fuel || "—"}</span>
                    <span className="ps-journal__vol">{fmtInt(toNum(s.volume))} л</span>
                    <span className="ps-journal__sum">{fmtInt(toNum(s.sum))} ₽</span>
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
