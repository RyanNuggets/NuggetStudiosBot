// Features/Payment/providers/exchangeRateProvider.js
// Fetches live AED-based exchange rates and caches them for a configurable
// window so we're not hammering the provider on every price display.

import getConfig from "../config/config.js";

let cachedRates = null;
let cachedAt = 0;

export async function getExchangeRates() {
  const { exchangeRates } = getConfig();
  const cacheMs = exchangeRates.cacheMinutes * 60 * 1000;

  if (cachedRates && Date.now() - cachedAt < cacheMs) {
    return cachedRates;
  }

  const res = await fetch(exchangeRates.provider);
  if (!res.ok) {
    // Fall back to a stale cache rather than fully failing, if we have one.
    if (cachedRates) return cachedRates;
    throw new Error(`Failed to fetch exchange rates (${res.status})`);
  }

  const data = await res.json();

  // open.er-api.com shape: { result: "success", base_code: "AED", rates: { USD: 0.27, ... } }
  // If you swap providers, normalize the response to { USD, EUR, GBP, AED } here.
  const rates = data.rates || data.conversion_rates;
  if (!rates) throw new Error("Unexpected exchange rate provider response shape.");

  cachedRates = { AED: 1, USD: rates.USD, EUR: rates.EUR, GBP: rates.GBP };
  cachedAt = Date.now();

  return cachedRates;
}
