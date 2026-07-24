export const AVATAR_COLORS = ["#175983", "#1E8A56", "#B9770E", "#7C5CBF", "#C13B3B", "#0E3A53", "#C9750E"];
export const colorForName = (name) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};

export const genId = () =>
  window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : "r" + Date.now() + Math.random().toString(16).slice(2);

export const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

export const toNum = (v) => {
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : n;
};
export const fmtInt = (n) => Math.round(n).toLocaleString("ru-RU");
export const fmtT = (n) => (n / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export const fromDbClient = (c) => ({
  id: c.id, clientNo: c.client_no, company: c.company || "", contactName: c.contact_name || "",
  phone: c.phone || "", source: c.source || "", inn: c.inn || "", kpp: c.kpp || "",
  ogrn: c.ogrn || "", legalAddress: c.legal_address || "", bankDetails: c.bank_details || "",
  comment: c.comment || "", fileUrl: c.company_file_url || "", fileName: c.company_file_name || "",
  assignedTo: c.assigned_to || "", createdBy: c.created_by || "",
  createdAt: c.created_at ? new Date(c.created_at).getTime() : 0,
});

export const toDbClient = (c) => ({
  company: c.company, contact_name: c.contactName, phone: c.phone, source: c.source,
  inn: c.inn, kpp: c.kpp, ogrn: c.ogrn, legal_address: c.legalAddress, bank_details: c.bankDetails,
  comment: c.comment, company_file_url: c.fileUrl, company_file_name: c.fileName,
  assigned_to: c.assignedTo,
});

export const fromDbSale = (s) => ({
  id: s.id, clientId: s.client_id, fuel: s.fuel || "", price: s.price ?? "", volume: s.volume ?? "",
  sum: s.sum ?? "", saleDate: s.sale_date || "", paymentMethod: s.payment_method || "",
  comment: s.comment || "", createdBy: s.created_by || "",
  createdAt: s.created_at ? new Date(s.created_at).getTime() : 0,
});

export const toDbSale = (s) => ({
  client_id: s.clientId, fuel: s.fuel, price: toNum(s.price), volume: toNum(s.volume),
  sum: toNum(s.sum), sale_date: s.saleDate, payment_method: s.paymentMethod,
  comment: s.comment, created_by: s.createdBy,
});

export function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "только что";
  if (s < 60) return `${s} сек назад`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.floor(h / 24)} дн назад`;
}
