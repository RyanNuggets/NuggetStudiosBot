// Features/Payment/utils/pricing.js
// All Robux <-> currency math lives here so it's calculated exactly one
// way, everywhere. Staff should never need to type in a real-world amount.

import getConfig from "../config/config.js";
import { getExchangeRates } from "../providers/exchangeRateProvider.js";

/**
 * Converts a Robux amount to AED using the configurable conversion rate
 * (default: 1000 Robux = 37 AED).
 * @param {number} robuxAmount
 * @returns {number} AED amount, rounded to 2 decimal places
 */
export function robuxToAed(robuxAmount) {
  const { robux, aed } = getConfig().robuxToAed;
  const result = (robuxAmount / robux) * aed;
  return round2(result);
}

/**
 * Converts an AED amount into another supported currency using live
 * exchange rates. Returns the AED amount unchanged if target is AED.
 * @param {number} aedAmount
 * @param {"AED"|"USD"|"EUR"|"GBP"} targetCurrency
 */
export async function convertFromAed(aedAmount, targetCurrency) {
  if (targetCurrency === "AED") return round2(aedAmount);

  const rates = await getExchangeRates(); // base = AED
  const rate = rates[targetCurrency];
  if (!rate) {
    throw new Error(`No exchange rate available for ${targetCurrency}`);
  }
  return round2(aedAmount * rate);
}

/**
 * Convenience: Robux amount -> target currency, in one call.
 */
export async function robuxToCurrency(robuxAmount, targetCurrency) {
  const aed = robuxToAed(robuxAmount);
  return convertFromAed(aed, targetCurrency);
}

/**
 * Builds a full pricing breakdown for every payment method, given a Robux
 * amount and the currently selected currency (defaults to AED). Used by
 * the payment method embed to show live prices for every option at once.
 */
export async function buildPricingBreakdown(robuxAmount, currency = "AED") {
  const aed = robuxToAed(robuxAmount);
  const converted = await convertFromAed(aed, currency);

  return {
    robux: robuxAmount,
    currency,
    amount: converted,
    breakdown: {
      robuxGamepass: robuxAmount,
      robuxTshirt: robuxAmount,
      applePay: converted,
      googlePay: converted,
      card: converted,
    },
  };
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Converts an AED amount back to an equivalent Robux amount - the inverse
 * of robuxToAed. Robux is always a whole number.
 */
export function aedToRobux(aedAmount) {
  const { robux, aed } = getConfig().robuxToAed;
  return Math.round((aedAmount / aed) * robux);
}

/**
 * Converts an amount in any supported currency into AED using live
 * exchange rates - the inverse of convertFromAed.
 * @param {number} amount
 * @param {"AED"|"USD"|"EUR"|"GBP"} fromCurrency
 */
export async function convertToAed(amount, fromCurrency) {
  if (fromCurrency === "AED") return round2(amount);

  const rates = await getExchangeRates(); // base = AED
  const rate = rates[fromCurrency];
  if (!rate) {
    throw new Error(`No exchange rate available for ${fromCurrency}`);
  }
  return round2(amount / rate);
}

/**
 * Convenience: an amount in any supported currency -> equivalent Robux, in
 * one call. Used when staff enters a real-world price instead of a Robux
 * amount when creating a payment (see modals/paymentModal.js).
 */
export async function currencyToRobux(amount, fromCurrency) {
  const aed = await convertToAed(amount, fromCurrency);
  return aedToRobux(aed);
}

export function formatCurrency(amount, currency) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    // Fallback for currencies Intl might not resolve cleanly in older Node versions.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatRobux(amount) {
  return `${Number(amount).toLocaleString("en-US")} Robux`;
}
