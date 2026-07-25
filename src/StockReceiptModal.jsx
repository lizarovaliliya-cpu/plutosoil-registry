import React, { useState } from "react";
import { X, Warehouse, Trash2 } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { toNum, fmtInt, toDbReceipt } from "./utils.js";
import { FUELS } from "./shared.jsx";

const isoToday = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function StockReceiptModal({ receipt, managerName, managers, onClose }) {
  const isEdit = !!receipt;
  const [fuel, setFuel] = useState(receipt?.fuel || FUELS[0]);
  const [volume, setVolume] = useState(receipt?.volume ?? "");
  const [price, setPrice] = useState(receipt?.price ?? "");
  const [supplier, setSupplier] = useState(receipt?.supplier || "");
  const [receiptDate, setReceiptDate] = useState(receipt?.receiptDate || isoToday());
  const [comment, setComment] = useState(receipt?.comment || "");
  const [createdBy, setCreatedBy] = useState(receipt?.createdBy || managerName || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const sum = toNum(price) * toNum(volume);

  const save = async () => {
    if (!toNum(volume)) return;
    setSaving(true);
    setError("");
    const payload = toDbReceipt({ fuel, volume, price, sum, supplier, receiptDate, comment, createdBy: createdBy || managerName || "Гость" });
    const { error: err } = isEdit
      ? await supabase.from("stock_receipts").update(payload).eq("id", receipt.id)
      : await supabase.from("stock_receipts").insert([payload]);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onClose();
  };

  const remove = async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    setSaving(true);
    const { error: err } = await supabase.from("stock_receipts").delete().eq("id", receipt.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onClose();
  };

  return (
    <div className="ps-drawer__overlay" onClick={onClose}>
      <div className="ps-drawer__panel" style={{ width: "min(420px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="ps-drawer__head">
          <h2><Warehouse size={17} style={{ verticalAlign: -3, marginRight: 6 }} />{isEdit ? "Приход топлива" : "Новый приход"}</h2>
          <button className="ps-mini" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ps-drawer__body">
          <label className="ps-field">
            <span>Менеджер</span>
            <select value={createdBy} onChange={(e) => setCreatedBy(e.target.value)}>
              <option value="">Не указан</option>
              {createdBy && !(managers || []).includes(createdBy) && <option value={createdBy}>{createdBy}</option>}
              {(managers || []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="ps-field">
            <span>Вид топлива</span>
            <select value={fuel} onChange={(e) => setFuel(e.target.value)}>
              {FUELS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="ps-field">
            <span>Объём, л *</span>
            <input type="number" min="0" step="1" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="0" />
          </label>
          <label className="ps-field">
            <span>Цена закупки, ₽/л</span>
            <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Необязательно" />
          </label>
          {sum > 0 && (
            <div className="ps-field">
              <span>Сумма</span>
              <div className="ps-sell-sum">{fmtInt(sum)} ₽</div>
            </div>
          )}
          <label className="ps-field">
            <span>Поставщик</span>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Необязательно" />
          </label>
          <label className="ps-field">
            <span>Дата прихода</span>
            <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
          </label>
          <label className="ps-field">
            <span>Комментарий</span>
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Необязательно" />
          </label>
          {error && <p style={{ color: "#C13B3B", fontSize: 12.5 }}>{error}</p>}
        </div>
        <div className="ps-drawer__foot">
          {isEdit && (
            <button type="button" className={`ps-btn ${deleteConfirm ? "ps-del--confirm" : ""}`} onClick={remove} disabled={saving}>
              <Trash2 size={14} /> {deleteConfirm ? "Точно удалить?" : "Удалить"}
            </button>
          )}
          <div className="ps-toolbar__spacer" />
          <button type="button" className="ps-btn" onClick={onClose}>Отмена</button>
          <button type="button" className="ps-btn ps-btn--primary" style={{ width: "auto" }}
            disabled={!toNum(volume) || saving} onClick={save}>
            {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Добавить приход"}
          </button>
        </div>
      </div>
    </div>
  );
}
