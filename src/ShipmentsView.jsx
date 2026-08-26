import React, { useState, useMemo } from "react";
import { Download, FileSpreadsheet, CalendarRange, CalendarClock, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import * as XLSX from "xlsx";
import { fmtInt, toNum, colorForName } from "./utils.js";
import { FUELS, DENSITY, CONTAINER_LABELS } from "./shared.jsx";

const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

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

const STATUS_COLOR = { overdue: "#C13B3B", planned: "#E8871E", shipped: "#1E8A56" };

export default function ShipmentsView({ sales, clients, locations, prices, shipments, onOpenSell }) {
  const [period, setPeriod] = useState("today"); // 'today' | 'yesterday' | 'custom'
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [onlyUnshipped, setOnlyUnshipped] = useState(false);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState(null); // iso date | "overdue" | "nodate" | null

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

  /* ---- визуальный календарь, две независимые части на каждую дату: ---- */
  /* ---- 1) plannedByDate — ещё не отгруженный остаток, у которого эта */
  /* ---- дата стоит как планируемая (красный, если дата уже прошла, ---- */
  /* ---- иначе оранжевый); 2) actualByDate — что реально отгружено этой */
  /* ---- датой по факту (журнал отгрузок sale_shipments, а для старых */
  /* ---- сделок без журнала — их дата отгрузки), зелёным. Дата может ---- */
  /* ---- попасть в обе части одновременно (часть ещё не отгружена, ---- */
  /* ---- часть уже фактически ушла в этот день). ---- */
  const plannedByDate = useMemo(() => {
    const map = new Map();
    pendingGroups.forEach((r) => {
      const d = r.group.plannedShipDate;
      if (!d) return;
      if (!map.has(d)) map.set(d, { count: 0, totalVolume: 0, byFuel: new Map() });
      const cur = map.get(d);
      cur.count += 1;
      r.remaining.forEach((vol, fuel) => {
        cur.totalVolume += vol;
        cur.byFuel.set(fuel, (cur.byFuel.get(fuel) || 0) + vol);
      });
    });
    return map;
  }, [pendingGroups]);

  const actualByDate = useMemo(() => {
    const map = new Map();
    const add = (d, groupId, fuel, vol) => {
      if (!d) return;
      if (!map.has(d)) map.set(d, { groupIds: new Set(), totalVolume: 0, byFuel: new Map() });
      const cur = map.get(d);
      cur.groupIds.add(groupId);
      cur.totalVolume += vol;
      cur.byFuel.set(fuel, (cur.byFuel.get(fuel) || 0) + vol);
    };
    const groupsWithLog = new Set();
    (shipments || []).forEach((s) => { groupsWithLog.add(s.groupId); add(s.shipDate, s.groupId, s.fuel, toNum(s.volume)); });
    // старые сделки, отгруженные целиком чекбоксом — без записей в журнале отгрузок
    sales.forEach((g) => {
      if (!g.shipped || !g.shippedDate || groupsWithLog.has(g.id)) return;
      (g.items || []).forEach((it) => add(g.shippedDate, g.id, it.fuel, toNum(it.volume)));
    });
    return map;
  }, [shipments, sales]);

  const dayInfo = useMemo(() => {
    const map = new Map();
    const today = todayIso();
    const dates = new Set([...plannedByDate.keys(), ...actualByDate.keys()]);
    dates.forEach((d) => {
      const planned = plannedByDate.get(d) || null;
      const actual = actualByDate.get(d) || null;
      const status = planned ? (d < today ? "overdue" : "planned") : "shipped";
      const totalVolume = (planned?.totalVolume || 0) + (actual?.totalVolume || 0);
      const count = (planned?.count || 0) + (actual?.groupIds.size || 0);
      map.set(d, { status, totalVolume, count, planned, actual });
    });
    return map;
  }, [plannedByDate, actualByDate]);

  const monthGrid = useMemo(() => {
    const year = calMonth.getFullYear(), month = calMonth.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // неделя с понедельника
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [calMonth]);

  const monthMaxTotal = useMemo(() => {
    let max = 0;
    monthGrid.forEach((iso) => { const v = iso && dayInfo.get(iso)?.totalVolume; if (v > max) max = v; });
    return max;
  }, [monthGrid, dayInfo]);

  const overdueCount = calendarBuckets.find((b) => b.key === "overdue")?.rows.length || 0;
  const noDateCount = calendarBuckets.find((b) => b.key === "nodate")?.rows.length || 0;

  const visibleBuckets = !selectedDay ? calendarBuckets : calendarBuckets.filter((b) => b.key === selectedDay);

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

  /* ---- та же потребность, но разбитая по дням — для Excel-выгрузки ---- */
  const byDay = useMemo(() => {
    const map = new Map();
    periodItems.forEach((it) => {
      const d = it.group.saleDate || "";
      if (!map.has(d)) map.set(d, { byFuel: new Map(), sum: 0, count: new Set() });
      const cur = map.get(d);
      cur.byFuel.set(it.fuel, (cur.byFuel.get(it.fuel) || 0) + toNum(it.volume));
      cur.sum += toNum(it.sum);
      cur.count.add(it.group.id);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [periodItems]);

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

    const dayHeaders = ["Дата", ...FUELS.map((f) => `${f}, л`), "Итого, л", "Сделок", "Сумма, ₽"];
    const dayBody = byDay.map(([d, info]) => {
      const dayTotal = FUELS.reduce((a, f) => a + (info.byFuel.get(f) || 0), 0);
      return [shortDate(d), ...FUELS.map((f) => info.byFuel.get(f) || 0), dayTotal, info.count.size, info.sum];
    });
    dayBody.push(["ИТОГО", ...FUELS.map((f) => byFuel.get(f).volume), totalVolume, periodGroups.length, totalSum]);
    const ws3 = XLSX.utils.aoa_to_sheet([dayHeaders, ...dayBody]);
    ws3["!cols"] = dayHeaders.map(() => ({ wch: 16 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws3, "По дням");
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

      <div className="ps-cal-widget">
        <div className="ps-cal-widget__head">
          <button type="button" className="ps-mini" onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}><ChevronLeft size={14} /></button>
          <span className="ps-cal-widget__title">{MONTH_NAMES[calMonth.getMonth()]} {calMonth.getFullYear()}</span>
          <button type="button" className="ps-mini" onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}><ChevronRight size={14} /></button>
          <button type="button" className="ps-link-btn" style={{ marginLeft: 6 }}
            onClick={() => { const d = new Date(); setCalMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Сегодня</button>
          <div className="ps-toolbar__spacer" />
          {overdueCount > 0 && (
            <button type="button" className={`ps-chip ps-chip--warn ${selectedDay === "overdue" ? "ps-chip--on" : ""}`}
              onClick={() => setSelectedDay((d) => (d === "overdue" ? null : "overdue"))}>
              <AlertTriangle size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Просрочено {overdueCount}
            </button>
          )}
          {noDateCount > 0 && (
            <button type="button" className={`ps-chip ${selectedDay === "nodate" ? "ps-chip--on" : ""}`}
              onClick={() => setSelectedDay((d) => (d === "nodate" ? null : "nodate"))}>
              Без даты {noDateCount}
            </button>
          )}
          {selectedDay && <button type="button" className="ps-link-btn" onClick={() => setSelectedDay(null)}>Показать все дни ×</button>}
        </div>
        <div className="ps-cal-legend">
          <span><i style={{ background: STATUS_COLOR.overdue }} /> Просрочено</span>
          <span><i style={{ background: STATUS_COLOR.planned }} /> Планируется</span>
          <span><i style={{ background: STATUS_COLOR.shipped }} /> Отгружено</span>
        </div>
        <div className="ps-cal-grid">
          {WEEKDAY_LABELS.map((l) => <div key={l} className="ps-cal-grid__wd">{l}</div>)}
          {monthGrid.map((iso, idx) => {
            if (!iso) return <div key={idx} className="ps-cal-cell ps-cal-cell--empty" />;
            const info = dayInfo.get(iso);
            const isToday = iso === todayIso();
            const dayNum = +iso.slice(8, 10);
            const ratio = info && monthMaxTotal > 0 ? Math.max(0.12, Math.min(1, info.totalVolume / monthMaxTotal)) : 0;
            return (
              <button key={iso} type="button" disabled={!info}
                className={`ps-cal-cell ${isToday ? "ps-cal-cell--today" : ""} ${selectedDay === iso ? "ps-cal-cell--selected" : ""}`}
                onClick={() => setSelectedDay((d) => (d === iso ? null : iso))}>
                {info && <div className="ps-cal-cell__fill" style={{ height: `${ratio * 100}%`, background: STATUS_COLOR[info.status] }} />}
                <div className="ps-cal-cell__content">
                  <div className="ps-cal-cell__top">
                    <span className="ps-cal-cell__num">{dayNum}</span>
                    {info && <span className="ps-cal-cell__count" style={{ background: STATUS_COLOR[info.status] }}>{info.count}</span>}
                  </div>
                  {info?.planned && FUELS.filter((f) => info.planned.byFuel.has(f)).map((f) => (
                    <span key={"p" + f} className="ps-cal-cell__stat">{f} {fmtInt(info.planned.byFuel.get(f))}л</span>
                  ))}
                  {info?.actual && FUELS.filter((f) => info.actual.byFuel.has(f)).map((f) => (
                    <span key={"a" + f} className="ps-cal-cell__stat ps-cal-cell__stat--done">✓ {f} {fmtInt(info.actual.byFuel.get(f))}л</span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {visibleBuckets.length === 0 ? (
        <div className="ps-empty">{calendarBuckets.length === 0 ? "Нет сделок с неотгруженным остатком." : "На эту дату всё уже отгружено или нет запланированных отгрузок."}</div>
      ) : (
        <div className="ps-journal" style={{ marginBottom: 24 }}>
          {visibleBuckets.map((bucket) => (
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
          <button className={`ps-chip ${period === "custom" && customFrom === daysAgoIso(6) ? "ps-chip--on" : ""}`}
            onClick={() => { setPeriod("custom"); setCustomFrom(daysAgoIso(6)); setCustomTo(todayIso()); }}>7 дней</button>
          <button className={`ps-chip ${period === "custom" && customFrom === daysAgoIso(29) ? "ps-chip--on" : ""}`}
            onClick={() => { setPeriod("custom"); setCustomFrom(daysAgoIso(29)); setCustomTo(todayIso()); }}>30 дней</button>
          <button className={`ps-chip ${period === "custom" ? "ps-chip--on" : ""}`} onClick={openCustomPeriod}><CalendarRange size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Период</button>
        </div>
        <button className={`ps-chip ${onlyUnshipped ? "ps-chip--on" : ""}`} onClick={() => setOnlyUnshipped((v) => !v)}>Не отгружено</button>
        <div className="ps-toolbar__spacer" />
        <button className="ps-btn ps-btn--primary" style={{ width: "auto" }} disabled={periodGroups.length === 0} onClick={exportExcel}>
          <Download size={15} /> Скачать Excel для логистики
        </button>
      </div>

      {period === "custom" && (
        <div className="ps-toolbar ps-toolbar--period">
          <div className="ps-period-range">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span>—</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            {customFrom && customTo && customFrom > customTo && (
              <span style={{ color: "#C13B3B", fontSize: 12 }}>Дата «с» позже даты «по» — период пуст</span>
            )}
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
