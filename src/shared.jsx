import React, { useState, useEffect } from "react";
import { fmtInt, fmtT } from "./utils.js";

export const FUELS = ["АИ-92", "АИ-95", "ДТ К5"];
export const DENSITY = { "АИ-92": 0.72, "АИ-95": 0.72, "ДТ К5": 0.82 }; // кг/л, запасное значение — реальный коэффициент задаётся в блоке "Цены"

export const CONTAINER_LABELS = { own: "своя тара", buy: "+ тара", rent: "аренда тары" };

export const SOURCES = ["Сов Мин", "Рекомендация", "Сайт", "Авито", "Холодный обзвон", "Другое"];

export const STATUSES = [
  { value: "", label: "Новый", color: "#7A8794", bg: "#EEF1F4" },
  { value: "КП отправлено", label: "КП отправлено", color: "#175983", bg: "#DCEAF3" },
  { value: "Проект договора", label: "Проект договора", color: "#7C5CBF", bg: "#EEE8FA" },
  { value: "Счёт выставлен", label: "Счёт выставлен", color: "#B9770E", bg: "#FBEEDA" },
  { value: "Уточняет", label: "Уточняет", color: "#C9750E", bg: "#FCEBD3" },
  { value: "Думает", label: "Думает", color: "#D68A1E", bg: "#FDF0DC" },
  { value: "Купили", label: "Купили", color: "#1E8A56", bg: "#E1F4EA" },
  { value: "Отказ", label: "Отказ", color: "#C13B3B", bg: "#FBE4E4" },
];
export const statusMeta = (v) => STATUSES.find((s) => s.value === (v || "")) || STATUSES[0];

/* ---------- инлайн-редактируемая ячейка ---------- */
export function Cell({ value, onCommit, type = "text", options, align, mono, placeholder }) {
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value]);
  const commit = () => { if (local !== (value ?? "")) onCommit(local); };

  if (type === "select") {
    return (
      <select className="ps-select" value={local ?? ""} onChange={(e) => { setLocal(e.target.value); onCommit(e.target.value); }}
        style={{ color: statusMeta(local).color, background: statusMeta(local).bg }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (type === "fuel") {
    return (
      <select className="ps-select ps-select--fuel" value={local ?? ""} onChange={(e) => { setLocal(e.target.value); onCommit(e.target.value); }}>
        <option value="">—</option>
        {FUELS.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
    );
  }
  return (
    <input className="ps-input" style={{ textAlign: align || "left", fontFamily: mono ? "var(--font-mono)" : "inherit" }}
      type={type} value={local ?? ""} placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} />
  );
}

export function SuggestDropdown({ items, onPick }) {
  if (items.length === 0) return null;
  return (
    <div className="ps-suggest">
      <div className="ps-suggest__hint">Похоже, уже есть в базе:</div>
      {items.map((c) => (
        <button key={c.id} type="button" className="ps-suggest__item" onMouseDown={(e) => { e.preventDefault(); onPick(c); }}>
          <span className="ps-suggest__company">{c.company || "Без названия"}</span>
          <span className="ps-suggest__meta">{c.contactName || "—"} · {c.phone || "—"}</span>
        </button>
      ))}
    </div>
  );
}

export function FuelGauge({ fuel, stats }) {
  const pct = stats.weekly > 0 ? Math.min(100, (stats.purchased / stats.weekly) * 100) : 0;
  return (
    <div className="ps-gauge">
      <div className="ps-gauge__top"><span className="ps-gauge__fuel">{fuel}</span><span className="ps-gauge__pct">{pct.toFixed(0)}%</span></div>
      <div className="ps-gauge__track"><div className="ps-gauge__fill" style={{ width: `${pct}%` }} /></div>
      <div className="ps-gauge__nums"><span><b>{fmtInt(stats.purchased)}</b> л куплено</span><span className="ps-gauge__need">из {fmtInt(stats.weekly)} л/нед</span></div>
      <div className="ps-gauge__meta">{stats.count} заявок · ≈{fmtT(stats.weekly * DENSITY[fuel])} т/нед · {fmtInt(stats.sum)} ₽ выручки</div>
    </div>
  );
}
