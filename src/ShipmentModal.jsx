import React, { useMemo, useState } from "react";
import { X, Truck, Plus, Trash2, Printer } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { toNum, fmtInt, toDbShipment } from "./utils.js";
import { DENSITY } from "./shared.jsx";
import { printShipmentInvoice } from "./shipmentInvoice.js";

const isoToday = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const shortDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso || "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

export default function ShipmentModal({ group, clients, shipments, managerName, managers, companyProfile, prices, onClose }) {
  const client = clients.find((c) => c.id === group.clientId);

  const groupShipments = useMemo(
    () => (shipments || [])
      .filter((s) => s.groupId === group.id)
      .sort((a, b) => (b.shipDate || "").localeCompare(a.shipDate || "") || b.createdAt - a.createdAt),
    [shipments, group.id]
  );

  const fuelStats = useMemo(() => {
    const map = new Map();
    (group.items || []).forEach((it) => {
      const cur = map.get(it.fuel) || { fuel: it.fuel, total: 0, shipped: 0 };
      cur.total += toNum(it.volume);
      map.set(it.fuel, cur);
    });
    groupShipments.forEach((s) => {
      const cur = map.get(s.fuel);
      if (!cur) return;
      cur.shipped += toNum(s.volume);
    });
    // Сделка, отмеченная отгруженной старым способом (чекбоксом, без учёта
    // по машинам) — считаем полностью закрытой, а не "0% отгружено".
    if (groupShipments.length === 0 && group.shipped) {
      map.forEach((f) => { f.shipped = f.total; });
    }
    return [...map.values()].map((f) => ({ ...f, remaining: Math.max(0, f.total - f.shipped) }));
  }, [group.items, groupShipments, group.shipped]);

  const fullyShipped = fuelStats.length > 0 && fuelStats.every((f) => f.remaining <= 0.001);

  const plateSuggestions = useMemo(
    () => [...new Set(groupShipments.map((s) => s.vehiclePlate).filter(Boolean))],
    [groupShipments]
  );

  const firstOpenFuel = fuelStats.find((f) => f.remaining > 0)?.fuel || fuelStats[0]?.fuel || "";
  const [fuel, setFuel] = useState(firstOpenFuel);
  const [volume, setVolume] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [driver, setDriver] = useState("");
  const [shipDate, setShipDate] = useState(isoToday());
  const [comment, setComment] = useState("");
  const [createdBy, setCreatedBy] = useState(managerName || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const remainingForFuel = fuelStats.find((f) => f.fuel === fuel)?.remaining || 0;

  const syncGroupShipped = async (nextShipments) => {
    const remainingMap = new Map();
    (group.items || []).forEach((it) => remainingMap.set(it.fuel, (remainingMap.get(it.fuel) || 0) + toNum(it.volume)));
    nextShipments.forEach((s) => remainingMap.set(s.fuel, (remainingMap.get(s.fuel) || 0) - toNum(s.volume)));
    const nowFullyShipped = remainingMap.size > 0 && [...remainingMap.values()].every((v) => v <= 0.001);
    const lastDate = [...nextShipments].sort((a, b) => (a.shipDate || "").localeCompare(b.shipDate || "")).pop()?.shipDate || null;
    if (nowFullyShipped !== !!group.shipped) {
      await supabase.from("sale_groups").update({
        shipped: nowFullyShipped,
        shipped_date: nowFullyShipped ? lastDate : null,
      }).eq("id", group.id);
    }
  };

  const addShipment = async () => {
    if (!fuel || toNum(volume) <= 0 || !vehiclePlate.trim()) return;
    setSaving(true);
    setError("");
    const payload = toDbShipment({
      groupId: group.id, fuel, volume, vehiclePlate: vehiclePlate.trim(), driver: driver.trim(),
      shipDate, comment: comment.trim(), createdBy: createdBy || managerName || "Гость",
    });
    const { data, error: err } = await supabase.from("sale_shipments").insert([payload]).select().single();
    if (err || !data) { setSaving(false); setError(err?.message || "Не удалось сохранить отгрузку"); return; }
    const created = {
      id: data.id, groupId: data.group_id, fuel: data.fuel, volume: data.volume,
      vehiclePlate: data.vehicle_plate, driver: data.driver, shipDate: data.ship_date,
      comment: data.comment, createdBy: data.created_by, createdAt: Date.now(),
    };
    await syncGroupShipped([...groupShipments, created]);
    setSaving(false);
    setVolume(""); setVehiclePlate(""); setDriver(""); setComment("");
  };

  const removeShipment = async (s) => {
    if (deleteConfirmId !== s.id) { setDeleteConfirmId(s.id); return; }
    setSaving(true);
    const { error: err } = await supabase.from("sale_shipments").delete().eq("id", s.id);
    setDeleteConfirmId(null);
    if (err) { setSaving(false); setError(err.message); return; }
    await syncGroupShipped(groupShipments.filter((x) => x.id !== s.id));
    setSaving(false);
    setSelected((prev) => { const n = new Set(prev); n.delete(s.id); return n; });
  };

  const toggleSelected = (id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAll = () => setSelected(new Set(groupShipments.map((s) => s.id)));
  const clearSelected = () => setSelected(new Set());

  const densityFor = (f) => toNum((prices || []).find((p) => p.fuel === f)?.density) || DENSITY[f] || 0;
  const invoiceGroup = { id: group.id, saleDate: group.saleDate, items: (group.items || []).map((it) => ({ ...it, density: densityFor(it.fuel) })) };

  const printOne = (s) => printShipmentInvoice([s], invoiceGroup, client, companyProfile || {});
  const printSelected = () => {
    const list = groupShipments.filter((s) => selected.has(s.id)).sort((a, b) => (a.shipDate || "").localeCompare(b.shipDate || ""));
    if (list.length === 0) return;
    printShipmentInvoice(list, invoiceGroup, client, companyProfile || {});
  };

  return (
    <div className="ps-drawer__overlay" onClick={onClose}>
      <div className="ps-drawer__panel" style={{ width: "min(760px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="ps-drawer__head">
          <h2><Truck size={17} style={{ verticalAlign: -3, marginRight: 6 }} />Отгрузка — {group.clientName || client?.company || "Клиент"}</h2>
          <button className="ps-mini" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ps-drawer__body">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {fuelStats.map((f) => {
              const pct = f.total > 0 ? Math.min(100, (f.shipped / f.total) * 100) : 0;
              return (
                <div key={f.fuel} className="ps-gauge" style={{ flex: "1 1 200px" }}>
                  <div className="ps-gauge__top"><span className="ps-gauge__fuel">{f.fuel}</span><span className="ps-gauge__pct">{pct.toFixed(0)}%</span></div>
                  <div className="ps-gauge__track"><div className="ps-gauge__fill" style={{ width: `${pct}%` }} /></div>
                  <div className="ps-gauge__nums"><span><b>{fmtInt(f.shipped)}</b> из {fmtInt(f.total)} л</span></div>
                  <div className="ps-gauge__meta">остаток {fmtInt(f.remaining)} л</div>
                </div>
              );
            })}
          </div>

          <div className="ps-fieldset">
            <div className="ps-field-head"><span style={{ fontWeight: 600, color: "var(--petrol)" }}>Новая отгрузка</span></div>
            <div className="ps-field-row">
              <label className="ps-field">
                <span>Вид топлива</span>
                <select value={fuel} onChange={(e) => setFuel(e.target.value)}>
                  {fuelStats.map((f) => <option key={f.fuel} value={f.fuel}>{f.fuel} (остаток {fmtInt(f.remaining)} л)</option>)}
                </select>
              </label>
              <label className="ps-field">
                <span>Объём, л *</span>
                <input type="number" min="0" step="1" value={volume} onChange={(e) => setVolume(e.target.value)}
                  placeholder={remainingForFuel > 0 ? String(Math.round(remainingForFuel)) : "0"} />
              </label>
            </div>
            <div className="ps-field-row">
              <label className="ps-field">
                <span>Гос. номер машины *</span>
                <input list="ps-plate-suggest" value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} placeholder="А123БВ 82" />
                <datalist id="ps-plate-suggest">
                  {plateSuggestions.map((p) => <option key={p} value={p} />)}
                </datalist>
              </label>
              <label className="ps-field">
                <span>Водитель</span>
                <input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="Необязательно" />
              </label>
            </div>
            <div className="ps-field-row">
              <label className="ps-field">
                <span>Дата отгрузки</span>
                <input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
              </label>
              <label className="ps-field">
                <span>Ответственный</span>
                <select value={createdBy} onChange={(e) => setCreatedBy(e.target.value)}>
                  <option value="">Не указан</option>
                  {createdBy && !(managers || []).includes(createdBy) && <option value={createdBy}>{createdBy}</option>}
                  {(managers || []).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </div>
            <label className="ps-field">
              <span>Комментарий</span>
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Необязательно" />
            </label>
            {error && <p style={{ color: "#C13B3B", fontSize: 12.5 }}>{error}</p>}
            <button type="button" className="ps-btn ps-btn--primary" style={{ width: "auto", alignSelf: "flex-start" }}
              disabled={!fuel || toNum(volume) <= 0 || !vehiclePlate.trim() || saving} onClick={addShipment}>
              <Plus size={14} /> {saving ? "Сохранение…" : "Добавить отгрузку"}
            </button>
          </div>

          <div>
            <div className="ps-field-head">
              <span style={{ fontWeight: 600, color: "var(--petrol)" }}>История отгрузок ({groupShipments.length})</span>
              {groupShipments.length > 0 && (
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className="ps-link-btn" onClick={selectAll}>Выбрать все</button>
                  <button type="button" className="ps-link-btn" onClick={clearSelected}>Снять выбор</button>
                </div>
              )}
            </div>
            {groupShipments.length === 0 ? (
              <div className="ps-empty" style={{ padding: "14px 0" }}>Отгрузок пока не было.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {groupShipments.map((s) => (
                  <div key={s.id} className="ps-shipment-row">
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelected(s.id)} />
                    <span>{shortDate(s.shipDate)}</span>
                    <span><b>{s.vehiclePlate || "—"}</b>{s.driver ? <span style={{ color: "#8A94A0" }}> · {s.driver}</span> : ""}</span>
                    <span>{s.fuel}</span>
                    <span>{fmtInt(toNum(s.volume))} л</span>
                    <button type="button" className="ps-mini" title="Печать накладной" onClick={() => printOne(s)}><Printer size={13} /></button>
                    <button type="button" className={`ps-mini ${deleteConfirmId === s.id ? "ps-del--confirm" : ""}`} onClick={() => removeShipment(s)} title="Удалить">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="ps-drawer__foot">
          {fullyShipped && <span className="ps-ship-badge ps-ship-badge--done">Отгружено полностью</span>}
          <div className="ps-toolbar__spacer" />
          <button type="button" className="ps-btn" disabled={selected.size === 0} onClick={printSelected}>
            <Printer size={14} /> Накладная на выбранные ({selected.size})
          </button>
          <button type="button" className="ps-btn" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
