import React, { useState, useMemo } from "react";
import {
  Plus, Search, X, Building2, Paperclip, Trash2, Download,
  FileText, ChevronDown, ChevronUp, Loader2, ShoppingCart, Clock, Gauge,
  ArrowUpDown, ArrowUp, ArrowDown
} from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { genId, toNum, fmtInt, colorForName } from "./utils.js";
import { FUELS, STATUSES, Cell, FuelGauge } from "./shared.jsx";

const emptyClient = (managerName) => ({
  id: null, clientNo: null, company: "", contactName: "", phone: "", source: "",
  inn: "", kpp: "", ogrn: "", legalAddress: "", bankDetails: "", comment: "",
  fileUrl: "", fileName: "", assignedTo: managerName || "", createdBy: managerName || "",
});

function SuggestDropdown({ items, onPick }) {
  if (items.length === 0) return null;
  return (
    <div className="ps-suggest">
      <div className="ps-suggest__hint">Похоже, уже есть в базе:</div>
      {items.map((c) => (
        <button key={c.id} type="button" className="ps-suggest__item" onMouseDown={(e) => { e.preventDefault(); onPick(c); }}>
          <span className="ps-suggest__company">{c.company || "Без названия"}</span>
          <span className="ps-suggest__meta">{c.contactName || "—"} · {c.phone || "—"}</span>
        </button>
      ))}
    </div>
  );
}

