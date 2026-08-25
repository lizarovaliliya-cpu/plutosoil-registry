import { fmtInt, toNum } from "./utils.js";
import { printHtml } from "./print.js";

const esc = (s) =>
  String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtDate = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("ru-RU") : "—");

function fillCopy(fills, client, company, densityFor, docNo, dateStr, copyLabel) {
  let total = 0;
  const rows = fills.map((f, idx) => {
    const sum = toNum(f.price) * toNum(f.volume);
    total += sum;
    const density = densityFor(f.fuel);
    const tonnes = density > 0 ? (toNum(f.volume) * density) / 1000 : null;
    return `
    <tr>
      <td>${idx + 1}</td>
      <td>${fmtDate(f.fillDate)}</td>
      <td>${esc(f.vehiclePlate) || "—"}${f.driver ? `<br><span class="unit-note">${esc(f.driver)}</span>` : ""}</td>
      <td>${esc(f.fuel)}</td>
      <td>${fmtInt(toNum(f.volume))}${tonnes != null ? `<br><span class="unit-note">≈ ${tonnes.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т</span>` : ""}</td>
      <td>${fmtInt(toNum(f.price))}</td>
      <td>${fmtInt(sum)}</td>
    </tr>`;
  }).join("");

  const supplierLine = [esc(company.name) || "—", company.inn && `ИНН ${esc(company.inn)}`, company.kpp && `КПП ${esc(company.kpp)}`, company.address && esc(company.address)]
    .filter(Boolean).join(", ");
  const buyerLine = [esc(client?.company) || "—", client?.inn && `ИНН ${esc(client.inn)}`, client?.kpp && `КПП ${esc(client.kpp)}`, client?.legalAddress && esc(client.legalAddress)]
    .filter(Boolean).join(", ");

  return `
  <div class="copy">
    <div class="copy-label">${copyLabel}</div>
    <div class="head-title">Накладная на отпуск топлива по лимиту № ${docNo} от ${dateStr}</div>
    <div class="parties">
      <div><b>Поставщик:</b> ${supplierLine}</div>
      <div><b>Покупатель:</b> ${buyerLine}</div>
      ${client?.contactName || client?.phone ? `<div><b>Контактное лицо:</b> ${esc(client?.contactName)}${client?.phone ? `, тел. ${esc(client.phone)}` : ""}</div>` : ""}
    </div>
    <table class="items">
      <thead><tr><th>№</th><th>Дата</th><th>Гос. номер</th><th>Топливо</th><th>Объём, л</th><th>Цена, ₽</th><th>Сумма, ₽</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="total">Итого: ${fmtInt(total)} ₽</div>
    <div class="sign">
      <div class="sign-row"><span>Отпустил:</span><span class="sign-name">${esc(company.releasedBy)}</span><span class="sign-line">Подпись ______________</span></div>
      <div class="sign-row"><span>Получил:</span><span class="sign-name"></span><span class="sign-line">Подпись ______________</span></div>
    </div>
  </div>`;
}

function buildFillInvoiceHtml(fills, client, company, densityFor) {
  const docNo = fills.length === 1
    ? (fills[0].id || "").replace(/-/g, "").slice(-8).toUpperCase() || "б/н"
    : `Л${fills.map((f) => (f.id || "").slice(-4)).join("").slice(0, 8).toUpperCase()}`;
  const dateStr = fmtDate([...fills].sort((a, b) => (b.fillDate || "").localeCompare(a.fillDate || ""))[0]?.fillDate);

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Накладная по лимиту ${docNo}</title>
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
  .total { font-weight: 700; font-size: 13px; text-align: right; margin-top: 4px; }
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
  ${fillCopy(fills, client, company, densityFor, docNo, dateStr, "Экземпляр 1 — Поставщик")}
  <div class="cut"><span>линия отреза</span></div>
  ${fillCopy(fills, client, company, densityFor, docNo, dateStr, "Экземпляр 2 — Покупатель")}
</body></html>`;
}

export function printLimitFillInvoice(fills, client, company, densityFor) {
  if (!fills || fills.length === 0) return;
  printHtml(buildFillInvoiceHtml(fills, client, company, densityFor));
}
