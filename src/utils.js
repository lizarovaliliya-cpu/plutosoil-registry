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

/* ---- позиция продажи (один вид топлива в рамках сделки) ---- */
export const fromDbSale = (s) => ({
  id: s.id, groupId: s.group_id, fuel: s.fuel || "", price: s.price ?? "", volume: s.volume ?? "",
  sum: s.sum ?? "", createdAt: s.created_at ? new Date(s.created_at).getTime() : 0,
  containerMode: s.container_mode || "", containerPrice: s.container_price ?? "",
  containerDeposit: s.container_deposit ?? "", containerQty: s.container_qty ?? "",
  locationId: s.location_id || "",
});

export const toDbSale = (s) => ({
  group_id: s.groupId, fuel: s.fuel, price: toNum(s.price), volume: toNum(s.volume), sum: toNum(s.sum),
  container_mode: s.containerMode || "",
  container_price: s.containerPrice === "" ? null : toNum(s.containerPrice),
  container_deposit: s.containerDeposit === "" ? null : toNum(s.containerDeposit),
  container_qty: s.containerQty === "" ? null : toNum(s.containerQty),
  location_id: s.locationId || null,
});

/* ---- шапка сделки (клиент, дата, оплата, менеджер, отгрузка) ---- */
export const fromDbSaleGroup = (g) => ({
  id: g.id, clientId: g.client_id, saleDate: g.sale_date || "", paymentMethod: g.payment_method || "",
  comment: g.comment || "", createdBy: g.created_by || "",
  shipped: !!g.shipped, shippedDate: g.shipped_date || "", agentFee: g.agent_fee ?? "",
  paid: !!g.paid, paidDate: g.paid_date || "",
  plannedShipDate: g.planned_ship_date || "",
  createdAt: g.created_at ? new Date(g.created_at).getTime() : 0,
});

export const toDbSaleGroup = (g) => ({
  client_id: g.clientId, sale_date: g.saleDate, payment_method: g.paymentMethod,
  comment: g.comment, created_by: g.createdBy,
  shipped: !!g.shipped, shipped_date: g.shipped ? (g.shippedDate || null) : null,
  paid: !!g.paid, paid_date: g.paid ? (g.paidDate || null) : null,
  agent_fee: g.agentFee === "" ? null : toNum(g.agentFee),
  planned_ship_date: g.plannedShipDate || null,
});

/* ---- собрать сделки: шапка + её позиции ---- */
export const buildSales = (groups, lines) => {
  const byGroup = new Map();
  lines.forEach((l) => {
    if (!byGroup.has(l.groupId)) byGroup.set(l.groupId, []);
    byGroup.get(l.groupId).push(l);
  });
  return groups.map((g) => {
    const items = byGroup.get(g.id) || [];
    return { ...g, items, sum: items.reduce((a, i) => a + toNum(i.sum), 0) };
  });
};

export const fromDbPrice = (p) => ({
  fuel: p.fuel, priceCash: p.price_cash ?? "", priceCashless: p.price_cashless ?? "", density: p.density ?? "",
  updatedBy: p.updated_by || "", updatedAt: p.updated_at ? new Date(p.updated_at).getTime() : 0,
});

export const fromDbReceipt = (r) => ({
  id: r.id, fuel: r.fuel || "", volume: r.volume ?? "", price: r.price ?? "", sum: r.sum ?? "",
  supplier: r.supplier || "", receiptDate: r.receipt_date || "", comment: r.comment || "",
  createdBy: r.created_by || "", createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
  locationId: r.location_id || "",
});

export const toDbReceipt = (r) => ({
  fuel: r.fuel, volume: toNum(r.volume), price: r.price === "" ? null : toNum(r.price),
  sum: toNum(r.sum), supplier: r.supplier, receipt_date: r.receiptDate,
  comment: r.comment, created_by: r.createdBy, location_id: r.locationId || null,
});

/* ---- точки хранения: склад / АЗС ---- */
export const fromDbLocation = (l) => ({
  id: l.id, name: l.name || "", type: l.type || "warehouse", address: l.address || "",
  createdBy: l.created_by || "", createdAt: l.created_at ? new Date(l.created_at).getTime() : 0,
});

export const toDbLocation = (l) => ({
  name: l.name, type: l.type || "warehouse", address: l.address || "", created_by: l.createdBy,
});

