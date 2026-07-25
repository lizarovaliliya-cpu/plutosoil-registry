import React from "react";
import { X, Building2 } from "lucide-react";
import { Cell } from "./shared.jsx";

export default function CompanyProfileModal({ companyProfile, onUpdate, onClose }) {
  const p = companyProfile || {};

  return (
    <div className="ps-drawer__overlay" onClick={onClose}>
      <div className="ps-drawer__panel" style={{ width: "min(420px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="ps-drawer__head">
          <h2><Building2 size={17} style={{ verticalAlign: -3, marginRight: 6 }} />Реквизиты компании</h2>
          <button className="ps-mini" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ps-drawer__body">
          <p style={{ fontSize: 12.5, color: "#8A94A0", marginTop: 0 }}>
            Эти данные подставляются как поставщик в накладной на выдачу.
          </p>
          <label className="ps-field">
            <span>Название компании</span>
            <Cell value={p.name} onCommit={(v) => onUpdate("name", v)} placeholder="ООО «...» / ИП ..." />
          </label>
          <label className="ps-field">
            <span>ИНН</span>
            <Cell value={p.inn} onCommit={(v) => onUpdate("inn", v)} placeholder="ИНН" />
          </label>
          <label className="ps-field">
            <span>КПП</span>
            <Cell value={p.kpp} onCommit={(v) => onUpdate("kpp", v)} placeholder="КПП (если есть)" />
          </label>
          <label className="ps-field">
            <span>Юридический адрес</span>
            <Cell value={p.address} onCommit={(v) => onUpdate("address", v)} placeholder="Адрес" />
          </label>
          <label className="ps-field">
            <span>ФИО отпустившего груз (по умолчанию)</span>
            <Cell value={p.releasedBy} onCommit={(v) => onUpdate("releasedBy", v)} placeholder="Необязательно" />
          </label>
          {p.updatedAt > 0 && (
            <div className="ps-price-row__meta">
              Обновлено {p.updatedBy || "—"}, {new Date(p.updatedAt).toLocaleString("ru-RU")}
            </div>
          )}
        </div>
        <div className="ps-drawer__foot">
          <div className="ps-toolbar__spacer" />
          <button type="button" className="ps-btn" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
