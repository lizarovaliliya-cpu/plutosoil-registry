import React, { useState, useMemo } from "react";
import { Plus, Search, X, ShoppingCart } from "lucide-react";
import { fmtInt, toNum, colorForName } from "./utils.js";

export default function SalesView({ sales, salesLoaded, clients, managerName, onOpenSell }) {
  const [search, setSearch] = useState("");
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const enriched = useMemo(
    () => sales.map((s) => ({ ...s, clientName: clientById.get(s.clientId)?.company || "Клиент удалён" })),
    [sales, clientById]
  );

  const filtered = useMemo(() => {
    let out = enriched;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((s) => [s.clientName, s.fuel, s.comment, s.createdBy].some((v) => (v || "").toLowerCase().includes(q)));
    }
    return [...out].sort((a, b) => (b.saleDate || "").localeCompare(a.saleDate || "") || b.createdAt - a.createdAt);
  }, [enriched, search]);

  const total = filtered.reduce((a, s) => a + toNum(s.sum), 0);

  return (
    <>
      <div className="ps-toolbar">
        <div className="ps-search">
          <Search size={15} />
          <input placeholder="Поиск: клиент, топливо, менеджер, комментарий…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <X size={14} className="ps-search__clear" onClick={() => setSearch("")} />}
        </div>
        <div className="ps-toolbar__spacer" />
        <span className="ps-sales-total">{filtered.length} продаж · {fmtInt(total)} ₽</span>
        <button className="ps-btn ps-btn--primary" style={{ width: "auto" }} onClick={() => onOpenSell(null)}><Plus size={15} /> Продать</button>
      </div>

      <div className="ps-tablewrap">
        <table className="ps-table">
          <thead>
            <tr>
              <th>Дата</th><th className="ps-th-wide">Клиент</th><th>Топливо</th>
              <th>Цена, ₽/л</th><th>Объём, л</th><th>Сумма, ₽</th><th>Менеджер</th><th className="ps-th-wide">Комментарий</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td className="ps-td-no">{s.saleDate}</td>
                <td>{s.clientName}</td>
                <td><span className="ps-history__fuel">{s.fuel || "—"}</span></td>
                <td>{fmtInt(toNum(s.price))}</td>
                <td>{fmtInt(toNum(s.volume))}</td>
                <td style={{ fontFamily: "var(--font-mono)" }}>{fmtInt(toNum(s.sum))}</td>
                <td>{s.createdBy ? <span style={{ color: colorForName(s.createdBy) }}>{s.createdBy}</span> : "—"}</td>
                <td>{s.comment || "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="ps-empty">
                {salesLoaded ? <><ShoppingCart size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Продаж пока нет — нажмите «Продать».</> : "Загрузка…"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