/* ---- заправка по лимитам: справочник машин клиента ---- */
export const fromDbVehicle = (v) => ({
  id: v.id, clientId: v.client_id, plate: v.plate || "", model: v.model || "",
  phone: v.phone || "", note: v.note || "", createdBy: v.created_by || "",
  createdAt: v.created_at ? new Date(v.created_at).getTime() : 0,
});

export const toDbVehicle = (v) => ({
  client_id: v.clientId, plate: v.plate || "", model: v.model || "",
  phone: v.phone || "", note: v.note || "", created_by: v.createdBy,
});

/* ---- заправка по лимитам: текущий лимит клиента по виду топлива ---- */
export const fromDbFuelLimit = (l) => ({
  id: l.id, clientId: l.client_id, fuel: l.fuel || "", limitVolume: l.limit_volume ?? 0,
  updatedBy: l.updated_by || "", updatedAt: l.updated_at ? new Date(l.updated_at).getTime() : 0,
});

/* ---- заправка по лимитам: лимит конкретной машины по виду топлива ---- */
export const fromDbVehicleFuelLimit = (l) => ({
  id: l.id, vehicleId: l.vehicle_id, fuel: l.fuel || "", limitVolume: l.limit_volume ?? 0,
  updatedBy: l.updated_by || "", updatedAt: l.updated_at ? new Date(l.updated_at).getTime() : 0,
});

/* ---- заправка по лимитам: журнал заправок (списаний с лимита) ---- */
export const fromDbFill = (f) => ({
  id: f.id, clientId: f.client_id, vehicleId: f.vehicle_id || "", vehiclePlate: f.vehicle_plate || "",
  driver: f.driver || "", fuel: f.fuel || "", volume: f.volume ?? "", price: f.price ?? "", sum: f.sum ?? "",
  fillDate: f.fill_date || "", comment: f.comment || "", createdBy: f.created_by || "",
  createdAt: f.created_at ? new Date(f.created_at).getTime() : 0,
});

export const toDbFill = (f) => ({
  client_id: f.clientId, vehicle_id: f.vehicleId || null, vehicle_plate: f.vehiclePlate || "",
  driver: f.driver || "", fuel: f.fuel, volume: toNum(f.volume), price: toNum(f.price), sum: toNum(f.sum),
  fill_date: f.fillDate, comment: f.comment || "", created_by: f.createdBy,
});

/* ---- перемещение топлива между точками ---- */
export const fromDbTransfer = (t) => ({
  id: t.id, fromLocationId: t.from_location_id || "", toLocationId: t.to_location_id || "",
  fuel: t.fuel || "", volume: t.volume ?? "", transferDate: t.transfer_date || "",
  comment: t.comment || "", createdBy: t.created_by || "",
  createdAt: t.created_at ? new Date(t.created_at).getTime() : 0,
});

export const toDbTransfer = (t) => ({
  from_location_id: t.fromLocationId || null, to_location_id: t.toLocationId || null,
  fuel: t.fuel, volume: toNum(t.volume), transfer_date: t.transferDate,
  comment: t.comment, created_by: t.createdBy,
});

/* ---- частичная отгрузка топлива по сделке (одна машина = одна строка) ---- */
export const fromDbShipment = (s) => ({
  id: s.id, groupId: s.group_id, fuel: s.fuel || "", volume: s.volume ?? "",
  vehiclePlate: s.vehicle_plate || "", driver: s.driver || "", shipDate: s.ship_date || "",
  comment: s.comment || "", createdBy: s.created_by || "",
  createdAt: s.created_at ? new Date(s.created_at).getTime() : 0,
});

export const toDbShipment = (s) => ({
  group_id: s.groupId, fuel: s.fuel, volume: toNum(s.volume),
  vehicle_plate: s.vehiclePlate || "", driver: s.driver || "",
  ship_date: s.shipDate, comment: s.comment || "", created_by: s.createdBy,
});

export const fromDbCompanyProfile = (p) => ({
  name: p.name || "", inn: p.inn || "", kpp: p.kpp || "", address: p.address || "",
  releasedBy: p.released_by || "",
  updatedBy: p.updated_by || "", updatedAt: p.updated_at ? new Date(p.updated_at).getTime() : 0,
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
