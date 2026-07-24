import React, { useState, useMemo } from "react";
import { X, ShoppingCart } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { toNum, fmtInt, toDbSale } from "./utils.js";
import { FUELS } from "./shared.jsx";

const isoToday = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function SellModal({ clients, managerName, presetClientId, onClose }) {
  const sortedClients = useMemo(() => [...clients].sort((a, b) => a.company.localeCompare(b.company, "ru")), [clients]);
  const [clientId, setClientId] = useState(presetClientId || (sortedClients[0]?.id ?? ""));
  const [fuel, setFuel] = useState(FUELS[0]);
  const [price, setPrice] = useState("");
  const [volume, setVolume] = useState("");
  const [saleDate, setSaleDate] = useState(isoToday());
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const sum = toNum(price) * toNum(volume);

  const save = async () => {
    if (!clientId || !toNum(price) || !toNum(volume)) return;
    setSaving(true);
    setError("");
    const payload = toDbSale({ clientId, fuel, price, volume, sum, saleDate, comment, createdBy: managerName || "Гость" });
    const { error: err } = await supabase.from("sales").insert([payload]);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onClose();
  };

  return (
    <div className="ps-drawer__overlay" onClick={onClose}>
      <div className="ps-drawer__panel" style={{ width: "min(420px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="ps-drawer__head">
          <h2><ShoppingCart size={17} style={{ verticalAlign: -3, marginRight: 6 }} />Оформить продажу</h2>
          <button className="ps-mini" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ps-drawer__body">
          <label className="ps-field">
            <span>Клиент *</span>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!!presetClientId}>
              {sortedClients.length === 0 && <option value="">Нет клиентов — сначала добавьте карточку</option>}
              {sortedClients.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
            </select>
          </label>
          <label className="ps-field">
            <span>Вид топлива</span>
            <select value={fuel} onChange={(e) => setFuel(e.target.value)}>
              {FUELS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="ps-field">
            <span>Цена за литр, ₽ *</span>
            <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
          </label>
          <label className="ps-field">
            <span>Объём, л *</span>
            <input type="number" min="0" step="1" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="0" />
          </label>
          <div className="ps-field">
            <span>Сумма</span>
            <div className="ps-sell-sum">{fmtInt(sum)} ₽</div>
          </div>
          <label className="ps-field">
            <span>Дата продажи</span>
            <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
          </label>
          <label className="ps-field">
            <span>Комментарий</span>
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Необязательно" />
          </label>
          {error && <p style={{ color: "#C13B3B", fontSize: 12.5 }}>{error}</p>}
        </div>
        <div className="ps-drawer__foot">
          <div className="ps-toolbar__spacer" />
          <button type="button" className="ps-btn" onClick={onClose}>Отмена</button>
          <button type="button" className="ps-btn ps-btn--primary" style={{ width: "auto" }}
            disabled={!clientId || !toNum(price) || !toNum(volume) || saving} onClick={save}>
            {saving ? "Сохранение…" : "Оформить продажу"}
          </button>
        </div>
      </div>
    </div>
  );
}
