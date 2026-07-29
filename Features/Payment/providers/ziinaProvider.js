// Features/Payment/providers/ziinaProvider.js
// Wraps Ziina's Payment Intent API for Apple Pay / Google Pay.
// Docs: https://docs.ziina.com/api-reference/introduction
//
// Double-check the request/response field names against the current docs
// before going live - payment provider APIs are exactly the kind of thing
// that shifts between doc revisions.

import getConfig from "../config/config.js";

function authHeaders() {
  const { ziina } = getConfig();
  if (!ziina.apiKey) throw new Error("Missing config.payment.ziina.apiKey");
  return {
    Authorization: `Bearer ${ziina.apiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * Creates a Ziina payment intent.
 * @param {object} params
 * @param {number} params.amount - amount in the currency's major unit, e.g. 12.34 AED
 * @param {"AED"|"USD"|"EUR"|"GBP"} params.currency
 * @param {string} params.message - shown to the payer, e.g. the payment ID/description
 * @returns {Promise<{ id: string, paymentUrl: string, raw: object }>}
 */
export async function createZiinaPaymentIntent({ amount, currency, message }) {
  const { ziina } = getConfig();

  const res = await fetch(`${ziina.baseUrl}/payment_intent`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      amount: Math.round(amount * 100), // Ziina expects the smallest currency unit (fils/cents)
      currency_code: currency,
      message,
      test: Boolean(ziina.testMode),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ziina create payment failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    paymentUrl: data.redirect_url || data.payment_url,
    raw: data,
  };
}

/**
 * Fetches the current status of a Ziina payment intent.
 * Typical statuses: "requires_payment_method", "pending", "completed", "failed", "cancelled".
 */
export async function getZiinaPaymentStatus(paymentIntentId) {
  const { ziina } = getConfig();

  const res = await fetch(`${ziina.baseUrl}/payment_intent/${paymentIntentId}`, {
    method: "GET",
    headers: authHeaders(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ziina status check failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { status: data.status, raw: data };
}

export function isZiinaSuccessStatus(status) {
  return status === "completed" || status === "succeeded";
}
