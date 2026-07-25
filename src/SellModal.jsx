import React, { useState, useMemo, useEffect } from "react";
import { X, ShoppingCart, Trash2, Plus } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { toNum, fmtInt, toDbSale } from "./utils.js";
import { FUELS, SuggestDropdown, SOURCES } from "./shared.jsx";

const PAYMENT_METHODS = ["Наличные", "Безналичный", "Карта"];
const CONTAINER_MODES = [
  { value: "", label: "Без тары / наливом" },
  { value: "own", label: "Своя тара клиента" },
  { value: "buy", label: "Купить тару" },
  { value: "rent", label: "Аренда тары (под залог)" },
];

const isoToday = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function SellModal({ clients, managerName, presetClientId, sale, prices, onCreateClient, onClose }) {
  const sortedClients = useMemo(() => [...clients].sort((a, b) => a.company.localeCompare(b.company, "ru")), [clients]);
  const [clientId, setClientId] = useState(sale?.clientId || presetClientId || (sortedClients[0]?.id ?? ""));
  const [newClientMode, setNewClientMode] = useState(false);
  const [newCompany, setNewCompany] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newSource, setNewSource] = useState("");
  const [suggestField, setSuggestField] = useState(null); // 'company' | 'contact' | 'phone' | null
  const [creatingClient, setCreatingClient] = useState(false);
  const [fuel, setFuel] = useState(sale?.fuel || FUELS[0]);
  const [price, setPrice] = useState(sale?.price ?? "");
  const [volume, setVolume] = useState(sale?.volume ?? "");
  const [saleDate, setSaleDate] = useState(sale?.saleDate || isoToday());
  const [paymentMethod, setPaymentMethod] = useState(sale?.paymentMethod || PAYMENT_METHODS[0]);
  const [comment, setComment] = useState(sale?.comment || "");
  const [containerMode, setContainerMode] = useState(sale?.containerMode || "");
  const [containerPrice, setContainerPrice] = useState(sale?.containerPrice ?? "");
  const [containerDeposit, setContainerDeposit] = useState(sale?.containerDeposit ?? "");
  const [containerQty, setContainerQty] = useState(sale?.containerQty || "1");
  const [shipped, setShipped] = useState(sale?.shipped || false);
  const [shippedDate, setShippedDate] = useState(sale?.shippedDate || "");
  const [agentFee, setAgentFee] = useState(sale?.agentFee ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const [autoPrice, setAutoPrice] = useState(sale ? toNum(sale.price) : null);
  useEffect(() => {
    const p = (prices || []).find((pr) => pr.fuel === fuel);
    if (!p) return;
    const auto = paymentMethod === "Наличные" ? p.priceCash : p.priceCashless;
    if (auto === "" || auto == null) return;
    if (price === "" || Number(price) === autoPrice) {
      setPrice(auto);
      setAutoPrice(toNum(auto));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fuel, paymentMethod, prices]);

  const qty = toNum(containerQty) || 1;
  const fuelSum = toNum(price) * toNum(volume);
  const containerSum = containerMode === "buy" || containerMode === "rent" ? toNum(containerPrice) * qty : 0;
  const depositSum = containerMode === "rent" ? toNum(containerDeposit) * qty : 0;
  const sum = fuelSum + containerSum;
  const isEdit = !!sale;

  const save = async () => {
    if (!clientId || !toNum(price) || !toNum(volume)) return;
    setSaving(true);
    setError("");
    const payload = toDbSale({
      clientId, fuel, price, volume, sum, saleDate, paymentMethod, comment,
      containerMode, containerPrice, containerDeposit,
      containerQty: containerMode === "buy" || containerMode === "rent" ? containerQty : "",
      shipped, shippedDate, agentFee,
      createdBy: sale?.createdBy || managerName || "Гость",
    });
    const { error: err } = isEdit
      ? await supabase.from("sales").update(payload).eq("id", sale.id)
      : await supabase.from("sales").insert([payload]);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onClose();
  };

  const suggestionsFor = (query) => {
    const q = (query || "").trim().toLowerCase();
    if (q.length < 2) return [];
    return clients.filter((c) => [c.company, c.contactName, c.phone].some((v) => (v || "").toLowerCase().includes(q))).slice(0, 6);
  };

  const cancelNewClient = () => {
    setNewClientMode(false);
    setNewCompany(""); setNewContact(""); setNewPhone(""); setNewSource(""); setSuggestField(null);
  };

  const pickExistingClient = (c) => {
    setClientId(c.id);
    cancelNewClient();
  };

  const createNewClient = async () => {
    if (!newCompany.trim() || !onCreateClient) return;
    setCreatingClient(true);
    const created = await onCreateClient({
      company: newCompany.trim(), contactName: newContact.trim(), phone: newPhone.trim(),
      source: newSource, inn: "", kpp: "", ogrn: "", legalAddress: "", bankDetails: "", comment: "",
      fileUrl: "", fileName: "", assignedTo: managerName || "",
    });
    setCreatingClient(false);
    if (created) {
      setClientId(created.id);
      cancelNewClient();
    }
  };

  const remove = async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    setSaving(true);
    const { error: err } = await supabase.from("sales").delete().eq("id", sale.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onClose();
  };

  return (
    <div className="ps-drawer__overlay" onClick={onClose}>
      <div className="ps-drawer__panel" style={{ width: "min(420px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="ps-drawer__head">
          <h2><ShoppingCart size={17} style={{ verticalAlign: -3, marginRight: 6 }} />{isEdit ? "Сделка" : "Оформить продажу"}</h2>
          <button className="ps-mini" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ps-drawer__body">
          <div className="ps-field">
            <div className="ps-field-head">
              <span>Клиент *</span>
              {!newClientMode && !(presetClientId && !isEdit) && (
                <button type="button" className="ps-link-btn" onClick={() => setNewClientMode(true)}>
                  <Plus size={12} /> Новый клиент
                </button>
              )}
            </div>
            {!newClientMode ? (
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!!presetClientId && !isEdit}>
                {sortedClients.length === 0 && <option value="">Нет клиентов — сначала добавьте карточку</option>}
                {sortedClients.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
              </select>
            ) : (
              <div className="ps-new-client">
                <div style={{ position: "relative" }}>
                  <input placeholder="Компания *" value={newCompany}
                    onChange={(e) => setNewCompany(e.target.value)}
                    onFocus={() => setSuggestField("company")} onBlur={() => setTimeout(() => setSuggestField((f) => (f === "company" ? null : f)), 150)} />
                  {suggestField === "company" && <SuggestDropdown items={suggestionsFor(newCompany)} onPick={pickExistingClient} />}
                </div>
                <div style={{ position: "relative" }}>
                  <input placeholder="Контактное лицо" value={newContact}
                    onChange={(e) => setNewContact(e.target.value)}
                    onFocus={() => setSuggestField("contact")} onBlur={() => setTimeout(() => setSuggestField((f) => (f === "contact" ? null : f)), 150)} />
                  {suggestField === "contact" && <SuggestDropdown items={suggestionsFor(newContact)} onPick={pickExistingClient} />}
                </div>
                <div style={{ position: "relative" }}>
                  <input placeholder="Телефон" value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    onFocus={() => setSuggestField("phone")} onBlur={() => setTimeout(() => setSuggestField((f) => (f === "phone" ? null : f)), 150)} />
                  {suggestField === "phone" && <SuggestDropdown items={suggestionsFor(newPhone)} onPick={pickExistingClient} />}
                </div>
                <select value={newSource} onChange={(e) => setNewSource(e.target.value)}>
                  <option value="">Источник — не указан</option>
                  {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <div className="ps-new-client__actions">
                  <button type="button" className="ps-btn" onClick={cancelNewClient}>Отмена</button>
                  <button type="button" className="ps-btn ps-btn--primary" style={{ width: "auto" }}
                    disabled={!newCompany.trim() || creatingClient} onClick={createNewClient}>
                    {creatingClient ? "Создание…" : "Создать и выбрать"}
                  </button>
                </div>
              </div>
            )}
          </div>
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
          <label className="ps-field">
            <span>Форма оплаты</span>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="ps-field">
            <span>Тара</span>
            <select value={containerMode} onChange={(e) => setContainerMode(e.target.value)}>
              {CONTAINER_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          {containerMode === "buy" && (
            <div className="ps-field-row">
              <label className="ps-field">
                <span>Цена за 1 шт, ₽</span>
                <input type="number" min="0" step="1" value={containerPrice} onChange={(e) => setContainerPrice(e.target.value)} placeholder="0" />
              </label>
              <label className="ps-field">
                <span>Количество, шт</span>
                <input type="number" min="1" step="1" value={containerQty} onChange={(e) => setContainerQty(e.target.value)} placeholder="1" />
              </label>
            </div>
          )}
          {containerMode === "rent" && (
            <>
              <div className="ps-field-row">
                <label className="ps-field">
                  <span>Цена аренды за 1 шт, ₽</span>
                  <input type="number" min="0" step="1" value={containerPrice} onChange={(e) => setContainerPrice(e.target.value)} placeholder="0" />
                </label>
                <label className="ps-field">
                  <span>Количество, шт</span>
                  <input type="number" min="1" step="1" value={containerQty} onChange={(e) => setContainerQty(e.target.value)} placeholder="1" />
                </label>
              </div>
              <label className="ps-field">
                <span>Залог за 1 шт, ₽</span>
                <input type="number" min="0" step="1" value={containerDeposit} onChange={(e) => setContainerDeposit(e.target.value)} placeholder="0" />
              </label>
            </>
          )}
          <label className="ps-field">
            <span>Агентское вознаграждение, ₽</span>
            <input type="number" min="0" step="1" value={agentFee} onChange={(e) => setAgentFee(e.target.value)} placeholder="0" />
          </label>
          <div className="ps-field">
            <span>Сумма</span>
            <div className="ps-sell-sum">{fmtInt(sum)} ₽</div>
            {containerSum > 0 && (
              <div className="ps-sell-sum__breakdown">топливо {fmtInt(fuelSum)} ₽ + тара {fmtInt(containerSum)} ₽ ({qty} шт)</div>
            )}
            {containerMode === "rent" && depositSum > 0 && (
              <div className="ps-sell-sum__breakdown">+ залог {fmtInt(depositSum)} ₽ ({qty} шт, не входит в выручку)</div>
            )}
            {toNum(agentFee) > 0 && (
              <div className="ps-sell-sum__breakdown">− агентское вознаграждение {fmtInt(toNum(agentFee))} ₽ (не входит в выручку)</div>
            )}
          </div>
          <label className="ps-field">
            <span>Дата продажи</span>
            <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
          </label>
          <label className="ps-check-field">
            <input type="checkbox" checked={shipped} onChange={(e) => {
              setShipped(e.target.checked);
              if (e.target.checked && !shippedDate) setShippedDate(isoToday());
            }} />
            <span>Отгружено</span>
          </label>
          {shipped && (
            <label className="ps-field">
              <span>Дата отгрузки</span>
              <input type="date" value={shippedDate} onChange={(e) => setShippedDate(e.target.value)} />
            </label>
          )}
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
            disabled={!clientId || !toNum(price) || !toNum(volume) || saving} onClick={save}>
            {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Оформить продажу"}
          </button>
        </div>
      </div>
    </div>
  );
}
