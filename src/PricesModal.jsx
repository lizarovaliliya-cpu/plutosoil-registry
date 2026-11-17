import React from "react";
import { X, Tag } from "lucide-react";
import { FUELS, GOODS, Cell } from "./shared.jsx";

export default function PricesModal({ prices, onUpdate, goodPrices, onUpdateGood, onClose }) {
  const priceFor = (fuel) => prices.find((p) => p.fuel === fuel) || {};
  const goodPriceFor = (good) => (goodPrices || []).find((p) => p.good === good) || {};

  return (
    <div className="ps-drawer__overlay" onClick={onClose}>
      <div className="ps-drawer__panel" style={{ width: "min(420px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="ps-drawer__head">
          <h2><Tag size={17} style={{ verticalAlign: -3, marginRight: 6 }} />Текущие цены на топливо</h2>
          <button className="ps-mini" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ps-drawer__body">
          {FUELS.map((f) => {
            const p = priceFor(f);
            return (
              <div key={f} className="ps-price-row">
                <div className="ps-price-row__fuel">{f}</div>
                <div className="ps-price-row__grid">
                  <label className="ps-field">
                    <span>Наличные, ₽/л</span>
                    <Cell value={p.priceCash} onCommit={(v) => onUpdate(f, "priceCash", v)} type="number" placeholder="0" />
                  </label>
                  <label className="ps-field">
                    <span>Безналичный, ₽/л</span>
                    <Cell value={p.priceCashless} onCommit={(v) => onUpdate(f, "priceCashless", v)} type="number" placeholder="0" />
                  </label>
                </div>
                <label className="ps-field">
                  <span>Коэффициент перевода в тонны, кг/л</span>
                  <Cell value={p.density} onCommit={(v) => onUpdate(f, "density", v)} type="number" placeholder="0.75" />
                </label>
                {p.updatedAt > 0 && (
                  <div className="ps-price-row__meta">
                    Обновлено {p.updatedBy || "—"}, {new Date(p.updatedAt).toLocaleString("ru-RU")}
                  </div>
                )}
              </div>
            );
          })}
          <div className="ps-drawer__head" style={{ padding: "12px 0 6px", border: "none" }}>
            <h2 style={{ fontSize: 14 }}>Цены на товары</h2>
          </div>
          {GOODS.map((g) => {
            const p = goodPriceFor(g);
            return (
              <div key={g} className="ps-price-row">
                <div className="ps-price-row__fuel">{g}</div>
                <label className="ps-field">
                  <span>Цена, ₽/шт</span>
                  <Cell value={p.price} onCommit={(v) => onUpdateGood(g, v)} type="number" placeholder="0" />
                </label>
                {p.updatedAt > 0 && (
                  <div className="ps-price-row__meta">
                    Обновлено {p.updatedBy || "—"}, {new Date(p.updatedAt).toLocaleString("ru-RU")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="ps-drawer__foot">
          <div className="ps-toolbar__spacer" />
          <button type="button" className="ps-btn" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
