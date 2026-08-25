import React, { useState, useMemo } from "react";
import { Download, FileSpreadsheet, CalendarRange, CalendarClock, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";
import { fmtInt, toNum, colorForName } from "./utils.js";
import { FUELS, DENSITY, CONTAINER_LABELS } from "./shared.jsx";

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

const locationLabel = (l) => (l ? `${l.type === "station" ? "АЗС" : "Склад"} · ${l.name}` : "Без склада");

const fuelText = (map) => [...map.entries()].map(([fuel, v]) => `${fuel} ${fmtInt(v)} л`).join(", ");

export default function ReportsView({ sales, clients, locations, prices, shipments, onOpenSell }) {
  const [period, setPeriod] = useState("today"); // 'today' | 'yesterday' | 'custom'
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [onlyUnshipped, setOnlyUnshipped] = useState(false);

  const openCustomPeriod = () => {
    setPeriod("custom");
    if (!customFrom) setCustomFrom(todayIso());
    if (!customTo) setCustomTo(todayIso());
  };

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const locationById = useMemo(() => new Map((locations || []).map((l) => [l.id, l])), [locations]);
  const densityFor = (fuel) => toNum((prices || []).find((p) => p.fuel === fuel)?.density) || DENSITY[fuel] || 0;

  /* ---- календарь отгрузок: сделки с ещё не отгруженным остатком, ---- */
  /* ---- сгруппированные по планируемой дате отгрузки ---- */
  const shipmentsByGroup = useMemo(() => {
    const map = new Map();
    (shipments || []).forEach((sh) => {
      if (!map.has(sh.groupId)) map.set(sh.groupId, []);
      map.get(sh.groupId).push(sh);
    });
    return map;
  }, [shipments]);

  const pendingGroups = useMemo(() => {
    return sales
      .map((g) => {
        const shipped = shipmentsByGroup.get(g.id) || [];
        const remaining = new Map();
        (g.items || []).forEach((it) => remaining.set(it.fuel, (remaining.get(it.fuel) || 0) + toNum(it.volume)));
        shipped.forEach((s) => remaining.set(s.fuel, (remaining.get(s.fuel) || 0) - toNum(s.volume)));
        [...remaining.keys()].forEach((f) => { if (remaining.get(f) <= 0.001) remaining.delete(f); });
        return { group: g, remaining };
      })
      .filter((r) => r.remaining.size > 0 && !r.group.shipped);
  }, [sales, shipmentsByGroup]);

  const calendarBuckets = useMemo(() => {
    const today = todayIso();
    const overdue = [];
    const noDate = [];
    const byDate = new Map();
    pendingGroups.forEach((r) => {
      const d = r.group.plannedShipDate;
      if (!d) { noDate.push(r); return; }
      if (d < today) { overdue.push(r); return; }
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(r);
    });
    overdue.sort((a, b) => (a.group.plannedShipDate || "").localeCompare(b.group.plannedShipDate || ""));
    const dateBuckets = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const buckets = [];
    if (overdue.length) buckets.push({ key: "overdue", label: "Просрочено", rows: overdue, tone: "overdue" });
    if (noDate.length) buckets.push({ key: "nodate", label: "Без даты", rows: noDate, tone: "nodate" });
    dateBuckets.forEach(([d, rows]) => buckets.push({ key: d, label: d === today ? `Сегодня, ${shortDate(d)}` : shortDate(d), rows, tone: d === today ? "today" : "future" }));
    return buckets;
  }, [pendingGroups]);

  const exportCalendarExcel = () => {
    const headers = ["Дата отгрузки", "Клиент", "Остаток к отгрузке", "Телефон", "Комментарий", "Менеджер"];
    const body = [];
    calendarBuckets.forEach((bucket) => {
      bucket.rows.forEach((r) => {
        const client = clientById.get(r.group.clientId);
        body.push([
          bucket.tone === "overdue" ? `Просрочено (${shortDate(r.group.plannedShipDate)})` : bucket.tone === "nodate" ? "Без даты" : bucket.label,
          client?.company || "Клиент удалён", fuelText(r.remaining), client?.phone || "", r.group.comment || "", r.group.createdBy || "",
        ]);
      });
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
    ws["!cols"] = headers.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Календарь отгрузок");
    XLSX.writeFile(wb, `PlutosOil_календарь_отгрузок_${todayIso()}.xlsx`);
  };

  const periodGroups = useMemo(() => {
    let out = sales;
    if (period === "today") out = out.filter((s) => s.saleDate === todayIso());
    else if (period === "yesterday") out = out.filter((s) => s.saleDate === yesterdayIso());
    else if (period === "custom") {
      out = out.filter((s) => (!customFrom || s.saleDate >= customFrom) && (!customTo || s.saleDate <= customTo));
    }
    if (onlyUnshipped) out = out.filter((s) => !s.shipped);
    return [...out].sort((a, b) => (a.saleDate || "").localeCompare(b.saleDate || ""));
  }, [sales, period, customFrom, customTo, onlyUnshipped]);

  const periodItems = useMemo(
    () => periodGroups.flatMap((g) => (g.items || []).map((it) => ({ ...it, group: g }))),
    [periodGroups]
  );

  const byFuel = useMemo(() => {
    const map = new Map(FUELS.map((f) => [f, { volume: 0, sum: 0 }]));
    periodItems.forEach((it) => {
      if (!map.has(it.fuel)) return;
      const m = map.get(it.fuel);
      m.volume += toNum(it.volume);
      m.sum += toNum(it.sum);
    });
    return map;
  }, [periodItems]);

  const totalVolume = FUELS.reduce((a, f) => a + byFuel.get(f).volume, 0);
  const totalSum = periodItems.reduce((a, it) => a + toNum(it.sum), 0);
  const shippedCount = periodGroups.filter((g) => g.shipped).length;

  const periodLabel = period === "today" ? "сегодня"
    : period === "yesterday" ? "вчера"
    : `${shortDate(customFrom)} — ${shortDate(customTo)}`;

  const fileTag = period === "today" ? todayIso()
    : period === "yesterday" ? yesterdayIso()
    : `${customFrom}_${customTo}`;

  const exportExcel = () => {
    const summaryHeaders = ["Вид топлива", "Объём, л", "≈ Тонн", "Сумма, ₽"];
    const summaryBody = FUELS.map((f) => {
      const m = byFuel.get(f);
      const d = densityFor(f);
      return [f, m.volume, d > 0 ? +((m.volume * d) / 1000).toFixed(3) : "", m.sum];
    });
    summaryBody.push(["ИТОГО", totalVolume, "", totalSum]);
    const ws1 = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryBody]);
    ws1["!cols"] = summaryHeaders.map(() => ({ wch: 18 }));

    const detailHeaders = ["Дата", "Клиент", "Склад/АЗС отпуска", "Топливо", "Объём, л", "Тара", "Цена, ₽/л", "Сумма, ₽", "Отгружено", "Дата отгрузки", "Менеджер", "Комментарий"];
    const detailBody = periodItems.map((it) => [
      it.group.saleDate,
      clientById.get(it.group.clientId)?.company || "Клиент удалён",
      locationLabel(locationById.get(it.locationId)),
      it.fuel, toNum(it.volume),
      it.containerMode ? CONTAINER_LABELS[it.containerMode] : "",
      toNum(it.price), toNum(it.sum),
      it.group.shipped ? "Да" : "Нет", it.group.shippedDate || "",
      it.group.createdBy, it.group.comment,
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailBody]);
    ws2["!cols"] = detailHeaders.map(() => ({ wch: 18 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Потребность по топливу");
    XLSX.utils.book_append_sheet(wb, ws2, "Детализация по сделкам");
    XLSX.writeFile(wb, `PlutosOil_отчёт_логистика_${fileTag}.xlsx`);
  };

  return (
    <>
      <div className="ps-toolbar">
        <div className="ps-field-head" style={{ flex: 1 }}>
          <span style={{ fontWeight: 600, color: "var(--petrol)", fontFamily: "var(--font-display)", fontSize: 15 }}>
            <CalendarClock size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Календарь отгрузок
          </span>
        </div>
        <button className="ps-btn" disabled={calendarBuckets.length === 0} onClick={exportCalendarExcel}>
          <Download size={15} /> Excel
        </button>
      </div>

      {calendarBuckets.length === 0 ? (
        <div className="ps-empty">Нет сделок с неотгруженным остатком.</div>
      ) : (
        <div className="ps-journal" style={{ marginBottom: 24 }}>
          {calendarBuckets.map((bucket) => (
            <div key={bucket.key} className="ps-journal__day">
              <div className="ps-journal__day-head">
                <span className={`ps-cal-title ps-cal-title--${bucket.tone}`}>
                  {bucket.tone === "overdue" && <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />}
                  {bucket.label}
                </span>
                <span className="ps-journal__day-stats">{bucket.rows.length} {bucket.rows.length === 1 ? "сделка" : "сделки"}</span>
              </div>
              <div className="ps-journal__entries">
                {bucket.rows.map((r) => {
                  const client = clientById.get(r.group.clientId);
                  return (
                    <button key={r.group.id} type="button" className="ps-journal__entry" style={{ gridTemplateColumns: "1.6fr 1.6fr 1fr 1.4fr 1fr" }}
                      onClick={() => onOpenSell && onOpenSell(r.group.clientId, r.group)}>
                      <span className="ps-journal__client">{client?.company || "Клиент удалён"}</span>
                      <span className="ps-history__fuel">{fuelText(r.remaining)}</span>
                      <span>{client?.phone || "—"}</span>
                      <span style={{ color: "#8A94A0", fontSize: 11.5 }}>{r.group.comment || ""}</span>
                      <span className="ps-journal__manager">{r.group.createdBy ? <span style={{ color: colorForName(r.group.createdBy) }}>{r.group.createdBy}</span> : "—"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="ps-toolbar">
        <div className="ps-chips">
          <button className={`ps-chip ${period === "today" ? "ps-chip--on" : ""}`} onClick={() => setPeriod("today")}>Сегодня</button>
          <button className={`ps-chip ${period === "yesterday" ? "ps-chip--on" : ""}`} onClick={() => setPeriod("yesterday")}>Вчера</button>
          <button className={`ps-chip ${period === "custom" ? "ps-chip--on" : ""}`} onClick={openCustomPeriod}><CalendarRange size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Период</button>
        </div>
        <button className={`ps-chip ${onlyUnshipped ? "ps-chip--on" : ""}`} onClick={() => setOnlyUnshipped((v) => !v)}>Не отгружено</button>
        <div className="ps-toolbar__spacer" />
        <button className="ps-btn ps-btn--primary" style={{ width: "auto" }} onClick={exportExcel}>
          <Download size={15} /> Скачать Excel для логистики
        </button>
      </div>

      {period === "custom" && (
        <div className="ps-toolbar ps-toolbar--period">
          <div className="ps-period-range">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span>—</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        </div>
      )}

      <div className="ps-period-summary">
        <span className="ps-period-summary__label">Отчёт за {periodLabel}</span>
        <span className="ps-period-summary__stat"><b>{periodGroups.length}</b> сделок</span>
        <span className="ps-period-summary__divider" />
        <span className="ps-period-summary__stat ps-period-summary__stat--sum"><b>{fmtInt(totalVolume)}</b> л заказано</span>
        <span className="ps-period-summary__divider" />
        <span className="ps-period-summary__stat"><b>{fmtInt(totalSum)}</b> ₽ выручка</span>
        {periodGroups.length > 0 && (
          <>
            <span className="ps-period-summary__divider" />
            <span className="ps-period-summary__stat">отгружено <b>{shippedCount}</b> из {periodGroups.length}</span>
          </>
        )}
      </div>

      <div className="ps-kpi-grid" style={{ gridTemplateColumns: `repeat(${FUELS.length}, 1fr)` }}>
        {FUELS.map((f) => {
          const m = byFuel.get(f);
          const d = densityFor(f);
          return (
            <div key={f} className="ps-kpi-card">
              <div className="ps-kpi-card__label">Потребность {f}</div>
              <div className="ps-kpi-card__value">{fmtInt(m.volume)} л</div>
              {d > 0 && <div className="ps-price-row__meta">≈ {((m.volume * d) / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т</div>}
            </div>
          );
        })}
      </div>

      <div className="ps-journal">
        {periodGroups.length === 0 ? (
          <div className="ps-empty">
            <FileSpreadsheet size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
            За этот период сделок нет.
          </div>
        ) : (
          <div className="ps-journal__entries">
            {periodGroups.map((g) => {
              const client = clientById.get(g.clientId);
              return (
                <button key={g.id} type="button" className="ps-journal__entry" style={{ gridTemplateColumns: "0.9fr 1.4fr 2fr 1fr 1.2fr 1fr" }}>
                  <span>{shortDate(g.saleDate)}</span>
                  <span className="ps-journal__client">{client?.company || "Клиент удалён"}</span>
                  <span className="ps-history__fuel">
                    {(g.items || []).map((i) => `${i.fuel} ${fmtInt(toNum(i.volume))} л${i.locationId ? ` (${locationLabel(locationById.get(i.locationId))})` : ""}`).join(", ")}
                  </span>
                  <span className="ps-journal__sum">{fmtInt(toNum(g.sum))} ₽</span>
                  <span>
                    {g.shipped
                      ? <span className="ps-ship-badge ps-ship-badge--done">Отгружено</span>
                      : <span className="ps-ship-badge ps-ship-badge--pending">Не отгружено</span>}
                  </span>
                  <span className="ps-journal__manager">{g.createdBy ? <span style={{ color: colorForName(g.createdBy) }}>{g.createdBy}</span> : "—"}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
