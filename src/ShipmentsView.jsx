import React, { useState, useMemo } from "react";
import { Download, FileSpreadsheet, CalendarRange, CalendarClock, AlertTriangle, ChevronLeft, ChevronRight, Fuel as FuelIcon, Truck } from "lucide-react";
import * as XLSX from "xlsx";
import { fmtInt, toNum, colorForName } from "./utils.js";
import { FUELS, DENSITY } from "./shared.jsx";

const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAY_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

const isoOf = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const todayIso = () => isoOf(new Date());
const daysAgoIso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d); };
const daysFromNowIso = (n) => daysAgoIso(-n);

const shortDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

const fuelText = (map) => [...map.entries()].map(([fuel, v]) => `${fuel} ${fmtInt(v)} л`).join(", ");

const STATUS_COLOR = { overdue: "#C13B3B", planned: "#E8871E", shipped: "#1E8A56" };

export default function ShipmentsView({ sales, clients, prices, shipments, onOpenSell }) {
  const [planWindow, setPlanWindow] = useState("7"); // 'today' | '7' | '30' | 'all' | 'custom' — на сколько вперёд планируем
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState(null); // iso date | "overdue" | "nodate" | null

  const openCustomWindow = () => {
    setPlanWindow("custom");
    if (!customFrom) setCustomFrom(todayIso());
    if (!customTo) setCustomTo(daysFromNowIso(29));
  };

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
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

  /* ---- сумма ещё не отгруженного остатка по сделке (по цене её же ---- */
  /* ---- позиций) — для отображения "на сколько ₽ ещё нужно отгрузить" ---- */
  const remainingSum = (r) => {
    let sum = 0;
    r.remaining.forEach((vol, fuel) => {
      const item = (r.group.items || []).find((it) => it.fuel === fuel);
      sum += vol * toNum(item?.price);
    });
    return sum;
  };

  /* ---- отчёт для склада: сколько топлива нужно приготовить и когда. ---- */
  /* ---- Просрочено и без даты показываются всегда целиком (это уже ---- */
  /* ---- горит), а окно "7/30 дней/период" сужает только сами даты. ---- */
  const windowFrom = planWindow === "custom" ? customFrom : todayIso();
  const windowTo = planWindow === "today" ? todayIso()
    : planWindow === "7" ? daysFromNowIso(6)
    : planWindow === "30" ? daysFromNowIso(29)
    : planWindow === "custom" ? customTo
    : null; // 'all' — без верхней границы

  const reportBuckets = useMemo(() => {
    const today = todayIso();
    const overdue = [];
    const noDate = [];
    const byDate = new Map();
    pendingGroups.forEach((r) => {
      const d = r.group.plannedShipDate;
      if (!d) { noDate.push(r); return; }
      if (d < today) { overdue.push(r); return; }
      if (windowFrom && d < windowFrom) return;
      if (windowTo && d > windowTo) return;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(r);
    });
    overdue.sort((a, b) => (a.group.plannedShipDate || "").localeCompare(b.group.plannedShipDate || ""));
    const dateBuckets = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const buckets = [];
    if (overdue.length) buckets.push({ key: "overdue", label: "Просрочено", rows: overdue, tone: "overdue" });
    if (noDate.length) buckets.push({ key: "nodate", label: "Без даты", rows: noDate, tone: "nodate" });
    dateBuckets.forEach(([d, rows]) => buckets.push({ key: d, label: d === today ? "Сегодня" : shortDate(d), rows, tone: d === today ? "today" : "future" }));
    return buckets;
  }, [pendingGroups, planWindow, windowFrom, windowTo]);

  const reportRows = useMemo(() => reportBuckets.flatMap((b) => b.rows), [reportBuckets]);

  const neededByFuel = useMemo(() => {
    const map = new Map(FUELS.map((f) => [f, 0]));
    reportRows.forEach((r) => r.remaining.forEach((vol, fuel) => { if (map.has(fuel)) map.set(fuel, map.get(fuel) + vol); }));
    return map;
  }, [reportRows]);

  const totalNeeded = FUELS.reduce((a, f) => a + neededByFuel.get(f), 0);
  const totalNeededSum = reportRows.reduce((a, r) => a + remainingSum(r), 0);
  const overdueRowCount = reportBuckets.find((b) => b.key === "overdue")?.rows.length || 0;

  const windowLabel = planWindow === "today" ? "на сегодня"
    : planWindow === "7" ? "на ближайшие 7 дней"
    : planWindow === "30" ? "на ближайшие 30 дней"
    : planWindow === "all" ? "на весь план"
    : `${shortDate(customFrom)} — ${shortDate(customTo)}`;

  const fileTag = planWindow === "custom" ? `${customFrom}_${customTo}` : `${todayIso()}_${planWindow}`;

  const exportExcel = () => {
    const summaryHeaders = ["Вид топлива", "Нужно, л", "≈ Тонн"];
    const summaryBody = FUELS.map((f) => {
      const vol = neededByFuel.get(f);
      const d = densityFor(f);
      return [f, vol, d > 0 ? +((vol * d) / 1000).toFixed(3) : ""];
    });
    summaryBody.push(["ИТОГО", totalNeeded, ""]);
    const ws1 = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryBody]);
    ws1["!cols"] = summaryHeaders.map(() => ({ wch: 18 }));

    const detailHeaders = ["Дата отгрузки", "Клиент", "Телефон", "Топливо и остаток", "Сумма остатка, ₽", "Менеджер", "Комментарий"];
    const detailBody = [];
    reportBuckets.forEach((bucket) => {
      bucket.rows.forEach((r) => {
        const client = clientById.get(r.group.clientId);
        detailBody.push([
          bucket.tone === "overdue" ? `Просрочено (было ${shortDate(r.group.plannedShipDate)})` : bucket.tone === "nodate" ? "Без даты" : bucket.label,
          client?.company || "Клиент удалён", client?.phone || "", fuelText(r.remaining),
          Math.round(remainingSum(r)), r.group.createdBy || "", r.group.comment || "",
        ]);
      });
    });
    const ws2 = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailBody]);
    ws2["!cols"] = detailHeaders.map(() => ({ wch: 20 }));

    const dayHeaders = ["Дата", ...FUELS.map((f) => `${f}, л`), "Итого, л", "Клиентов", "Сумма остатка, ₽"];
    const dayBody = reportBuckets.map((bucket) => {
      const byFuelDay = new Map(FUELS.map((f) => [f, 0]));
      let sum = 0;
      bucket.rows.forEach((r) => {
        r.remaining.forEach((vol, fuel) => { if (byFuelDay.has(fuel)) byFuelDay.set(fuel, byFuelDay.get(fuel) + vol); });
        sum += remainingSum(r);
      });
      const dayTotal = FUELS.reduce((a, f) => a + byFuelDay.get(f), 0);
      return [bucket.label, ...FUELS.map((f) => byFuelDay.get(f)), dayTotal, bucket.rows.length, Math.round(sum)];
    });
    dayBody.push(["ИТОГО", ...FUELS.map((f) => neededByFuel.get(f)), totalNeeded, reportRows.length, Math.round(totalNeededSum)]);
    const ws3 = XLSX.utils.aoa_to_sheet([dayHeaders, ...dayBody]);
    ws3["!cols"] = dayHeaders.map(() => ({ wch: 16 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws3, "По дням");
    XLSX.utils.book_append_sheet(wb, ws1, "Потребность по топливу");
    XLSX.utils.book_append_sheet(wb, ws2, "Детализация по клиентам");
    XLSX.writeFile(wb, `PlutosOil_план_отгрузок_${fileTag}.xlsx`);
  };

  return (
    <>
      <div className="ps-logi-header">
        <span className="ps-logi-header__title"><Truck size={17} /> План отгрузок для склада</span>
        <span className="ps-logi-header__sub">Сколько и какого топлива понадобится по дням — чтобы пополнять запас вовремя</span>
      </div>

      <div className="ps-toolbar">
        <div className="ps-chips">
          <button className={`ps-chip ${planWindow === "today" ? "ps-chip--on" : ""}`} onClick={() => setPlanWindow("today")}>Сегодня</button>
          <button className={`ps-chip ${planWindow === "7" ? "ps-chip--on" : ""}`} onClick={() => setPlanWindow("7")}>7 дней</button>
          <button className={`ps-chip ${planWindow === "30" ? "ps-chip--on" : ""}`} onClick={() => setPlanWindow("30")}>30 дней</button>
          <button className={`ps-chip ${planWindow === "all" ? "ps-chip--on" : ""}`} onClick={() => setPlanWindow("all")}>Весь план</button>
          <button className={`ps-chip ${planWindow === "custom" ? "ps-chip--on" : ""}`} onClick={openCustomWindow}><CalendarRange size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Период</button>
        </div>
        <div className="ps-toolbar__spacer" />
        <button className="ps-btn ps-btn--primary" style={{ width: "auto" }} disabled={reportRows.length === 0} onClick={exportExcel}>
          <Download size={15} /> Скачать Excel для склада
        </button>
      </div>

      {planWindow === "custom" && (
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
        <span className="ps-period-summary__label">Нужно приготовить {windowLabel}</span>
        <span className="ps-period-summary__stat"><b>{reportRows.length}</b> клиентов</span>
        <span className="ps-period-summary__divider" />
        <span className="ps-period-summary__stat ps-period-summary__stat--sum"><b>{fmtInt(totalNeeded)}</b> л к отгрузке</span>
        <span className="ps-period-summary__divider" />
        <span className="ps-period-summary__stat"><b>{fmtInt(totalNeededSum)}</b> ₽ остаток к отгрузке</span>
        {overdueRowCount > 0 && (
          <>
            <span className="ps-period-summary__divider" />
            <span className="ps-period-summary__stat ps-period-summary__stat--warn"><b>{overdueRowCount}</b> просрочено</span>
          </>
        )}
      </div>

      <div className="ps-kpi-grid" style={{ gridTemplateColumns: `repeat(${FUELS.length}, 1fr)` }}>
        {FUELS.map((f) => {
          const vol = neededByFuel.get(f);
          const d = densityFor(f);
          return (
            <div key={f} className="ps-kpi-card">
              <div className="ps-kpi-card__label">Нужно {f}</div>
              <div className="ps-kpi-card__value">{fmtInt(vol)} л</div>
              {d > 0 && <div className="ps-price-row__meta">≈ {((vol * d) / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т</div>}
            </div>
          );
        })}
      </div>

      {reportBuckets.length === 0 ? (
        <div className="ps-empty" style={{ margin: "0 22px 22px" }}>
          <FileSpreadsheet size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
          На этот план нет неотгруженных сделок.
        </div>
      ) : (
        <div className="ps-logi-days">
          {reportBuckets.map((bucket) => {
            const byFuelDay = new Map(FUELS.map((f) => [f, 0]));
            let daySum = 0;
            bucket.rows.forEach((r) => {
              r.remaining.forEach((vol, fuel) => { if (byFuelDay.has(fuel)) byFuelDay.set(fuel, byFuelDay.get(fuel) + vol); });
              daySum += remainingSum(r);
            });
            const dayTotal = FUELS.reduce((a, f) => a + byFuelDay.get(f), 0);
            return (
              <div key={bucket.key} className="ps-sell-section ps-logi-day">
                <div className="ps-logi-day__head">
                  <div className="ps-logi-day__date">
                    <span className={`ps-logi-day__date-main ps-cal-title--${bucket.tone}`}>
                      {bucket.tone === "overdue" && <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />}
                      {bucket.label}
                    </span>
                    {bucket.tone === "future" || bucket.tone === "today" ? (
                      <span className="ps-logi-day__date-week">{WEEKDAY_FULL[new Date(bucket.key + "T00:00:00").getDay()]}</span>
                    ) : null}
                  </div>
                  <div className="ps-logi-day__fuels">
                    {FUELS.filter((f) => byFuelDay.get(f) > 0).map((f) => (
                      <span key={f} className="ps-fuel-pill">{f} · {fmtInt(byFuelDay.get(f))} л</span>
                    ))}
                  </div>
                  <div className="ps-logi-day__total">
                    <span>{fmtInt(dayTotal)} л</span>
                    <span className="ps-logi-day__total-sum">{fmtInt(daySum)} ₽</span>
                  </div>
                </div>
                <div className="ps-logi-day__clients">
                  {bucket.rows.map((r) => {
                    const client = clientById.get(r.group.clientId);
                    return (
                      <button key={r.group.id} type="button" className="ps-logi-client-row" onClick={() => onOpenSell && onOpenSell(r.group.clientId, r.group)}>
                        <span className="ps-logi-client-row__name">{client?.company || "Клиент удалён"}</span>
                        <span className="ps-history__fuel">{fuelText(r.remaining)}</span>
                        <span className="ps-logi-client-row__sum">{fmtInt(remainingSum(r))} ₽</span>
                        <span>{client?.phone || "—"}</span>
                        <span className="ps-journal__manager">{r.group.createdBy ? <span style={{ color: colorForName(r.group.createdBy) }}>{r.group.createdBy}</span> : "—"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="ps-toolbar" style={{ marginTop: 8 }}>
        <div className="ps-field-head" style={{ flex: 1 }}>
          <span style={{ fontWeight: 600, color: "var(--petrol)", fontFamily: "var(--font-display)", fontSize: 15 }}>
            <CalendarClock size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Календарь отгрузок
          </span>
        </div>
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
    </>
  );
}