export default function ClientsView({
  clients, loaded, rows, sales, managerName, summary,
  onCreate, onUpdate, onDelete, onSell,
  onCommitField, onRemoveRow, onActualize, onAddDeal, onExportExcel,
}) {
  const [search, setSearch] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [sortKey, setSortKey] = useState("company");
  const [sortDir, setSortDir] = useState("asc");
  const [draft, setDraft] = useState(null); // client being created/edited in the drawer, null = closed
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [rowDeleteConfirm, setRowDeleteConfirm] = useState(null);
  const [suggestField, setSuggestField] = useState(null); // 'company' | 'contactName' | 'phone' | null

  const suggestionsFor = (query) => {
    const q = (query || "").trim().toLowerCase();
    if (q.length < 2) return [];
    return clients
      .filter((c) => c.id !== draft?.id && [c.company, c.contactName, c.phone].some((v) => (v || "").toLowerCase().includes(q)))
      .slice(0, 6);
  };

  const historyByClient = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      if (!r.clientId) return;
      if (!map.has(r.clientId)) map.set(r.clientId, []);
      map.get(r.clientId).push(r);
    });
    return map;
  }, [rows]);

  const salesByClient = useMemo(() => {
    const map = new Map();
    sales.forEach((s) => {
      if (!s.clientId) return;
      if (!map.has(s.clientId)) map.set(s.clientId, []);
      map.get(s.clientId).push(s);
    });
    return map;
  }, [sales]);

  const statsFor = (clientId) => {
    const hist = historyByClient.get(clientId) || [];
    const sold = salesByClient.get(clientId) || [];
    const sum = hist.reduce((a, r) => a + toNum(r.purchaseSum), 0) + sold.reduce((a, s) => a + toNum(s.sum), 0);
    return { leads: hist.length, deals: sold.length, sum };
  };

  const managers = useMemo(() => {
    const set = new Set(clients.map((c) => c.assignedTo).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [clients]);

  const filtered = useMemo(() => {
    let out = clients;
    if (managerFilter) out = out.filter((c) => c.assignedTo === managerFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((c) => [c.company, c.contactName, c.phone, c.source, c.assignedTo].some((v) => (v || "").toLowerCase().includes(q)));
    }
    const dir = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      if (sortKey === "sum") return (statsFor(a.id).sum - statsFor(b.id).sum) * dir;
      if (sortKey === "manager") return a.assignedTo.localeCompare(b.assignedTo, "ru") * dir;
      return a.company.localeCompare(b.company, "ru") * dir;
    });
    return out;
  }, [clients, search, managerFilter, sortKey, sortDir, historyByClient, salesByClient]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };
  const SortIcon = ({ colKey }) => sortKey !== colKey
    ? <ArrowUpDown size={12} className="ps-sorticon ps-sorticon--idle" />
    : (sortDir === "asc" ? <ArrowUp size={12} className="ps-sorticon" /> : <ArrowDown size={12} className="ps-sorticon" />);

  const openCreate = () => { setDraft(emptyClient(managerName)); setReqOpen(false); setDeleteConfirm(false); setSuggestField(null); };
  const openEdit = (client) => { setDraft({ ...client }); setReqOpen(false); setDeleteConfirm(false); setSuggestField(null); };
  const closeDrawer = () => setDraft(null);

  const saveDraft = async () => {
    if (!draft.company.trim()) return;
    setSaving(true);
    if (draft.id) await onUpdate(draft);
    else await onCreate(draft);
    setSaving(false);
    closeDrawer();
  };

  const removeClient = async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    await onDelete(draft.id);
    closeDrawer();
  };

  const handleRemoveRow = (id) => {
    if (rowDeleteConfirm !== id) {
      setRowDeleteConfirm(id);
      setTimeout(() => setRowDeleteConfirm((c) => (c === id ? null : c)), 3000);
      return;
    }
    setRowDeleteConfirm(null);
    onRemoveRow(id);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !draft) return;
    setUploading(true);
    const path = `${draft.id || "new-" + genId()}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("client-files").upload(path, file, { upsert: true });
    setUploading(false);
    if (error) return;
    setDraft((d) => ({ ...d, fileUrl: path, fileName: file.name }));
  };

  const openFile = async (fileUrl) => {
    const { data } = await supabase.storage.from("client-files").createSignedUrl(fileUrl, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  return (
    <>
      <div className="ps-dash">
        {FUELS.map((f) => <FuelGauge key={f} fuel={f} stats={summary.byFuel[f]} />)}
        <div className="ps-dash__total">
          <div className="ps-dash__total-row"><Gauge size={14} /><span>Итого</span></div>
          <div className="ps-dash__total-num">{clients.length}</div>
          <div className="ps-dash__total-label">клиентов · {summary.totalRows} заявок</div>
          <div className="ps-dash__total-sum">{fmtInt(summary.totalSum)} ₽</div>
          <div className="ps-dash__total-label">выручка от закупок на сейчас</div>
        </div>
      </div>

      <div className="ps-toolbar">
        <div className="ps-search">
          <Search size={15} />
          <input placeholder="Поиск: компания, контакт, телефон, менеджер…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <X size={14} className="ps-search__clear" onClick={() => setSearch("")} />}
        </div>
        <select className="ps-select-filter" value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)}>
          <option value="">Все менеджеры</option>
          {managers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="ps-toolbar__spacer" />
        <button className="ps-btn" onClick={onExportExcel}><Download size={15} /> Excel</button>
        <button className="ps-btn ps-btn--primary" style={{ width: "auto" }} onClick={openCreate}><Plus size={15} /> Добавить клиента</button>
      </div>

      <div className="ps-tablewrap">
        <table className="ps-table">
          <thead>
            <tr>
              <th onClick={() => toggleSort("company")} className="ps-th-wide">Компания <SortIcon colKey="company" /></th>
              <th>Контакт</th><th>Телефон</th><th>Источник</th>
              <th onClick={() => toggleSort("manager")}>Менеджер <SortIcon colKey="manager" /></th>
              <th>Заявок</th><th>Продаж</th>
              <th onClick={() => toggleSort("sum")}>Сумма, ₽ <SortIcon colKey="sum" /></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const stats = statsFor(c.id);
              return (
                <tr key={c.id} className="ps-client-row" onClick={() => openEdit(c)}>
                  <td className="ps-client-row__name"><Building2 size={13} style={{ verticalAlign: -2, marginRight: 6, color: "var(--petrol-2)" }} />{c.company || "Без названия"}</td>
                  <td>{c.contactName || "—"}</td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>{c.phone || "—"}</td>
                  <td>{c.source || "—"}</td>
                  <td>{c.assignedTo ? <span style={{ color: colorForName(c.assignedTo) }}>{c.assignedTo}</span> : "—"}</td>
                  <td>{stats.leads}</td>
                  <td>{stats.deals}</td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>{fmtInt(stats.sum)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="ps-empty">{loaded ? "Клиентов не найдено — измените поиск/фильтр или добавьте нового." : "Загрузка…"}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="ps-drawer__overlay" onClick={closeDrawer}>
          <div className="ps-drawer__panel" onClick={(e) => e.stopPropagation()}>
            <div className="ps-drawer__head">
              <h2>{draft.id ? "Карточка клиента" : "Новый клиент"}</h2>
              <button className="ps-mini" onClick={closeDrawer}><X size={16} /></button>
            </div>

            <div className="ps-drawer__body">
              <label className="ps-field" style={{ position: "relative" }}>
                <span>Компания *</span>
                <input value={draft.company}
                  onChange={(e) => setDraft({ ...draft, company: e.target.value })}
                  onFocus={() => setSuggestField("company")}
                  onBlur={() => setTimeout(() => setSuggestField((f) => (f === "company" ? null : f)), 150)}
                  placeholder="Название компании" autoFocus />
                {suggestField === "company" && <SuggestDropdown items={suggestionsFor(draft.company)} onPick={openEdit} />}
              </label>
              <label className="ps-field" style={{ position: "relative" }}>
                <span>Контактное лицо</span>
                <input value={draft.contactName}
                  onChange={(e) => setDraft({ ...draft, contactName: e.target.value })}
                  onFocus={() => setSuggestField("contactName")}
                  onBlur={() => setTimeout(() => setSuggestField((f) => (f === "contactName" ? null : f)), 150)}
                  placeholder="Имя" />
                {suggestField === "contactName" && <SuggestDropdown items={suggestionsFor(draft.contactName)} onPick={openEdit} />}
              </label>
              <label className="ps-field" style={{ position: "relative" }}>
                <span>Телефон</span>
                <input value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  onFocus={() => setSuggestField("phone")}
                  onBlur={() => setTimeout(() => setSuggestField((f) => (f === "phone" ? null : f)), 150)}
                  placeholder="+7…" />
                {suggestField === "phone" && <SuggestDropdown items={suggestionsFor(draft.phone)} onPick={openEdit} />}
              </label>
              <label className="ps-field">
                <span>Источник</span>
                <input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder="Откуда клиент" />
              </label>
              <label className="ps-field">
                <span>Закреплён за менеджером</span>
                <input value={draft.assignedTo} onChange={(e) => setDraft({ ...draft, assignedTo: e.target.value })} placeholder="Имя менеджера" />
              </label>
              <label className="ps-field">
                <span>Комментарий</span>
                <textarea rows={2} value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} placeholder="Заметки по клиенту" />
              </label>

              <button type="button" className="ps-req-toggle" onClick={() => setReqOpen((v) => !v)}>
                {reqOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Реквизиты и документы
              </button>
              {reqOpen && (
                <div className="ps-fieldset">
                  <label className="ps-field"><span>ИНН</span><input value={draft.inn} onChange={(e) => setDraft({ ...draft, inn: e.target.value })} /></label>
                  <label className="ps-field"><span>КПП</span><input value={draft.kpp} onChange={(e) => setDraft({ ...draft, kpp: e.target.value })} /></label>
                  <label className="ps-field"><span>ОГРН</span><input value={draft.ogrn} onChange={(e) => setDraft({ ...draft, ogrn: e.target.value })} /></label>
                  <label className="ps-field"><span>Юр. адрес</span><input value={draft.legalAddress} onChange={(e) => setDraft({ ...draft, legalAddress: e.target.value })} /></label>
                  <label className="ps-field"><span>Банковские реквизиты</span><textarea rows={2} value={draft.bankDetails} onChange={(e) => setDraft({ ...draft, bankDetails: e.target.value })} /></label>
                  <div className="ps-field">
                    <span>Карточка предприятия (файл)</span>
                    {draft.fileName ? (
                      <div className="ps-file-chip">
                        <FileText size={13} />
                        <span className="ps-file-chip__name" onClick={() => openFile(draft.fileUrl)}>{draft.fileName}</span>
                        <button type="button" className="ps-mini" onClick={() => setDraft({ ...draft, fileUrl: "", fileName: "" })}><X size={12} /></button>
                      </div>
                    ) : (
                      <label className="ps-btn ps-file-btn">
                        {uploading ? <Loader2 size={14} className="ps-spin" /> : <Paperclip size={14} />}
                        {uploading ? "Загрузка…" : "Загрузить файл"}
                        <input type="file" hidden onChange={handleFile} disabled={uploading} />
                      </label>
                    )}
                  </div>
                </div>
              )}

              {draft.id && (
                <div className="ps-history">
                  <div className="ps-history__row-head">
                    <div className="ps-history__head">Продажи</div>
                    <button type="button" className="ps-btn" style={{ width: "auto" }} onClick={() => onSell(draft.id)}><ShoppingCart size={13} /> Оформить продажу</button>
                  </div>
                  {(salesByClient.get(draft.id) || []).length === 0 && <div className="ps-history__empty">Пока нет оформленных продаж.</div>}
                  {(salesByClient.get(draft.id) || []).map((s) => (
                    <button key={s.id} type="button" className="ps-history__row ps-history__row--clickable" onClick={() => onSell(draft.id, s)}>
                      <span className="ps-history__fuel">{s.fuel || "—"}</span>
                      <span>{s.saleDate}</span>
                      <span>{fmtInt(toNum(s.volume))} л</span>
                      <span className="ps-history__sum">{fmtInt(toNum(s.sum))} ₽</span>
                    </button>
                  ))}

                  <div className="ps-history__row-head" style={{ marginTop: 16 }}>
                    <div className="ps-history__head">Заявки в воронке</div>
                    <button type="button" className="ps-btn" style={{ width: "auto" }} onClick={() => onAddDeal(draft)}><Plus size={13} /> Добавить заявку</button>
                  </div>
                  {(historyByClient.get(draft.id) || []).length === 0 && <div className="ps-history__empty">Пока нет заявок.</div>}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(historyByClient.get(draft.id) || []).map((r) => (
                      <div key={r.id} className="ps-leadrow">
                        <div className="ps-leadrow__top">
                          <Cell type="fuel" value={r.fuel} onCommit={(v) => onCommitField(r.id, "fuel", v)} />
                          <Cell type="select" options={STATUSES} value={r.status} onCommit={(v) => onCommitField(r.id, "status", v)} />
                          <div className="ps-leadrow__spacer" />
                          <button className="ps-del" onClick={() => handleRemoveRow(r.id)}>
                            {rowDeleteConfirm === r.id ? <span style={{ fontSize: 10.5 }}>Точно?</span> : <Trash2 size={13} />}
                          </button>
                        </div>
                        <div className="ps-leadrow__grid">
                          <label className="ps-leadrow__mini">Потр., л/нед
                            <Cell type="number" align="right" mono value={r.weeklyNeed} onCommit={(v) => onCommitField(r.id, "weeklyNeed", v)} />
                          </label>
                          <label className="ps-leadrow__mini">Актуализация
                            <div className="ps-td-date">
                              <Cell value={r.updateDate} onCommit={(v) => onCommitField(r.id, "updateDate", v)} mono placeholder="дд.мм.гггг" />
                              <button className="ps-mini" title="Сегодня" onClick={() => onActualize(r.id)}><Clock size={12} /></button>
                            </div>
                          </label>
                          <label className="ps-leadrow__mini">Куплено, л
                            <Cell type="number" align="right" mono value={r.purchased} onCommit={(v) => onCommitField(r.id, "purchased", v)} />
                          </label>
                          <label className="ps-leadrow__mini">Сумма, ₽
                            <Cell type="number" align="right" mono value={r.purchaseSum} onCommit={(v) => onCommitField(r.id, "purchaseSum", v)} />
                          </label>
                        </div>
                        <Cell value={r.statedNeed} onCommit={(v) => onCommitField(r.id, "statedNeed", v)} placeholder="Заявлено со слов клиента" />
                        <Cell value={r.comment} onCommit={(v) => onCommitField(r.id, "comment", v)} placeholder="Комментарий" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="ps-drawer__foot">
              {draft.id && (
                <button type="button" className={`ps-btn ${deleteConfirm ? "ps-del--confirm" : ""}`} onClick={removeClient}>
                  <Trash2 size={14} /> {deleteConfirm ? "Точно удалить?" : "Удалить"}
                </button>
              )}
              <div className="ps-toolbar__spacer" />
              <button type="button" className="ps-btn" onClick={closeDrawer}>Отмена</button>
              <button type="button" className="ps-btn ps-btn--primary" style={{ width: "auto" }} disabled={!draft.company.trim() || saving} onClick={saveDraft}>
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
