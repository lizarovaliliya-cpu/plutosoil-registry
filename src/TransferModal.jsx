import React, { useState } from "react";
import { X, ArrowLeftRight, Trash2 } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { toNum, toDbTransfer } from "./utils.js";
import { FUELS } from "./shared.jsx";

const isoToday = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function TransferModal({ transfer, managerName, managers, locations, onClose }) {
  const isEdit = !!transfer;
  const [fromLocationId, setFromLocationId] = useState(transfer?.fromLocationId || (locations[0]?.id ?? ""));
  const [toLocationId, setToLocationId] = useState(transfer?.toLocationId || (locations[1]?.id ?? locations[0]?.id ?? ""));
  const [fuel, setFuel] = useState(transfer?.fuel || FUELS[0]);
  const [volume, setVolume] = useState(transfer?.volume ?? "");
  const [transferDate, setTransferDate] = useState(transfer?.transferDate || isoToday());
  const [comment, setComment] = useState(transfer?.comment || "");
  const [createdBy, setCreatedBy] = useState(transfer?.createdBy || managerName || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const sameLocation = fromLocationId && toLocationId && fromLocationId === toLocationId;

  const save = async () => {
    if (!toNum(volume) || !fromLocationId || !toLocationId || sameLocation) return;
    setSaving(true);
    setError("");
    const payload = toDbTransfer({
      fromLocationId, toLocationId, fuel, volume, transferDate, comment,
      createdBy: createdBy || managerName || "Гость",
    });
    const { error: err } = isEdit
      ? await supabase.from("stock_transfers").update(payload).eq("id", transfer.id)
      : await supabase.from("stock_transfers").insert([payload]);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onClose();
  };

  const remove = async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    setSaving(true);
    const { error: err } = await supabase.from("stock_transfers").delete().eq("id", transfer.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onClose();
  };

  return (
    <div className="ps-drawer__overlay" onClick={onClose}>
      <div className="ps-drawer__panel" style={{ width: "min(420px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="ps-drawer__head">
          <h2><ArrowLeftRight size={17} style={{ verticalAlign: -3, marginRight: 6 }} />{isEdit ? "Перемещение" : "Переместить топливо"}</h2>
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
            <span>Откуда</span>
            <select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
              {locations.length === 0 && <option value="">Нет точек — сначала добавьте склад/АЗС</option>}
              {locations.map((l) => <option key={l.id} value={l.id}>{l.type === "station" ? "АЗС" : "Склад"} · {l.name}</option>)}
            </select>
          </label>
          <label className="ps-field">
            <span>Куда</span>
            <select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
              {locations.length === 0 && <option value="">Нет точек — сначала добавьте склад/АЗС</option>}
              {locations.map((l) => <option key={l.id} value={l.id}>{l.type === "station" ? "АЗС" : "Склад"} · {l.name}</option>)}
            </select>
          </label>
          {sameLocation && <p style={{ color: "#C13B3B", fontSize: 12.5 }}>«Откуда» и «Куда» не могут совпадать.</p>}
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
            <span>Дата перемещения</span>
            <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
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
            disabled={!toNum(volume) || !fromLocationId || !toLocationId || sameLocation || saving} onClick={save}>
            {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Переместить"}
          </button>
        </div>
      </div>
    </div>
  );
}
