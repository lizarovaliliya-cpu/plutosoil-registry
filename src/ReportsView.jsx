import React, { useState, useMemo } from "react";
import { Download, FileSpreadsheet, CalendarDays } from "lucide-react";
import * as XLSX from "xlsx";
import { fmtInt, toNum, colorForName } from "./utils.js";
import { FUELS, DENSITY, CONTAINER_LABELS } from "./shared.jsx";

const isoToday = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const shortDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

const locationLabel = (l) => (l ? `${l.type === "station" ? "АЗС" : "Склад"} · ${l.name}` : "Без склада");

export default function ReportsView({ sales, clients, locations, prices }) {
  const [date, setDate] = useState(isoToday());

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const locationById = useMemo(() => new Map((locations || []).map((l) => [l.id, l])), [locations]);
  const densityFor = (fuel) => toNum((prices || []).find((p) => p.fuel === fuel)?.density) || DENSITY[fuel] || 0;

  const dayGroups = useMemo(() => sales.filter((s) => s.saleDate === date), [sales, date]);
  const dayItems = useMemo(
    () => dayGroups.flatMap((g) => (g.items || []).map((it) => ({ ...it, group: g }))),
    [dayGroups]
  );

  const byFuel = useMemo(() => {
    const map = new Map(FUELS.map((f) => [f, { volume: 0, sum: 0 }]));
    dayItems.forEach((it) => {
      if (!map.has(it.fuel)) return;
      const m = map.get(it.fuel);
      m.volume += toNum(it.volume);
      m.sum += toNum(it.sum);
    });
    return map;
  }, [dayItems]);

  const totalVolume = FUELS.reduce((a, f) => a + byFuel.get(f).volume, 0);
  const totalSum = dayItems.reduce((a, it) => a + toNum(it.sum), 0);
  const shippedCount = dayGroups.filter((g) => g.shipped).length;

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

    const detailHeaders = ["Клиент", "Склад/АЗС отпуска", "Топливо", "Объём, л", "Тара", "Цена, ₽/л", "Сумма, ₽", "Отгружено", "Дата отгрузки", "Менеджер", "Комментарий"];
    const detailBody = dayItems.map((it) => [
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
    XLSX.writeFile(wb, `PlutosOil_отчёт_логистика_${date}.xlsx`);
  };

  return (
    <>
      <div className="ps-toolbar">
        <div className="ps-search" style={{ minWidth: "auto" }}>
          <CalendarDays size={15} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ border: "none", background: "transparent" }} />
        </div>
        <div className="ps-toolbar__spacer" />
        <button className="ps-btn ps-btn--primary" style={{ width: "auto" }} onClick={exportExcel}>
          <Download size={15} /> Скачать Excel для логистики
        </button>
      </div>

      <div className="ps-period-summary">
        <span className="ps-period-summary__label">Отчёт за {shortDate(date)}</span>
        <span className="ps-period-summary__stat"><b>{dayGroups.length}</b> сделок</span>
        <span className="ps-period-summary__divider" />
        <span className="ps-period-summary__stat ps-period-summary__stat--sum"><b>{fmtInt(totalVolume)}</b> л заказано</span>
        <span className="ps-period-summary__divider" />
        <span className="ps-period-summary__stat"><b>{fmtInt(totalSum)}</b> ₽ выручка</span>
        {dayGroups.length > 0 && (
          <>
            <span className="ps-period-summary__divider" />
            <span className="ps-period-summary__stat">отгружено <b>{shippedCount}</b> из {dayGroups.length}</span>
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
        {dayGroups.length === 0 ? (
          <div className="ps-empty">
            <FileSpreadsheet size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
            На эту дату сделок нет.
          </div>
        ) : (
          <div className="ps-journal__entries">
            {dayGroups.map((g) => {
              const client = clientById.get(g.clientId);
              return (
                <button key={g.id} type="button" className="ps-journal__entry" style={{ gridTemplateColumns: "1.6fr 2fr 1fr 1.2fr 1fr" }}>
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
