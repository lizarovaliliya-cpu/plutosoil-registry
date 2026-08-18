import React, { useState, useMemo } from "react";
import { Plus, Search, X, Warehouse, Download, ArrowLeftRight, ChevronDown, ChevronUp, Building2, Fuel } from "lucide-react";
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

const locationLabel = (l) => (l ? `${l.type === "station" ? "АЗС" : "Склад"} · ${l.name}` : "Без склада");

export default function StockView({
  receipts, receiptsLoaded, sales, managerName,
  locations, locationsLoaded, transfers, transfersLoaded,
  onOpenReceipt, onOpenTransfer, onCreateLocation, onUpdateLocation,
}) {
  const [search, setSearch] = useState("");
  const [fuelFilter, setFuelFilter] = useState(null);
  const [locationType, setLocationType] = useState("warehouse"); // 'warehouse' | 'station'
  const [locationFilter, setLocationFilter] = useState("all"); // 'all' (все точки этого типа) | '' (без склада) | location id
  const [manageOpen, setManageOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationType, setNewLocationType] = useState("warehouse");
  const [newLocationAddress, setNewLocationAddress] = useState("");
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [editAddress, setEditAddress] = useState({}); // { [locationId]: draft address }

  const locationById = useMemo(() => new Map((locations || []).map((l) => [l.id, l])), [locations]);
  const locationsOfType = useMemo(() => (locations || []).filter((l) => l.type === locationType), [locations, locationType]);
  const typeLabel = locationType === "station" ? "АЗС" : "Склады";

  const switchLocationType = (type) => { setLocationType(type); setLocationFilter("all"); setNewLocationType(type); };

  // Глобальный остаток — по всем точкам и "без склада" вместе, не зависит от вкладки.
  const globalBalance = useMemo(() => {
    const map = {};
    FUELS.forEach((f) => (map[f] = 0));
    receipts.forEach((r) => { if (map[r.fuel] != null) map[r.fuel] += toNum(r.volume); });
    sales.forEach((s) => { if (map[s.fuel] != null) map[s.fuel] -= toNum(s.volume); });
    return map;
  }, [receipts, sales]);
  const globalTotal = FUELS.reduce((a, f) => a + globalBalance[f], 0);

  // Остаток в рамках выбранной вкладки (Склады/АЗС) + текущего фильтра по точке.
  const scopedIds = useMemo(() => new Set(locationsOfType.map((l) => l.id)), [locationsOfType]);
  const balances = useMemo(() => {
    const map = {};
    FUELS.forEach((f) => (map[f] = { received: 0, sold: 0, transferredIn: 0, transferredOut: 0 }));
    const matches = (id) => {
      if (locationFilter === "all") return scopedIds.has(id || "");
      return (id || "") === locationFilter;
    };
    receipts.forEach((r) => { if (map[r.fuel] && matches(r.locationId)) map[r.fuel].received += toNum(r.volume); });
    sales.forEach((s) => { if (map[s.fuel] && matches(s.locationId)) map[s.fuel].sold += toNum(s.volume); });
    if (locationFilter !== "all" && locationFilter !== "") {
      transfers.forEach((t) => {
        if (!map[t.fuel]) return;
        if ((t.toLocationId || "") === locationFilter) map[t.fuel].transferredIn += toNum(t.volume);
        if ((t.fromLocationId || "") === locationFilter) map[t.fuel].transferredOut += toNum(t.volume);
      });
    } else if (locationFilter === "all") {
      transfers.forEach((t) => {
        if (!map[t.fuel]) return;
        const inScope = scopedIds.has(t.toLocationId || "");
        const outScope = scopedIds.has(t.fromLocationId || "");
        if (inScope && !outScope) map[t.fuel].transferredIn += toNum(t.volume);
        if (outScope && !inScope) map[t.fuel].transferredOut += toNum(t.volume);
      });
    }
    return map;
  }, [receipts, sales, transfers, locationFilter, scopedIds]);

  const balanceOf = (f) => {
    const b = balances[f];
    return b.received + b.transferredIn - b.transferredOut - b.sold;
  };
  const totalBalance = FUELS.reduce((a, f) => a + balanceOf(f), 0);

  const createLocation = async () => {
    if (!newLocationName.trim() || !onCreateLocation) return;
    setCreatingLocation(true);
    setLocationError("");
    const created = await onCreateLocation({ name: newLocationName.trim(), type: newLocationType, address: newLocationAddress.trim() });
    setCreatingLocation(false);
    if (created) { setNewLocationName(""); setNewLocationAddress(""); setLocationType(created.type); setLocationFilter(created.id); }
    else setLocationError("Не удалось добавить точку — похоже, в базе ещё нет таблицы locations (нужно выполнить SQL-миграцию).");
  };

  const commitAddress = (locationId, address) => {
    setEditAddress((prev) => { const next = { ...prev }; delete next[locationId]; return next; });
    if (onUpdateLocation) onUpdateLocation(locationId, { address });
  };

  const filteredReceipts = useMemo(() => {
    let out = receipts;
    out = out.filter((r) => (locationFilter === "all" ? scopedIds.has(r.locationId || "") : (r.locationId || "") === locationFilter));
    if (fuelFilter) out = out.filter((r) => r.fuel === fuelFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) => [r.supplier, r.comment, r.createdBy].some((v) => (v || "").toLowerCase().includes(q)));
    }
    return [...out].sort((a, b) => (b.receiptDate || "").localeCompare(a.receiptDate || "") || b.createdAt - a.createdAt);
  }, [receipts, locationFilter, fuelFilter, search, scopedIds]);

  const filteredTransfers = useMemo(() => {
    let out = transfers;
    out = out.filter((t) => {
      if (locationFilter === "all") return scopedIds.has(t.fromLocationId || "") || scopedIds.has(t.toLocationId || "");
      return (t.fromLocationId || "") === locationFilter || (t.toLocationId || "") === locationFilter;
    });
    if (fuelFilter) out = out.filter((t) => t.fuel === fuelFilter);
    return [...out].sort((a, b) => (b.transferDate || "").localeCompare(a.transferDate || "") || b.createdAt - a.createdAt);
  }, [transfers, locationFilter, fuelFilter, scopedIds]);

  const receiptDays = useMemo(() => {
    const map = new Map();
    filteredReceipts.forEach((r) => {
      const key = r.receiptDate || "";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredReceipts]);

  const exportExcel = () => {
    const headers = ["Дата", "Склад/АЗС", "Топливо", "Объём, л", "Цена, ₽/л", "Сумма, ₽", "Поставщик", "Менеджер", "Комментарий"];
    const body = filteredReceipts.map((r) => [
      r.receiptDate, locationLabel(locationById.get(r.locationId)), r.fuel, toNum(r.volume),
      toNum(r.price) || "", toNum(r.sum), r.supplier, r.createdBy, r.comment,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
    ws["!cols"] = headers.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Приход топлива");
    XLSX.writeFile(wb, `PlutosOil_склад_${todayStr().replace(/\./g, "-")}.xlsx`);
  };

  return (
    <>
      <div className="ps-kpi-grid" style={{ gridTemplateColumns: `repeat(${FUELS.length + 1}, 1fr)`, paddingBottom: 8 }}>
        {FUELS.map((f) => (
          <div key={f} className="ps-kpi-card">
            <div className="ps-kpi-card__label">Общий остаток {f}</div>
            <div className="ps-kpi-card__value">{fmtInt(globalBalance[f])} л</div>
          </div>
        ))}
        <div className="ps-kpi-card">
          <div className="ps-kpi-card__label">Общий остаток всего</div>
          <div className="ps-kpi-card__value">{fmtInt(globalTotal)} л</div>
        </div>
      </div>

      <div className="ps-chips" style={{ padding: "0 22px 10px" }}>
        <button className={`ps-chip ${locationType === "warehouse" ? "ps-chip--on" : ""}`} onClick={() => switchLocationType("warehouse")}>
          <Building2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Склады
        </button>
        <button className={`ps-chip ${locationType === "station" ? "ps-chip--on" : ""}`} onClick={() => switchLocationType("station")}>
          <Fuel size={13} style={{ verticalAlign: -2, marginRight: 4 }} />АЗС
        </button>
        <button type="button" className="ps-link-btn" style={{ marginLeft: 4 }} onClick={() => setManageOpen((v) => !v)}>
          {manageOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Управление точками
        </button>
      </div>

      <div className="ps-chips" style={{ padding: "0 22px 12px" }}>
        <button className={`ps-chip ${locationFilter === "all" ? "ps-chip--on" : ""}`} onClick={() => setLocationFilter("all")}>Все {typeLabel.toLowerCase()}</button>
        <button className={`ps-chip ${locationFilter === "" ? "ps-chip--on" : ""}`} onClick={() => setLocationFilter("")}>Без склада</button>
        {locationsOfType.map((l) => (
          <button key={l.id} className={`ps-chip ${locationFilter === l.id ? "ps-chip--on" : ""}`} onClick={() => setLocationFilter(l.id)}>
            {l.name}
          </button>
        ))}
        {locationsOfType.length === 0 && <span style={{ fontSize: 12.5, color: "#8A94A0" }}>Точек типа «{typeLabel}» пока нет — добавьте через «Управление точками».</span>}
      </div>

      {manageOpen && (
        <div className="ps-fieldset" style={{ margin: "0 22px 16px" }}>
          <div className="ps-field-row" style={{ alignItems: "flex-end" }}>
            <label className="ps-field">
              <span>Название новой точки</span>
              <input value={newLocationName} onChange={(e) => setNewLocationName(e.target.value)} placeholder="Например: Склад Ялта" />
            </label>
            <label className="ps-field">
              <span>Тип</span>
              <select value={newLocationType} onChange={(e) => setNewLocationType(e.target.value)}>
                <option value="warehouse">Склад</option>
                <option value="station">АЗС</option>
              </select>
            </label>
          </div>
          <label className="ps-field">
            <span>Адрес (для накладной)</span>
            <input value={newLocationAddress} onChange={(e) => setNewLocationAddress(e.target.value)} placeholder="Необязательно" />
          </label>
          <button type="button" className="ps-btn ps-btn--primary" style={{ width: "auto" }}
            disabled={!newLocationName.trim() || creatingLocation} onClick={createLocation}>
            <Plus size={13} /> {creatingLocation ? "Добавление…" : "Добавить точку"}
          </button>
          {locationError && <p style={{ color: "#C13B3B", fontSize: 12.5 }}>{locationError}</p>}
          {(locations || []).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              {locations.map((l) => (
                <div key={l.id} style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                  {l.type === "station" ? <Fuel size={12} /> : <Building2 size={12} />}
                  <span style={{ minWidth: 140 }}>{locationLabel(l)}</span>
                  <input
                    style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 8, padding: "5px 8px", fontSize: 12 }}
                    value={editAddress[l.id] ?? l.address ?? ""}
                    placeholder="Адрес для накладной"
                    onChange={(e) => setEditAddress((prev) => ({ ...prev, [l.id]: e.target.value }))}
                    onBlur={(e) => { if (e.target.value !== (l.address || "")) commitAddress(l.id, e.target.value); else setEditAddress((prev) => { const next = { ...prev }; delete next[l.id]; return next; }); }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="ps-history__head" style={{ margin: "0 22px 8px" }}>
        Остаток — {locationFilter === "all" ? typeLabel : locationFilter === "" ? "Без склада" : locationById.get(locationFilter)?.name || ""}
      </div>
      <div className="ps-kpi-grid" style={{ gridTemplateColumns: `repeat(${FUELS.length + 1}, 1fr)` }}>
        {FUELS.map((f) => (
          <div key={f} className="ps-kpi-card">
            <div className="ps-kpi-card__label">Остаток {f}</div>
            <div className="ps-kpi-card__value">{fmtInt(balanceOf(f))} л</div>
            <div className="ps-price-row__meta">приход {fmtInt(balances[f].received)} л · продано {fmtInt(balances[f].sold)} л</div>
          </div>
        ))}
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
        <button className="ps-btn" onClick={() => onOpenTransfer(null)}><ArrowLeftRight size={15} /> Переместить</button>
        <button className="ps-btn ps-btn--primary" style={{ width: "auto" }} onClick={() => onOpenReceipt(null)}><Plus size={15} /> Приход</button>
      </div>

      <div className="ps-journal">
        {receiptDays.map(([day, entries]) => {
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
                  <button key={r.id} type="button" className="ps-journal__entry" style={{ gridTemplateColumns: "1.2fr 1.4fr 1fr 1fr 1.2fr" }} onClick={() => onOpenReceipt(r)}>
                    <span className="ps-history__fuel">{r.fuel || "—"}</span>
                    <span>{locationLabel(locationById.get(r.locationId))}</span>
                    <span className="ps-journal__vol">{fmtInt(toNum(r.volume))} л</span>
                    <span className="ps-journal__sum">{toNum(r.sum) > 0 ? `${fmtInt(toNum(r.sum))} ₽` : "—"}</span>
                    <span className="ps-journal__manager">{r.createdBy ? <span style={{ color: colorForName(r.createdBy) }}>{r.createdBy}</span> : "—"}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {receiptDays.length === 0 && (
          <div className="ps-empty">
            {receiptsLoaded ? <><Warehouse size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Приходов пока нет — нажмите «Приход».</> : "Загрузка…"}
          </div>
        )}
      </div>

      {(locations || []).length > 0 && (
        <div className="ps-journal" style={{ marginTop: -8 }}>
          <div className="ps-history__head" style={{ margin: "0 22px 8px" }}>Перемещения между точками</div>
          {filteredTransfers.length === 0 && <div className="ps-empty">{transfersLoaded ? "Перемещений пока нет." : "Загрузка…"}</div>}
          {filteredTransfers.length > 0 && (
            <div className="ps-journal__entries" style={{ margin: "0 22px" }}>
              {filteredTransfers.map((t) => (
                <button key={t.id} type="button" className="ps-journal__entry" style={{ gridTemplateColumns: "1fr 1.3fr auto 1.3fr 1fr 1.2fr" }} onClick={() => onOpenTransfer(t)}>
                  <span className="ps-history__fuel">{t.fuel || "—"}</span>
                  <span>{locationLabel(locationById.get(t.fromLocationId))}</span>
                  <ArrowLeftRight size={13} />
                  <span>{locationLabel(locationById.get(t.toLocationId))}</span>
                  <span className="ps-journal__vol">{fmtInt(toNum(t.volume))} л</span>
                  <span className="ps-journal__manager">{t.createdBy ? <span style={{ color: colorForName(t.createdBy) }}>{t.createdBy}</span> : "—"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
