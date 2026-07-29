// Features/Payment/providers/paypalProvider.js
// Wraps PayPal's Orders v2 API (Checkout with card funding) for the
// Credit/Debit Card payment method.
// Docs: https://developer.paypal.com/docs/api/orders/v2/

import getConfig from "../config/config.js";

function baseUrl() {
  const { paypal } = getConfig();
  return paypal.mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const { paypal } = getConfig();
  if (!paypal.clientId || !paypal.clientSecret) {
    throw new Error("Missing config.payment.paypal.clientId/clientSecret");
  }

  const basicAuth = Buffer.from(`${paypal.clientId}:${paypal.clientSecret}`).toString("base64");

  const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PayPal auth failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000; // refresh a minute early
  return cachedToken;
}

/**
 * Creates a PayPal order for the given amount/currency and returns the
 * customer-facing approval link.
 * @param {object} params
 * @param {number} params.amount
 * @param {"USD"|"EUR"|"GBP"|"AED"} params.currency - note: PayPal does not
 *   support AED for checkout as of writing; route AED card payments through
 *   Ziina instead, or convert to USD before creating the order.
 * @param {string} params.description
 * @param {string} params.paymentId - your internal payment ID, stored as PayPal's custom_id for reconciliation
 */
export async function createPaypalOrder({ amount, currency, description, paymentId }) {
  const token = await getAccessToken();

  const res = await fetch(`${baseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: paymentId,
          description: description || `Payment ${paymentId}`,
          amount: {
            currency_code: currency,
            value: amount.toFixed(2),
          },
        },
      ],
      application_context: {
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PayPal create order failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const approveLink = data.links?.find((l) => l.rel === "approve")?.href;

  return { id: data.id, paymentUrl: approveLink, raw: data };
}

/**
 * Checks an order's status. Statuses: "CREATED", "SAVED", "APPROVED",
 * "VOIDED", "COMPLETED", "PAYER_ACTION_REQUIRED".
 * Once the customer has approved on PayPal's side (status becomes
 * APPROVED), it must be captured before it's actually COMPLETED.
 */
export async function getPaypalOrderStatus(orderId) {
  const token = await getAccessToken();

  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${orderId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PayPal status check failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { status: data.status, raw: data };
}

/**
 * Captures an approved order. Call this once getPaypalOrderStatus reports
 * "APPROVED" - only then is the money actually taken.
 */
export async function capturePaypalOrder(orderId) {
  const token = await getAccessToken();

  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PayPal capture failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { status: data.status, raw: data };
}

export function isPaypalSuccessStatus(status) {
  return status === "COMPLETED";
}
