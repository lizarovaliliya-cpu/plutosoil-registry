import React, { useMemo, useState } from "react";
import { Gauge, Search, X, Plus, Trash2, Printer, Car, Fuel as FuelIcon } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { toNum, fmtInt, toDbVehicle, toDbFill } from "./utils.js";
import { FUELS, DENSITY, Cell } from "./shared.jsx";
import { printLimitFillInvoice } from "./limitFillInvoice.js";

const isoToday = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const shortDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

export default function FuelLimitsView({ clients, vehicles, fuelLimits, fills, prices, companyProfile, managerName, managers }) {
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [clientQuery, setClientQuery] = useState("");

  const [newPlate, setNewPlate] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newVehiclePhone, setNewVehiclePhone] = useState("");
  const [newNote, setNewNote] = useState("");
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [vehicleDeleteConfirm, setVehicleDeleteConfirm] = useState(null);

  const [fillFuel, setFillFuel] = useState(FUELS[0]);
  const [fillVolume, setFillVolume] = useState("");
  const [fillPrice, setFillPrice] = useState("");
  const [fillPlate, setFillPlate] = useState("");
  const [fillDriver, setFillDriver] = useState("");
  const [fillDate, setFillDate] = useState(isoToday());
  const [fillCreatedBy, setFillCreatedBy] = useState(managerName || "");
  const [fillComment, setFillComment] = useState("");
  const [savingFill, setSavingFill] = useState(false);
  const [fillError, setFillError] = useState("");
  const [selectedFills, setSelectedFills] = useState(() => new Set());
  const [fillDeleteConfirm, setFillDeleteConfirm] = useState(null);

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const densityFor = (fuel) => toNum((prices || []).find((p) => p.fuel === fuel)?.density) || DENSITY[fuel] || 0;
  const priceFor = (fuel) => toNum((prices || []).find((p) => p.fuel === fuel)?.priceCashless) || toNum((prices || []).find((p) => p.fuel === fuel)?.priceCash) || "";

  const limitClientIds = useMemo(() => [...new Set((fuelLimits || []).map((l) => l.clientId))], [fuelLimits]);
  const limitClients = useMemo(
    () => limitClientIds.map((id) => clientById.get(id)).filter(Boolean).sort((a, b) => a.company.localeCompare(b.company, "ru")),
    [limitClientIds, clientById]
  );

  const searchResults = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return clients.filter((c) => [c.company, c.contactName, c.phone].some((v) => (v || "").toLowerCase().includes(q))).slice(0, 8);
  }, [clientQuery, clients]);

  const selectedClient = selectedClientId ? clientById.get(selectedClientId) : null;
  const clientVehicles = useMemo(() => (vehicles || []).filter((v) => v.clientId === selectedClientId), [vehicles, selectedClientId]);
  const clientFills = useMemo(
    () => (fills || []).filter((f) => f.clientId === selectedClientId).sort((a, b) => (b.fillDate || "").localeCompare(a.fillDate || "") || b.createdAt - a.createdAt),
    [fills, selectedClientId]
  );

  const fuelStats = useMemo(() => {
    return FUELS.map((fuel) => {
      const limitRow = (fuelLimits || []).find((l) => l.clientId === selectedClientId && l.fuel === fuel);
      const limit = toNum(limitRow?.limitVolume);
      const consumed = clientFills.filter((f) => f.fuel === fuel).reduce((a, f) => a + toNum(f.volume), 0);
      return { fuel, limitId: limitRow?.id, limit, consumed, remaining: Math.max(0, limit - consumed) };
    });
  }, [fuelLimits, selectedClientId, clientFills]);

  const openClient = (id) => {
    setSelectedClientId(id);
    setClientQuery("");
    setSelectedFills(new Set());
    setFillDeleteConfirm(null);
    setVehicleDeleteConfirm(null);
    const firstOpen = FUELS.find((f) => {
      const l = (fuelLimits || []).find((x) => x.clientId === id && x.fuel === f);
      return !l || toNum(l.limitVolume) === 0;
    });
    setFillFuel(firstOpen || FUELS[0]);
    setFillVolume(""); setFillPlate(""); setFillDriver(""); setFillComment("");
    setFillPrice(priceFor(firstOpen || FUELS[0]));
  };

  const updateLimit = async (fuel, value) => {
    await supabase.from("fuel_limits").upsert(
      { client_id: selectedClientId, fuel, limit_volume: toNum(value), updated_by: managerName || "Гость" },
      { onConflict: "client_id,fuel" }
    );
  };

  const addVehicle = async () => {
    if (!newPlate.trim() || !selectedClientId) return;
    setSavingVehicle(true);
    const payload = toDbVehicle({ clientId: selectedClientId, plate: newPlate.trim(), model: newModel.trim(), phone: newVehiclePhone.trim(), note: newNote.trim(), createdBy: managerName || "Гость" });
    const { error } = await supabase.from("client_vehicles").insert([payload]);
    setSavingVehicle(false);
    if (!error) { setNewPlate(""); setNewModel(""); setNewVehiclePhone(""); setNewNote(""); }
  };

  const removeVehicle = async (v) => {
    if (vehicleDeleteConfirm !== v.id) { setVehicleDeleteConfirm(v.id); return; }
    await supabase.from("client_vehicles").delete().eq("id", v.id);
    setVehicleDeleteConfirm(null);
  };

  const plateSuggestions = useMemo(() => clientVehicles.map((v) => v.plate).filter(Boolean), [clientVehicles]);

  const handleFuelChange = (fuel) => {
    setFillFuel(fuel);
    setFillPrice(priceFor(fuel));
  };

  const addFill = async () => {
    if (!selectedClientId || !fillFuel || toNum(fillVolume) <= 0 || !fillPlate.trim()) return;
    setSavingFill(true);
    setFillError("");
    const matchedVehicle = clientVehicles.find((v) => v.plate.trim().toLowerCase() === fillPlate.trim().toLowerCase());
    const sum = toNum(fillVolume) * toNum(fillPrice);
    const payload = toDbFill({
      clientId: selectedClientId, vehicleId: matchedVehicle?.id || null, vehiclePlate: fillPlate.trim(),
      driver: fillDriver.trim(), fuel: fillFuel, volume: fillVolume, price: fillPrice, sum,
      fillDate, comment: fillComment.trim(), createdBy: fillCreatedBy || managerName || "Гость",
    });
    const { error } = await supabase.from("fuel_limit_fills").insert([payload]);
    setSavingFill(false);
    if (error) { setFillError(error.message); return; }
    setFillVolume(""); setFillPlate(""); setFillDriver(""); setFillComment("");
  };

  const removeFill = async (f) => {
    if (fillDeleteConfirm !== f.id) { setFillDeleteConfirm(f.id); return; }
    await supabase.from("fuel_limit_fills").delete().eq("id", f.id);
    setFillDeleteConfirm(null);
    setSelectedFills((prev) => { const n = new Set(prev); n.delete(f.id); return n; });
  };

  const toggleFillSelected = (id) => setSelectedFills((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllFills = () => setSelectedFills(new Set(clientFills.map((f) => f.id)));
  const clearFillSelection = () => setSelectedFills(new Set());

  const printOne = (f) => printLimitFillInvoice([f], selectedClient, companyProfile || {}, densityFor);
  const printSelected = () => {
    const list = clientFills.filter((f) => selectedFills.has(f.id)).sort((a, b) => (a.fillDate || "").localeCompare(b.fillDate || ""));
    if (list.length === 0) return;
    printLimitFillInvoice(list, selectedClient, companyProfile || {}, densityFor);
  };

  const remainingForFuel = fuelStats.find((f) => f.fuel === fillFuel)?.remaining || 0;

  return (
    <div className="ps-limits">
      <div className="ps-limits__side">
        <div className="ps-search" style={{ margin: "0 0 10px" }}>
          <Search size={15} />
          <input placeholder="Найти клиента и добавить лимит…" value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} />
          {clientQuery && <X size={14} className="ps-search__clear" onClick={() => setClientQuery("")} />}
        </div>
        {searchResults.length > 0 && (
          <div className="ps-limits__searchresults">
            {searchResults.map((c) => (
              <button key={c.id} type="button" className="ps-limits__client-row" onClick={() => openClient(c.id)}>
                <span>{c.company}</span>
                <span className="ps-limits__client-meta">{c.phone || "—"}</span>
              </button>
            ))}
          </div>
        )}
        <div className="ps-report-builder__group-title" style={{ margin: "6px 0" }}>Клиенты с лимитами</div>
        {limitClients.length === 0 ? (
          <div className="ps-empty" style={{ padding: "18px 0" }}>Пока никому не выставлен лимит.</div>
        ) : (
          <div className="ps-limits__list">
            {limitClients.map((c) => {
              const rows = (fuelLimits || []).filter((l) => l.clientId === c.id);
              const totalRemaining = rows.reduce((a, l) => {
                const consumed = (fills || []).filter((f) => f.clientId === c.id && f.fuel === l.fuel).reduce((s, f) => s + toNum(f.volume), 0);
                return a + Math.max(0, toNum(l.limitVolume) - consumed);
              }, 0);
              return (
                <button key={c.id} type="button" className={`ps-limits__client-row ${selectedClientId === c.id ? "ps-limits__client-row--on" : ""}`} onClick={() => openClient(c.id)}>
                  <span>{c.company}</span>
                  <span className="ps-limits__client-meta">остаток {fmtInt(totalRemaining)} л</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="ps-limits__main">
        {!selectedClient ? (
          <div className="ps-empty" style={{ padding: "60px 0" }}>
            <Gauge size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
            Выберите клиента слева или найдите через поиск, чтобы выставить лимит.
          </div>
        ) : (
          <>
            <div className="ps-sell-section">
              <div className="ps-sell-section__title">
                <span className="ps-sell-section__title-label"><Gauge size={13} /> Лимиты — {selectedClient.company}</span>
              </div>
              <div className="ps-limits__gauges">
                {fuelStats.map((f) => {
                  const pct = f.limit > 0 ? Math.min(100, (f.consumed / f.limit) * 100) : 0;
                  return (
                    <div key={f.fuel} className="ps-gauge">
                      <div className="ps-gauge__top"><span className="ps-gauge__fuel">{f.fuel}</span><span className="ps-gauge__pct">{pct.toFixed(0)}%</span></div>
                      <div className="ps-gauge__track"><div className="ps-gauge__fill" style={{ width: `${pct}%` }} /></div>
                      <div className="ps-gauge__nums"><span><b>{fmtInt(f.consumed)}</b> л отпущено</span><span className="ps-gauge__need">остаток {fmtInt(f.remaining)} л</span></div>
                      <label className="ps-field" style={{ marginTop: 6 }}>
                        <span>Лимит, л</span>
                        <Cell value={f.limit || ""} onCommit={(v) => updateLimit(f.fuel, v)} type="number" placeholder="0" />
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="ps-sell-section">
              <div className="ps-sell-section__title">
                <span className="ps-sell-section__title-label"><Car size={13} /> Автомобили клиента</span>
              </div>
              {clientVehicles.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {clientVehicles.map((v) => (
                    <div key={v.id} className="ps-shipment-row" style={{ gridTemplateColumns: "1fr 1.3fr 1fr 1.3fr auto" }}>
                      <span><b>{v.plate}</b></span>
                      <span>{v.model || "—"}</span>
                      <span>{v.phone || "—"}</span>
                      <span style={{ color: "#8A94A0" }}>{v.note || ""}</span>
                      <button type="button" className={`ps-mini ${vehicleDeleteConfirm === v.id ? "ps-del--confirm" : ""}`} onClick={() => removeVehicle(v)} title="Удалить">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="ps-sell-section__grid">
                <label className="ps-field">
                  <span>Гос. номер *</span>
                  <input value={newPlate} onChange={(e) => setNewPlate(e.target.value)} placeholder="А123БВ 82" />
                </label>
                <label className="ps-field">
                  <span>Марка / модель</span>
                  <input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="Необязательно" />
                </label>
                <label className="ps-field">
                  <span>Телефон водителя</span>
                  <input value={newVehiclePhone} onChange={(e) => setNewVehiclePhone(e.target.value)} placeholder="Необязательно" />
                </label>
                <label className="ps-field">
                  <span>Примечание</span>
                  <input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Необязательно" />
                </label>
              </div>
              <button type="button" className="ps-btn" style={{ width: "auto", alignSelf: "flex-start" }} disabled={!newPlate.trim() || savingVehicle} onClick={addVehicle}>
                <Plus size={14} /> Добавить машину
              </button>
            </div>

            <div className="ps-sell-section">
              <div className="ps-sell-section__title">
                <span className="ps-sell-section__title-label"><FuelIcon size={13} /> Заправка</span>
              </div>
              <div className="ps-sell-section__grid">
                <label className="ps-field">
                  <span>Вид топлива</span>
                  <select value={fillFuel} onChange={(e) => handleFuelChange(e.target.value)}>
                    {FUELS.map((f) => <option key={f} value={f}>{f} (остаток {fmtInt(fuelStats.find((x) => x.fuel === f)?.remaining || 0)} л)</option>)}
                  </select>
                </label>
                <label className="ps-field">
                  <span>Объём, л *</span>
                  <input type="number" min="0" step="1" value={fillVolume} onChange={(e) => setFillVolume(e.target.value)}
                    placeholder={remainingForFuel > 0 ? String(Math.round(remainingForFuel)) : "0"} />
                </label>
                <label className="ps-field">
                  <span>Гос. номер машины *</span>
                  <input list="ps-limit-plate-suggest" value={fillPlate} onChange={(e) => setFillPlate(e.target.value)} placeholder="А123БВ 82" />
                  <datalist id="ps-limit-plate-suggest">
                    {plateSuggestions.map((p) => <option key={p} value={p} />)}
                  </datalist>
                </label>
                <label className="ps-field">
                  <span>Водитель</span>
                  <input value={fillDriver} onChange={(e) => setFillDriver(e.target.value)} placeholder="Необязательно" />
                </label>
                <label className="ps-field">
                  <span>Цена, ₽/л</span>
                  <input type="number" min="0" step="0.01" value={fillPrice} onChange={(e) => setFillPrice(e.target.value)} placeholder="0" />
                </label>
                <label className="ps-field">
                  <span>Дата</span>
                  <input type="date" value={fillDate} onChange={(e) => setFillDate(e.target.value)} />
                </label>
                <label className="ps-field">
                  <span>Ответственный</span>
                  <select value={fillCreatedBy} onChange={(e) => setFillCreatedBy(e.target.value)}>
                    <option value="">Не указан</option>
                    {fillCreatedBy && !(managers || []).includes(fillCreatedBy) && <option value={fillCreatedBy}>{fillCreatedBy}</option>}
                    {(managers || []).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className="ps-field">
                  <span>Комментарий</span>
                  <input value={fillComment} onChange={(e) => setFillComment(e.target.value)} placeholder="Необязательно" />
                </label>
              </div>
              {toNum(fillVolume) > 0 && toNum(fillPrice) > 0 && (
                <div style={{ fontSize: 12.5, color: "#5B6770" }}>Сумма: <b>{fmtInt(toNum(fillVolume) * toNum(fillPrice))} ₽</b></div>
              )}
              {fillError && <p style={{ color: "#C13B3B", fontSize: 12.5 }}>{fillError}</p>}
              <button type="button" className="ps-btn ps-btn--primary" style={{ width: "auto", alignSelf: "flex-start" }}
                disabled={!fillFuel || toNum(fillVolume) <= 0 || !fillPlate.trim() || savingFill} onClick={addFill}>
                <Plus size={14} /> {savingFill ? "Сохранение…" : "Записать заправку"}
              </button>
            </div>

            <div className="ps-sell-section">
              <div className="ps-sell-section__title">
                <span className="ps-sell-section__title-label">История заправок ({clientFills.length})</span>
                {clientFills.length > 0 && (
                  <div style={{ display: "flex", gap: 10 }}>
                    <button type="button" className="ps-link-btn" onClick={selectAllFills}>Выбрать все</button>
                    <button type="button" className="ps-link-btn" onClick={clearFillSelection}>Снять выбор</button>
                  </div>
                )}
              </div>
              {clientFills.length === 0 ? (
                <div className="ps-empty" style={{ padding: "14px 0" }}>Заправок пока не было.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {clientFills.map((f) => (
                    <div key={f.id} className="ps-shipment-row">
                      <input type="checkbox" checked={selectedFills.has(f.id)} onChange={() => toggleFillSelected(f.id)} />
                      <span>{shortDate(f.fillDate)}</span>
                      <span><b>{f.vehiclePlate || "—"}</b>{f.driver ? <span style={{ color: "#8A94A0" }}> · {f.driver}</span> : ""}</span>
                      <span>{f.fuel}</span>
                      <span>{fmtInt(toNum(f.volume))} л · {fmtInt(toNum(f.sum))} ₽</span>
                      <button type="button" className="ps-mini" title="Печать накладной" onClick={() => printOne(f)}><Printer size={13} /></button>
                      <button type="button" className={`ps-mini ${fillDeleteConfirm === f.id ? "ps-del--confirm" : ""}`} onClick={() => removeFill(f)} title="Удалить">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {clientFills.length > 0 && (
                <button type="button" className="ps-btn" style={{ width: "auto", alignSelf: "flex-start" }} disabled={selectedFills.size === 0} onClick={printSelected}>
                  <Printer size={14} /> Накладная на выбранные ({selectedFills.size})
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
