import React, { useState, useEffect, useMemo } from "react";
import {
  Plus, Search, X, Building2, Phone, User2, Paperclip, Trash2,
  FileText, ChevronDown, ChevronUp, Loader2
} from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { genId, toNum, fmtInt, todayStr, colorForName } from "./utils.js";

const fromDbClient = (c) => ({
  id: c.id, clientNo: c.client_no, company: c.company || "", contactName: c.contact_name || "",
  phone: c.phone || "", source: c.source || "", inn: c.inn || "", kpp: c.kpp || "",
  ogrn: c.ogrn || "", legalAddress: c.legal_address || "", bankDetails: c.bank_details || "",
  comment: c.comment || "", fileUrl: c.company_file_url || "", fileName: c.company_file_name || "",
  assignedTo: c.assigned_to || "", createdBy: c.created_by || "",
  createdAt: c.created_at ? new Date(c.created_at).getTime() : 0,
});

const toDbClient = (c) => ({
  company: c.company, contact_name: c.contactName, phone: c.phone, source: c.source,
  inn: c.inn, kpp: c.kpp, ogrn: c.ogrn, legal_address: c.legalAddress, bank_details: c.bankDetails,
  comment: c.comment, company_file_url: c.fileUrl, company_file_name: c.fileName,
  assigned_to: c.assignedTo,
});

const emptyClient = (managerName) => ({
  id: null, clientNo: null, company: "", contactName: "", phone: "", source: "",
  inn: "", kpp: "", ogrn: "", legalAddress: "", bankDetails: "", comment: "",
  fileUrl: "", fileName: "", assignedTo: managerName || "", createdBy: managerName || "",
});

export default function ClientsView({ rows, managerName }) {
  const [clients, setClients] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState(null); // client being created/edited in the drawer, null = closed
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    let channel;
    (async () => {
      const { data } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
      setClients((data || []).map(fromDbClient));
      setLoaded(true);
      channel = supabase.channel("clients-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, (payload) => {
          setClients((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((c) => c.id !== payload.old.id);
            const incoming = fromDbClient(payload.new);
            const exists = prev.some((c) => c.id === incoming.id);
            return exists ? prev.map((c) => (c.id === incoming.id ? incoming : c)) : [incoming, ...prev];
          });
        })
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, []);

  const historyByClient = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      if (!r.clientId) return;
      if (!map.has(r.clientId)) map.set(r.clientId, []);
      map.get(r.clientId).push(r);
    });
    return map;
  }, [rows]);

  const statsFor = (clientId) => {
    const hist = historyByClient.get(clientId) || [];
    const sum = hist.reduce((a, r) => a + toNum(r.purchaseSum), 0);
    return { count: hist.length, sum };
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.trim().toLowerCase();
    return clients.filter((c) => [c.company, c.contactName, c.phone, c.source, c.assignedTo].some((v) => (v || "").toLowerCase().includes(q)));
  }, [clients, search]);

  const openCreate = () => { setDraft(emptyClient(managerName)); setReqOpen(false); setDeleteConfirm(false); };
  const openEdit = (client) => { setDraft({ ...client }); setReqOpen(false); setDeleteConfirm(false); };
  const closeDrawer = () => setDraft(null);

  const saveDraft = async () => {
    if (!draft.company.trim()) return;
    setSaving(true);
    if (draft.id) {
      const { error } = await supabase.from("clients").update(toDbClient(draft)).eq("id", draft.id);
      if (!error) setClients((prev) => prev.map((c) => (c.id === draft.id ? { ...draft } : c)));
    } else {
      const maxNo = clients.reduce((m, c) => Math.max(m, toNum(c.clientNo)), 0);
      const payload = { ...toDbClient(draft), client_no: maxNo + 1, created_by: managerName || "Гость" };
      const { data, error } = await supabase.from("clients").insert([payload]).select().single();
      if (!error && data) setClients((prev) => [fromDbClient(data), ...prev]);
    }
    setSaving(false);
    closeDrawer();
  };

  const removeClient = async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    await supabase.from("clients").delete().eq("id", draft.id);
    setClients((prev) => prev.filter((c) => c.id !== draft.id));
    closeDrawer();
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
      <div className="ps-toolbar">
        <div className="ps-search">
          <Search size={15} />
          <input placeholder="Поиск: компания, контакт, телефон, менеджер…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <X size={14} className="ps-search__clear" onClick={() => setSearch("")} />}
        </div>
        <div className="ps-toolbar__spacer" />
        <button className="ps-btn ps-btn--primary" style={{ width: "auto" }} onClick={openCreate}><Plus size={15} /> Добавить клиента</button>
      </div>

      <div className="ps-client-grid">
        {filtered.map((c) => {
          const stats = statsFor(c.id);
          return (
            <button key={c.id} className="ps-client-card" onClick={() => openEdit(c)}>
              <div className="ps-client-card__top">
                <div className="ps-client-card__icon"><Building2 size={16} /></div>
                <div className="ps-client-card__title">{c.company || "Без названия"}</div>
              </div>
              {c.contactName && <div className="ps-client-card__row"><User2 size={12} />{c.contactName}</div>}
              {c.phone && <div className="ps-client-card__row"><Phone size={12} />{c.phone}</div>}
              <div className="ps-client-card__bottom">
                <span className="ps-client-card__stat">{stats.count} сделок · {fmtInt(stats.sum)} ₽</span>
                {c.assignedTo && <span className="ps-avatar" style={{ background: colorForName(c.assignedTo) }} title={c.assignedTo}>{c.assignedTo.trim().slice(0, 1).toUpperCase()}</span>}
              </div>
            </button>
          );
        })}
        {loaded && filtered.length === 0 && <div className="ps-empty" style={{ gridColumn: "1/-1" }}>Клиентов пока нет — нажмите «Добавить клиента».</div>}
      </div>

      {draft && (
        <div className="ps-drawer__overlay" onClick={closeDrawer}>
          <div className="ps-drawer__panel" onClick={(e) => e.stopPropagation()}>
            <div className="ps-drawer__head">
              <h2>{draft.id ? "Карточка клиента" : "Новый клиент"}</h2>
              <button className="ps-mini" onClick={closeDrawer}><X size={16} /></button>
            </div>

            <div className="ps-drawer__body">
              <label className="ps-field">
                <span>Компания *</span>
                <input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} placeholder="Название компании" autoFocus />
              </label>
              <label className="ps-field">
                <span>Контактное лицо</span>
                <input value={draft.contactName} onChange={(e) => setDraft({ ...draft, contactName: e.target.value })} placeholder="Имя" />
              </label>
              <label className="ps-field">
                <span>Телефон</span>
                <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="+7…" />
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
                  <div className="ps-history__head">История покупок</div>
                  {(historyByClient.get(draft.id) || []).length === 0 && <div className="ps-history__empty">Пока нет сделок в реестре.</div>}
                  {(historyByClient.get(draft.id) || []).map((r) => (
                    <div key={r.id} className="ps-history__row">
                      <span className="ps-history__fuel">{r.fuel || "—"}</span>
                      <span>{r.updateDate}</span>
                      <span>{r.status || "Новый"}</span>
                      <span className="ps-history__sum">{r.purchaseSum ? `${fmtInt(toNum(r.purchaseSum))} ₽` : "—"}</span>
                    </div>
                  ))}
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
