import React, { useState, useMemo, useEffect, useRef } from "react";
import { X, ShoppingCart, Trash2, Plus, Printer } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { toNum, fmtInt, toDbSale, toDbSaleGroup, genId } from "./utils.js";
import { FUELS, DENSITY, SuggestDropdown, SOURCES } from "./shared.jsx";
import { printInvoice } from "./invoice.js";

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

const emptyLine = (fuel, locationId) => ({
  key: genId(), id: null, fuel: fuel || FUELS[0], price: "", volume: "",
  containerMode: "", containerPrice: "", containerDeposit: "", containerQty: "1",
  locationId: locationId || "",
});

const lineSum = (l) => {
  const qty = toNum(l.containerQty) || 1;
  const fuelSum = toNum(l.price) * toNum(l.volume);
  const containerSum = l.containerMode === "buy" || l.containerMode === "rent" ? toNum(l.containerPrice) * qty : 0;
  return fuelSum + containerSum;
};

function FuelLineRow({ line, paymentMethod, prices, locations, onChange, onRemove, canRemove }) {
  // Автоподстановка цены — только для новой, ещё не сохранённой позиции
  // с ещё не тронутой вручную ценой. У уже сохранённых сделок цена могла
  // быть зафиксирована по другой (динамической) цене на момент продажи —
  // её нельзя тихо перезаписывать текущей ценой из блока "Цены".
  const priceTouchedRef = useRef(!!line.id || line.price !== "");
  useEffect(() => {
    if (priceTouchedRef.current) return;
    const p = (prices || []).find((pr) => pr.fuel === line.fuel);
    if (!p) return;
    const auto = paymentMethod === "Наличные" ? p.priceCash : p.priceCashless;
    if (auto === "" || auto == null) return;
    onChange({ price: auto });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.fuel, paymentMethod, prices]);

  const handlePriceChange = (v) => {
    priceTouchedRef.current = true;
    onChange({ price: v });
  };

  const density = toNum((prices || []).find((pr) => pr.fuel === line.fuel)?.density) || DENSITY[line.fuel] || 0;
  const tonnesValue = density > 0 && line.volume !== "" ? +(toNum(line.volume) * density / 1000).toFixed(3) : "";
  const pricePerTonne = density > 0 && toNum(line.price) > 0 ? (toNum(line.price) * 1000) / density : null;
  const handleVolumeTonnesChange = (v) => {
    if (v === "" || density <= 0) { onChange({ volume: "" }); return; }
    onChange({ volume: +(toNum(v) * 1000 / density).toFixed(2) });
  };

  const qty = toNum(line.containerQty) || 1;
  const fuelSum = toNum(line.price) * toNum(line.volume);
  const containerSum = line.containerMode === "buy" || line.containerMode === "rent" ? toNum(line.containerPrice) * qty : 0;
  const depositSum = line.containerMode === "rent" ? toNum(line.containerDeposit) * qty : 0;
  const sum = fuelSum + containerSum;

  return (
    <div className="ps-fieldset" style={{ position: "relative" }}>
      {canRemove && (
        <button type="button" className="ps-mini" style={{ position: "absolute", top: 12, right: 12 }} onClick={onRemove} title="Убрать позицию">
          <Trash2 size={13} />
        </button>
      )}
      <label className="ps-field">
        <span>Вид топлива</span>
        <select value={line.fuel} onChange={(e) => onChange({ fuel: e.target.value })}>
          {FUELS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      <label className="ps-field">
        <span>Склад/АЗС отпуска *</span>
        <select value={line.locationId} onChange={(e) => onChange({ locationId: e.target.value })}>
          <option value="">— выберите —</option>
          {(locations || []).map((l) => <option key={l.id} value={l.id}>{l.type === "station" ? "АЗС" : "Склад"} · {l.name}</option>)}
        </select>
      </label>
      <label className="ps-field">
        <span>Цена за литр, ₽ *</span>
        <input type="number" min="0" step="0.01" value={line.price} onChange={(e) => handlePriceChange(e.target.value)} placeholder="0" />
        {pricePerTonne != null && <div className="ps-sell-sum__breakdown">≈ {fmtInt(pricePerTonne)} ₽/т</div>}
      </label>
      <div className="ps-field-row">
        <label className="ps-field">
          <span>Объём, л *</span>
          <input type="number" min="0" step="1" value={line.volume} onChange={(e) => onChange({ volume: e.target.value })} placeholder="0" />
        </label>
        <label className="ps-field">
          <span>≈ Объём, т</span>
          <input type="number" min="0" step="0.001" value={tonnesValue} onChange={(e) => handleVolumeTonnesChange(e.target.value)}
            placeholder={density > 0 ? "0" : "коэффициент не задан"} disabled={density <= 0} />
        </label>
      </div>
      <label className="ps-field">
        <span>Тара</span>
        <select value={line.containerMode} onChange={(e) => onChange({ containerMode: e.target.value })}>
          {CONTAINER_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>
      {line.containerMode === "buy" && (
        <div className="ps-field-row">
          <label className="ps-field">
            <span>Цена за 1 шт, ₽</span>
            <input type="number" min="0" step="1" value={line.containerPrice} onChange={(e) => onChange({ containerPrice: e.target.value })} placeholder="0" />
          </label>
          <label className="ps-field">
            <span>Количество, шт</span>
            <input type="number" min="1" step="1" value={line.containerQty} onChange={(e) => onChange({ containerQty: e.target.value })} placeholder="1" />
          </label>
        </div>
      )}
      {line.containerMode === "rent" && (
        <>
          <div className="ps-field-row">
            <label className="ps-field">
              <span>Цена аренды за 1 шт, ₽</span>
              <input type="number" min="0" step="1" value={line.containerPrice} onChange={(e) => onChange({ containerPrice: e.target.value })} placeholder="0" />
            </label>
            <label className="ps-field">
              <span>Количество, шт</span>
              <input type="number" min="1" step="1" value={line.containerQty} onChange={(e) => onChange({ containerQty: e.target.value })} placeholder="1" />
            </label>
          </div>
          <label className="ps-field">
            <span>Залог за 1 шт, ₽</span>
            <input type="number" min="0" step="1" value={line.containerDeposit} onChange={(e) => onChange({ containerDeposit: e.target.value })} placeholder="0" />
          </label>
        </>
      )}
      <div className="ps-field">
        <span>Сумма позиции</span>
        <div className="ps-sell-sum" style={{ fontSize: 16, padding: "2px 0" }}>{fmtInt(sum)} ₽</div>
        {containerSum > 0 && (
          <div className="ps-sell-sum__breakdown">топливо {fmtInt(fuelSum)} ₽ + тара {fmtInt(containerSum)} ₽ ({qty} шт)</div>
        )}
        {line.containerMode === "rent" && depositSum > 0 && (
          <div className="ps-sell-sum__breakdown">+ залог {fmtInt(depositSum)} ₽ ({qty} шт, не входит в выручку)</div>
        )}
      </div>
    </div>
  );
}

export default function SellModal({ clients, managerName, managers, presetClientId, group, prices, companyProfile, locations, onCreateClient, onClose }) {
  const isEdit = !!group;
  const sortedClients = useMemo(() => [...clients].sort((a, b) => a.company.localeCompare(b.company, "ru")), [clients]);
  const [clientId, setClientId] = useState(group?.clientId || presetClientId || (sortedClients[0]?.id ?? ""));
  const [createdBy, setCreatedBy] = useState(group?.createdBy || managerName || "");
  const [newClientMode, setNewClientMode] = useState(false);
  const [newCompany, setNewCompany] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newSource, setNewSource] = useState("");
  const [suggestField, setSuggestField] = useState(null); // 'company' | 'contact' | 'phone' | null
  const [creatingClient, setCreatingClient] = useState(false);
  const [lines, setLines] = useState(() =>
    group?.items?.length
      ? group.items.map((it) => ({
          key: it.id, id: it.id, fuel: it.fuel, price: it.price, volume: it.volume,
          containerMode: it.containerMode, containerPrice: it.containerPrice,
          containerDeposit: it.containerDeposit, containerQty: it.containerQty || "1",
          locationId: it.locationId || "",
        }))
      : [emptyLine(FUELS[0], locations?.[0]?.id)]
  );
  const [saleDate, setSaleDate] = useState(group?.saleDate || isoToday());
  const [paymentMethod, setPaymentMethod] = useState(group?.paymentMethod || PAYMENT_METHODS[0]);
  const [comment, setComment] = useState(group?.comment || "");
  const [shipped, setShipped] = useState(group?.shipped || false);
  const [shippedDate, setShippedDate] = useState(group?.shippedDate || "");
  const [paid, setPaid] = useState(group?.paid || false);
  const [paidDate, setPaidDate] = useState(group?.paidDate || "");
  const [agentFee, setAgentFee] = useState(group?.agentFee ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const updateLine = (key, patch) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    const usedFuels = new Set(lines.map((l) => l.fuel));
    const nextFuel = FUELS.find((f) => !usedFuels.has(f)) || FUELS[0];
    const lastLocationId = lines[lines.length - 1]?.locationId || locations?.[0]?.id || "";
    setLines((prev) => [...prev, emptyLine(nextFuel, lastLocationId)]);
  };
  const removeLine = (key) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));

  const totalSum = lines.reduce((a, l) => a + lineSum(l), 0);
  const depositTotal = lines.reduce((a, l) => a + (l.containerMode === "rent" ? toNum(l.containerDeposit) * (toNum(l.containerQty) || 1) : 0), 0);
  // Склад/АЗС обязателен только для новых позиций — у старых сделок
  // (созданных до появления складов) он мог быть не указан, и это не
  // должно блокировать сохранение остальных изменений в такой сделке.
  // Цена может быть 0 — это нужно для безвозмездной передачи товара
  // (клиенту не выставляют счёт, но объём фиксируется и списывается со склада).
  const linesValid = lines.every((l) => l.price !== "" && toNum(l.price) >= 0 && toNum(l.volume) > 0 && (l.id || l.locationId));

  const save = async () => {
    if (!clientId || !linesValid) return;
    setSaving(true);
    setError("");

    const groupPayload = toDbSaleGroup({
      clientId, saleDate, paymentMethod, comment, shipped, shippedDate, paid, paidDate, agentFee,
      createdBy: createdBy || managerName || "Гость",
    });

    let groupId = group?.id;
    if (isEdit) {
      const { error: err } = await supabase.from("sale_groups").update(groupPayload).eq("id", group.id);
      if (err) { setSaving(false); setError(err.message); return; }
    } else {
      const { data, error: err } = await supabase.from("sale_groups").insert([groupPayload]).select().single();
      if (err || !data) { setSaving(false); setError(err?.message || "Не удалось создать сделку"); return; }
      groupId = data.id;
    }

    const originalIds = new Set((group?.items || []).map((it) => it.id));
    const currentIds = new Set(lines.filter((l) => l.id).map((l) => l.id));
    const toDelete = [...originalIds].filter((id) => !currentIds.has(id));

    if (toDelete.length) {
      const { error: err } = await supabase.from("sales").delete().in("id", toDelete);
      if (err) { setSaving(false); setError(err.message); return; }
    }
    for (const l of lines.filter((l) => l.id)) {
      const { error: err } = await supabase.from("sales").update(toDbSale({ ...l, groupId, sum: lineSum(l) })).eq("id", l.id);
      if (err) { setSaving(false); setError(err.message); return; }
    }
    const newLines = lines.filter((l) => !l.id);
    if (newLines.length) {
      const { error: err } = await supabase.from("sales").insert(newLines.map((l) => toDbSale({ ...l, groupId, sum: lineSum(l) })));
      if (err) { setSaving(false); setError(err.message); return; }
    }

    setSaving(false);
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
      fileUrl: "", fileName: "", assignedTo: createdBy || managerName || "",
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
    const { error: err } = await supabase.from("sale_groups").delete().eq("id", group.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onClose();
  };

  const handlePrint = () => {
    const client = clients.find((c) => c.id === clientId);
    const usedLocationIds = new Set(lines.map((l) => l.locationId).filter(Boolean));
    const location = usedLocationIds.size === 1
      ? (locations || []).find((loc) => loc.id === [...usedLocationIds][0]) || null
      : null;
    printInvoice(
      {
        id: group?.id, saleDate, paymentMethod, paid, paidDate, location,
        items: lines.map((l) => ({
          ...l, sum: lineSum(l),
          density: toNum((prices || []).find((pr) => pr.fuel === l.fuel)?.density) || DENSITY[l.fuel] || 0,
        })),
      },
      client, companyProfile || {}
    );
  };

  return (
    <div className="ps-modal__overlay" onClick={onClose}>
      <div className="ps-modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="ps-drawer__head">
          <h2><ShoppingCart size={17} style={{ verticalAlign: -3, marginRight: 6 }} />{isEdit ? "Сделка" : "Оформить продажу"}</h2>
          <button className="ps-mini" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ps-drawer__body">
          <div className="ps-field ps-field-full">
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
            <span>Менеджер</span>
            <select value={createdBy} onChange={(e) => setCreatedBy(e.target.value)}>
              <option value="">Не указан</option>
              {createdBy && !(managers || []).includes(createdBy) && <option value={createdBy}>{createdBy}</option>}
              {(managers || []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="ps-field">
            <span>Форма оплаты</span>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>

          <div className="ps-field-head" style={{ marginTop: 4 }}>
            <span style={{ fontWeight: 600, color: "var(--petrol)" }}>Позиции топлива</span>
            <button type="button" className="ps-link-btn" onClick={addLine}><Plus size={12} /> Добавить топливо</button>
          </div>
          {lines.map((l) => (
            <FuelLineRow
              key={l.key} line={l} paymentMethod={paymentMethod} prices={prices} locations={locations}
              onChange={(patch) => updateLine(l.key, patch)}
              onRemove={() => removeLine(l.key)}
              canRemove={lines.length > 1}
            />
          ))}

          <div className="ps-field ps-field-full">
            <span>Итого по сделке</span>
            <div className="ps-sell-sum">{fmtInt(totalSum)} ₽</div>
            {depositTotal > 0 && <div className="ps-sell-sum__breakdown">+ залог за тару {fmtInt(depositTotal)} ₽ (не входит в выручку)</div>}
            {toNum(agentFee) > 0 && <div className="ps-sell-sum__breakdown">− агентское вознаграждение {fmtInt(toNum(agentFee))} ₽ (не входит в выручку)</div>}
          </div>
          <label className="ps-field">
            <span>Агентское вознаграждение, ₽ (на всю сделку)</span>
            <input type="number" min="0" step="1" value={agentFee} onChange={(e) => setAgentFee(e.target.value)} placeholder="0" />
          </label>
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
          <label className="ps-check-field">
            <input type="checkbox" checked={paid} onChange={(e) => {
              setPaid(e.target.checked);
              if (e.target.checked && !paidDate) setPaidDate(isoToday());
            }} />
            <span>Оплачено</span>
          </label>
          {paid && (
            <label className="ps-field">
              <span>Дата оплаты</span>
              <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
            </label>
          )}
          <label className="ps-field ps-field-full">
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
          {isEdit && (
            <button type="button" className="ps-btn" onClick={handlePrint}>
              <Printer size={14} /> Накладная
            </button>
          )}
          <div className="ps-toolbar__spacer" />
          <button type="button" className="ps-btn" onClick={onClose}>Отмена</button>
          <button type="button" className="ps-btn ps-btn--primary" style={{ width: "auto" }}
            disabled={!clientId || !linesValid || saving} onClick={save}>
            {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Оформить продажу"}
          </button>
        </div>
      </div>
    </div>
  );
}
