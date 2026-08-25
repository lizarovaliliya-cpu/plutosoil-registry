import React, { useState, useMemo } from "react";
import { Download, CalendarRange, Sliders } from "lucide-react";
import * as XLSX from "xlsx";
import { fmtInt, toNum } from "./utils.js";
import { FUELS, DENSITY, CONTAINER_LABELS } from "./shared.jsx";

const isoOf = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const todayIso = () => isoOf(new Date());
const yesterdayIso = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoOf(d); };
const daysAgoIso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d); };

const shortDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

const locationLabel = (locationById, id) => {
  const l = locationById.get(id);
  return l ? `${l.type === "station" ? "АЗС" : "Склад"} · ${l.name}` : "";
};

/* ---- какие колонки можно включить в отчёт, сгруппированы по смыслу ---- */
function buildColumnGroups(locationById, densityFor) {
  return [
    {
      title: "Сделка",
      columns: [
        { key: "saleDate", label: "Дата продажи", get: (r) => shortDate(r.group.saleDate) },
        { key: "manager", label: "Менеджер", get: (r) => r.group.createdBy || "" },
        { key: "payment", label: "Способ оплаты", get: (r) => r.group.paymentMethod || "" },
        { key: "agentFee", label: "Агентское вознаграждение, ₽", get: (r) => toNum(r.group.agentFee) || "" },
        { key: "comment", label: "Комментарий", get: (r) => r.group.comment || "" },
      ],
    },
    {
      title: "Клиент",
      columns: [
        { key: "client", label: "Клиент", get: (r) => r.client?.company || "Клиент удалён" },
        { key: "contact", label: "Контактное лицо", get: (r) => r.client?.contactName || "" },
        { key: "phone", label: "Телефон", get: (r) => r.client?.phone || "" },
        { key: "inn", label: "ИНН", get: (r) => r.client?.inn || "" },
        { key: "source", label: "Источник", get: (r) => r.client?.source || "" },
      ],
    },
    {
      title: "Топливо",
      columns: [
        { key: "fuel", label: "Вид топлива", get: (r) => r.item.fuel },
        { key: "volume", label: "Объём, л", get: (r) => toNum(r.item.volume) },
        { key: "tonnes", label: "≈ Объём, т", get: (r) => { const d = densityFor(r.item.fuel); return d > 0 ? +((toNum(r.item.volume) * d) / 1000).toFixed(3) : ""; } },
        { key: "price", label: "Цена, ₽/л", get: (r) => toNum(r.item.price) },
        { key: "sum", label: "Сумма, ₽", get: (r) => toNum(r.item.sum) },
        { key: "container", label: "Тара", get: (r) => (r.item.containerMode ? CONTAINER_LABELS[r.item.containerMode] : "") },
        { key: "location", label: "Склад/АЗС отпуска", get: (r) => locationLabel(locationById, r.item.locationId) },
      ],
    },
    {
      title: "Статус",
      columns: [
        { key: "shipped", label: "Отгружено", get: (r) => (r.group.shipped ? "Да" : "Нет") },
        { key: "shippedDate", label: "Дата отгрузки", get: (r) => shortDate(r.group.shippedDate) },
        { key: "plannedShipDate", label: "Планируемая дата отгрузки", get: (r) => shortDate(r.group.plannedShipDate) },
        { key: "paid", label: "Оплачено", get: (r) => (r.group.paid ? "Да" : "Нет") },
        { key: "paidDate", label: "Дата оплаты", get: (r) => shortDate(r.group.paidDate) },
      ],
    },
  ];
}

const PRESETS = {
  full: null, // все колонки — вычисляется отдельно
  finance: ["saleDate", "client", "manager", "payment", "sum", "agentFee", "paid", "paidDate"],
  logistics: ["saleDate", "client", "fuel", "volume", "location", "shipped", "shippedDate", "plannedShipDate"],
};

