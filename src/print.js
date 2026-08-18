export function printHtml(html) {
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
