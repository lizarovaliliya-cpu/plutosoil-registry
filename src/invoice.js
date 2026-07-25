import { fmtInt, toNum } from "./utils.js";
import { CONTAINER_LABELS } from "./shared.jsx";

const esc = (s) =>
  String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function invoiceCopy(sale, client, company, docNo, dateStr, copyLabel) {
  const fuelSum = toNum(sale.price) * toNum(sale.volume);
  const hasContainer = sale.containerMode === "buy" || sale.containerMode === "rent";
  const containerQty = toNum(sale.containerQty) || 1;
  const containerSum = hasContainer ? toNum(sale.containerPrice) * containerQty : 0;
  const depositSum = sale.containerMode === "rent" ? toNum(sale.containerDeposit) * containerQty : 0;

  let rows = `
    <tr>
      <td>1</td>
      <td>${esc(sale.fuel)}</td>
      <td>л</td>
      <td>${fmtInt(toNum(sale.volume))}</td>
      <td>${fmtInt(toNum(sale.price))}</td>
      <td>${fmtInt(fuelSum)}</td>
    </tr>`;
  if (hasContainer) {
    rows += `
    <tr>
      <td>2</td>
      <td>Тара (${esc(CONTAINER_LABELS[sale.containerMode] || "")})</td>
      <td>шт</td>
      <td>${fmtInt(containerQty)}</td>
      <td>${fmtInt(toNum(sale.containerPrice))}</td>
      <td>${fmtInt(containerSum)}</td>
    </tr>`;
  }

  const supplierLine = [esc(company.name) || "—", company.inn && `ИНН ${esc(company.inn)}`, company.kpp && `КПП ${esc(company.kpp)}`, company.address && esc(company.address)]
    .filter(Boolean).join(", ");
  const buyerLine = [esc(client?.company) || "—", client?.inn && `ИНН ${esc(client.inn)}`, client?.kpp && `КПП ${esc(client.kpp)}`, client?.legalAddress && esc(client.legalAddress)]
    .filter(Boolean).join(", ");

  return `
  <div class="copy">
    <div class="copy-label">${copyLabel}</div>
    <div class="head-title">Накладная № ${docNo} от ${dateStr}</div>
    <div class="parties">
      <div><b>Поставщик:</b> ${supplierLine}</div>
      <div><b>Покупатель:</b> ${buyerLine}</div>
      ${client?.contactName || client?.phone ? `<div><b>Контактное лицо:</b> ${esc(client?.contactName)}${client?.phone ? `, тел. ${esc(client.phone)}` : ""}</div>` : ""}
    </div>
    <table class="items">
      <thead><tr><th>№</th><th>Наименование</th><th>Ед.</th><th>Кол-во</th><th>Цена, ₽</th><th>Сумма, ₽</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="total">Итого: ${fmtInt(toNum(sale.sum))} ₽</div>
    ${depositSum > 0 ? `<div class="note">Также получен залог за тару: ${fmtInt(depositSum)} ₽ (подлежит возврату при сдаче тары)</div>` : ""}
    <div class="sign">
      <div class="sign-row"><span>Отпустил:</span><span class="sign-name">${esc(company.releasedBy)}</span><span class="sign-line">Подпись ______________</span></div>
      <div class="sign-row"><span>Получил:</span><span class="sign-name"></span><span class="sign-line">Подпись ______________</span></div>
    </div>
  </div>`;
}

function buildInvoiceHtml(sale, client, company) {
  const docNo = (sale.id || "").replace(/-/g, "").slice(-8).toUpperCase() || "б/н";
  const dateStr = sale.saleDate ? new Date(sale.saleDate + "T00:00:00").toLocaleDateString("ru-RU") : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Накладная ${docNo}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #10151C; margin: 0; }
  .copy { padding: 6mm 4mm; }
  .copy-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #8A94A0; margin-bottom: 4px; }
  .head-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
  .parties div { margin-bottom: 3px; }
  table.items { width: 100%; border-collapse: collapse; margin: 10px 0; }
  table.items th, table.items td { border: 1px solid #666; padding: 4px 6px; text-align: left; font-size: 11.5px; }
  table.items th { background: #EEF1F4; }
  .total { font-weight: 700; font-size: 13px; text-align: right; margin-top: 4px; }
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
  ${invoiceCopy(sale, client, company, docNo, dateStr, "Экземпляр 1 — Поставщик")}
  <div class="cut"><span>линия отреза</span></div>
  ${invoiceCopy(sale, client, company, docNo, dateStr, "Экземпляр 2 — Покупатель")}
</body></html>`;
}

export function printInvoice(sale, client, company) {
  const html = buildInvoiceHtml(sale, client, company);

  let iframe = document.getElementById("ps-print-frame");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = "ps-print-frame";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
  }

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  requestAnimationFrame(() => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { /* noop */ }
  });
}