export default function ReportsView({ sales, clients, locations, prices, managers }) {
  const [period, setPeriod] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [fuelFilter, setFuelFilter] = useState(null);
  const [managerFilter, setManagerFilter] = useState("");
  const [onlyUnshipped, setOnlyUnshipped] = useState(false);
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [selected, setSelected] = useState(() => new Set(PRESETS.finance));

  const openCustomPeriod = () => {
    setPeriod("custom");
    if (!customFrom) setCustomFrom(daysAgoIso(29));
    if (!customTo) setCustomTo(todayIso());
  };

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const locationById = useMemo(() => new Map((locations || []).map((l) => [l.id, l])), [locations]);
  const densityFor = (fuel) => toNum((prices || []).find((p) => p.fuel === fuel)?.density) || DENSITY[fuel] || 0;

  const columnGroups = useMemo(() => buildColumnGroups(locationById, densityFor), [locationById, prices]);
  const allColumns = useMemo(() => columnGroups.flatMap((g) => g.columns), [columnGroups]);

  const rows = useMemo(() => {
    let groups = sales;
    if (period === "today") groups = groups.filter((g) => g.saleDate === todayIso());
    else if (period === "yesterday") groups = groups.filter((g) => g.saleDate === yesterdayIso());
    else if (period === "custom") groups = groups.filter((g) => (!customFrom || g.saleDate >= customFrom) && (!customTo || g.saleDate <= customTo));
    if (managerFilter) groups = groups.filter((g) => g.createdBy === managerFilter);
    if (onlyUnshipped) groups = groups.filter((g) => !g.shipped);
    if (onlyUnpaid) groups = groups.filter((g) => !g.paid);

    const flat = groups.flatMap((g) => (g.items || []).map((item) => ({ group: g, item, client: clientById.get(g.clientId) })));
    return fuelFilter ? flat.filter((r) => r.item.fuel === fuelFilter) : flat;
  }, [sales, period, customFrom, customTo, managerFilter, onlyUnshipped, onlyUnpaid, fuelFilter, clientById]);

  const toggleColumn = (key) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const applyPreset = (name) => setSelected(new Set(name === "full" ? allColumns.map((c) => c.key) : PRESETS[name]));

  const selectedColumns = allColumns.filter((c) => selected.has(c.key));

  const exportExcel = () => {
    if (selectedColumns.length === 0) return;
    const headers = selectedColumns.map((c) => c.label);
    const body = rows.map((r) => selectedColumns.map((c) => c.get(r)));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
    ws["!cols"] = headers.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Отчёт");
    XLSX.writeFile(wb, `PlutosOil_отчёт_${todayIso()}.xlsx`);
  };

  const periodLabel = period === "all" ? "за всё время" : period === "today" ? "за сегодня" : period === "yesterday" ? "за вчера" : "за период";

  return (
    <>
      <div className="ps-toolbar">
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
        <div className="ps-toolbar__spacer" />
        <button className="ps-btn ps-btn--primary" style={{ width: "auto" }} disabled={selectedColumns.length === 0 || rows.length === 0} onClick={exportExcel}>
          <Download size={15} /> Скачать Excel
        </button>
      </div>

      <div className="ps-toolbar">
        <div className="ps-chips">
          <button className={`ps-chip ${fuelFilter === null ? "ps-chip--on" : ""}`} onClick={() => setFuelFilter(null)}>Все виды</button>
          {FUELS.map((f) => <button key={f} className={`ps-chip ${fuelFilter === f ? "ps-chip--on" : ""}`} onClick={() => setFuelFilter(fuelFilter === f ? null : f)}>{f}</button>)}
        </div>
        <select className="ps-select-filter" value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)}>
          <option value="">Все менеджеры</option>
          {(managers || []).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button className={`ps-chip ${onlyUnshipped ? "ps-chip--on" : ""}`} onClick={() => setOnlyUnshipped((v) => !v)}>Не отгружено</button>
        <button className={`ps-chip ${onlyUnpaid ? "ps-chip--on" : ""}`} onClick={() => setOnlyUnpaid((v) => !v)}>Не оплачено</button>
      </div>

      <div className="ps-report-builder">
        <div className="ps-report-builder__head">
          <span className="ps-sell-section__title-label"><Sliders size={13} /> Какие колонки выгрузить</span>
          <div className="ps-chips">
            <button type="button" className="ps-link-btn" onClick={() => applyPreset("full")}>Все колонки</button>
            <button type="button" className="ps-link-btn" onClick={() => applyPreset("finance")}>Финансы</button>
            <button type="button" className="ps-link-btn" onClick={() => applyPreset("logistics")}>Логистика</button>
            <button type="button" className="ps-link-btn" onClick={() => setSelected(new Set())}>Очистить</button>
          </div>
        </div>
        {columnGroups.map((g) => (
          <div key={g.title} className="ps-report-builder__group">
            <span className="ps-report-builder__group-title">{g.title}</span>
            <div className="ps-chips">
              {g.columns.map((c) => (
                <button key={c.key} type="button" className={`ps-chip ${selected.has(c.key) ? "ps-chip--on" : ""}`} onClick={() => toggleColumn(c.key)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="ps-period-summary">
        <span className="ps-period-summary__label">Предпросмотр {periodLabel}</span>
        <span className="ps-period-summary__stat"><b>{rows.length}</b> строк</span>
        <span className="ps-period-summary__stat"><b>{selectedColumns.length}</b> колонок</span>
      </div>

      {selectedColumns.length === 0 ? (
        <div className="ps-empty">Выберите хотя бы одну колонку выше, чтобы увидеть отчёт.</div>
      ) : rows.length === 0 ? (
        <div className="ps-empty">Нет данных за выбранный период и фильтры.</div>
      ) : (
        <div className="ps-tablewrap">
          <table className="ps-table">
            <thead>
              <tr>{selectedColumns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((r, i) => (
                <tr key={i}>
                  {selectedColumns.map((c) => {
                    const v = c.get(r);
                    return <td key={c.key}>{typeof v === "number" ? fmtInt(v) : v || "—"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 500 && (
            <div style={{ padding: "10px 12px", fontSize: 11.5, color: "#8A94A0" }}>
              Показаны первые 500 из {rows.length} строк — в выгрузке Excel будут все.
            </div>
          )}
        </div>
      )}
    </>
  );
}
