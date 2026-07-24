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
