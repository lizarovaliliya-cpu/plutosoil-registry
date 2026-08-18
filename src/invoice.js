import { fmtInt, toNum } from "./utils.js";
import { CONTAINER_LABELS } from "./shared.jsx";

const esc = (s) =>
  String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function invoiceCopy(group, client, company, docNo, dateStr, copyLabel) {
  const items = group.items || [];
  let rowNum = 0;
  let rows = "";
  let total = 0;
  let depositSum = 0;

  items.forEach((it) => {
    const fuelSum = toNum(it.price) * toNum(it.volume);
    const hasContainer = it.containerMode === "buy" || it.containerMode === "rent";
    const containerQty = toNum(it.containerQty) || 1;
    const containerSum = hasContainer ? toNum(it.containerPrice) * containerQty : 0;
    total += fuelSum + containerSum;
    if (it.containerMode === "rent") depositSum += toNum(it.containerDeposit) * containerQty;

    const density = toNum(it.density);
    const tonnes = density > 0 ? (toNum(it.volume) * density) / 1000 : null;

    rowNum += 1;
    rows += `
    <tr>
      <td>${rowNum}</td>
      <td>${esc(it.fuel)}</td>
      <td>л</td>
      <td>${fmtInt(toNum(it.volume))}${tonnes != null ? `<br><span class="unit-note">≈ ${tonnes.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т</span>` : ""}</td>
      <td>${fmtInt(toNum(it.price))}</td>
      <td>${fmtInt(fuelSum)}</td>
    </tr>`;
    if (hasContainer) {
      rowNum += 1;
      rows += `
    <tr>
      <td>${rowNum}</td>
      <td>Тара (${esc(CONTAINER_LABELS[it.containerMode] || "")}) — ${esc(it.fuel)}</td>
      <td>шт</td>
      <td>${fmtInt(containerQty)}</td>
      <td>${fmtInt(toNum(it.containerPrice))}</td>
      <td>${fmtInt(containerSum)}</td>
    </tr>`;
    }
  });

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
    <div class="total">Итого: ${fmtInt(total)} ₽</div>
    <div class="pay-status ${group.paid ? "pay-status--paid" : "pay-status--unpaid"}">
      Оплата: ${esc(group.paymentMethod) || "—"} — ${group.paid ? `ОПЛАЧЕНО${group.paidDate ? " " + new Date(group.paidDate + "T00:00:00").toLocaleDateString("ru-RU") : ""}` : "НЕ ОПЛАЧЕНО"}
    </div>
    ${depositSum > 0 ? `<div class="note">Также получен залог за тару: ${fmtInt(depositSum)} ₽ (подлежит возврату при сдаче тары)</div>` : ""}
    <div class="sign">
      <div class="sign-row"><span>Отпустил:</span><span class="sign-name">${esc(company.releasedBy)}</span><span class="sign-line">Подпись ______________</span></div>
      <div class="sign-row"><span>Получил:</span><span class="sign-name"></span><span class="sign-line">Подпись ______________</span></div>
    </div>
  </div>`;
}

function buildInvoiceHtml(group, client, company) {
  const docNo = (group.id || "").replace(/-/g, "").slice(-8).toUpperCase() || "б/н";
  const dateStr = group.saleDate ? new Date(group.saleDate + "T00:00:00").toLocaleDateString("ru-RU") : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Накладная ${docNo}</title>
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
  .pay-status { text-align: right; font-weight: 700; font-size: 11.5px; margin-top: 2px; letter-spacing: 0.02em; }
  .pay-status--paid { color: #1E8A56; }
  .pay-status--unpaid { color: #C13B3B; }
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
  ${invoiceCopy(group, client, company, docNo, dateStr, "Экземпляр 1 — Поставщик")}
  <div class="cut"><span>линия отреза</span></div>
  ${invoiceCopy(group, client, company, docNo, dateStr, "Экземпляр 2 — Покупатель")}
  <div class="cut"><span>линия отреза</span></div>
  ${invoiceCopy(group, client, company, docNo, dateStr, "Экземпляр 3 — Склад")}
</body></html>`;
}

export function printInvoice(group, client, company) {
  const html = buildInvoiceHtml(group, client, company);

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
