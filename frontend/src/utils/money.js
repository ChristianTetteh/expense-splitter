import { createContext, useContext } from "react";

// Formats integer minor units (as returned by the API) for display —
// "GH₵12.50", "-$3.00". All money math happens on the server in integer
// pesewas/cents; this file only ever formats, never calculates.
export const CURRENCIES = {
  GHS: { code: "GHS", symbol: "GH₵", name: "Ghana cedis" },
  USD: { code: "USD", symbol: "$", name: "US dollars" },
};
export const DEFAULT_CURRENCY = "GHS";

export function currencyInfo(code) {
  return CURRENCIES[code] || CURRENCIES[DEFAULT_CURRENCY];
}

export function formatCents(cents, { showSign = false, currency = DEFAULT_CURRENCY } = {}) {
  const { symbol } = currencyInfo(currency);
  const formatted = Math.abs(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (showSign) {
    if (cents > 0) return `+${symbol}${formatted}`;
    if (cents < 0) return `-${symbol}${formatted}`;
    return `${symbol}${formatted}`;
  }
  return cents < 0 ? `-${symbol}${formatted}` : `${symbol}${formatted}`;
}

// A tab is in one currency; TabView provides it so every amount below it
// is formatted the same way without threading a prop through each component.
export const CurrencyContext = createContext(DEFAULT_CURRENCY);

export function useMoney() {
  const currency = useContext(CurrencyContext);
  return { currency, symbol: currencyInfo(currency).symbol, fmt: (cents, opts) => formatCents(cents, { ...opts, currency }) };
}
