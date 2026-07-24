import React from "react";
import { Fuel, Building2, CalendarDays, BarChart3 } from "lucide-react";

const ITEMS = [
  { key: "clients", label: "Клиенты", icon: Building2 },
  { key: "sales", label: "Реестр сделок", icon: CalendarDays },
  { key: "analytics", label: "Аналитика", icon: BarChart3 },
];

export default function Sidebar({ view, setView }) {
  return (
    <nav className="ps-sidebar">
      <div className="ps-sidebar__brand"><Fuel size={20} /> PlutosOil</div>
      {ITEMS.map(({ key, label, icon: Icon, soon }) => (
        <button
          key={key}
          className={`ps-sidebar__item ${view === key ? "ps-sidebar__item--on" : ""} ${soon ? "ps-sidebar__item--soon" : ""}`}
          onClick={() => !soon && setView(key)}
          disabled={soon}
        >
          <Icon size={16} />
          <span>{label}</span>
          {soon && <span className="ps-sidebar__badge">скоро</span>}
        </button>
      ))}
    </nav>
  );
}
