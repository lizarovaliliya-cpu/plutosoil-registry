import { fmtInt, toNum } from "./utils.js";
import { printHtml } from "./print.js";

const esc = (s) =>
  String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const locName = (l) => (l ? `${l.type === "station" ? "АЗС" : "Склад"} · ${l.name}` : "—");
const locAddress = (l) => (l && l.address ? l.address : "");

function transferCopy(transfer, fromLocation, toLocation, company, docNo, dateStr, copyLabel) {
  const volume = toNum(transfer.volume);
  const density = toNum(transfer.density);
  const m3 = volume > 0 ? volume / 1000 : null;
  const tonnes = density > 0 && volume > 0 ? (volume * density) / 1000 : null;
  const qtyNote = [
    m3 != null ? `≈ ${m3.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} м³` : "",
    tonnes != null ? `≈ ${tonnes.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т` : "",
  ].filter(Boolean).join(" · ");

  return `
  <div class="copy">
    <div class="copy-label">${copyLabel}</div>
    <div class="head-title">Накладная на перемещение № ${docNo} от ${dateStr}</div>
    <div class="parties">
      <div><b>Компания:</b> ${esc(company.name) || "—"}</div>
      <div><b>Откуда:</b> ${esc(locName(fromLocation))}${locAddress(fromLocation) ? `, ${esc(locAddress(fromLocation))}` : ""}</div>
      <div><b>Куда:</b> ${esc(locName(toLocation))}${locAddress(toLocation) ? `, ${esc(locAddress(toLocation))}` : ""}</div>
    </div>
    <table class="items">
      <thead><tr><th>№</th><th>Наименование</th><th>Ед.</th><th>Кол-во</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>${esc(transfer.fuel)}</td><td>л</td><td>${fmtInt(volume)}${qtyNote ? `<br><span class="unit-note">${qtyNote}</span>` : ""}</td></tr>
      </tbody>
    </table>
    ${transfer.comment ? `<div class="note">Комментарий: ${esc(transfer.comment)}</div>` : ""}
    <div class="sign">
      <div class="sign-row"><span>Отпустил (${esc(locName(fromLocation))}):</span><span class="sign-name"></span><span class="sign-line">Подпись ______________</span></div>
      <div class="sign-row"><span>Принял (${esc(locName(toLocation))}):</span><span class="sign-name"></span><span class="sign-line">Подпись ______________</span></div>
    </div>
  </div>`;
}

function buildTransferInvoiceHtml(transfer, fromLocation, toLocation, company) {
  const docNo = (transfer.id || "").replace(/-/g, "").slice(-8).toUpperCase() || "б/н";
  const dateStr = transfer.transferDate ? new Date(transfer.transferDate + "T00:00:00").toLocaleDateString("ru-RU") : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Накладная на перемещение ${docNo}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #10151C; margin: 0; }
  .copy { padding: 4mm; }
  .copy-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #8A94A0; margin-bottom: 4px; }
  .head-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
  .parties div { margin-bottom: 3px; }
  table.items { width: 100%; border-collapse: collapse; margin: 10px 0; }
  table.items th, table.items td { border: 1px solid #666; padding: 4px 6px; text-align: left; font-size: 11.5px; }
  table.items th { background: #EEF1F4; }
  .unit-note { font-size: 10px; color: #8A94A0; }
  .note { font-size: 11px; color: #444; margin-top: 4px; }
  .sign { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }
  .sign-row { display: flex; gap: 10px; align-items: baseline; font-size: 11.5px; }
  .sign-name { min-width: 140px; border-bottom: 1px solid #999; }
  .sign-line { flex: 1; }
  .cut { border-top: 1px dashed #999; margin: 4mm 0; text-align: center; font-size: 9px; color: #999; }
  .cut span { position: relative; top: -6px; background: #fff; padding: 0 6px; }
  @media print { .cut { page-break-inside: avoid; } }
</style>
</head>
<body>
  ${transferCopy(transfer, fromLocation, toLocation, company, docNo, dateStr, "Экземпляр 1 — Пункт отправления")}
  <div class="cut"><span>линия отреза</span></div>
  ${transferCopy(transfer, fromLocation, toLocation, company, docNo, dateStr, "Экземпляр 2 — Пункт назначения")}
</body></html>`;
}

export function printTransferInvoice(transfer, fromLocation, toLocation, company) {
  printHtml(buildTransferInvoiceHtml(transfer, fromLocation, toLocation, company || {}));
}
