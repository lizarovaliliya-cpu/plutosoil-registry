import React from "react";
import { Fuel, Table, Building2, ShoppingCart, BarChart3 } from "lucide-react";

const ITEMS = [
  { key: "registry", label: "Реестр", icon: Table },
  { key: "clients", label: "Клиенты", icon: Building2 },
  { key: "sales", label: "Продажи", icon: ShoppingCart },
  { key: "analytics", label: "Аналитика", icon: BarChart3, soon: true },
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
