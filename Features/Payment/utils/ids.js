// Features/Payment/utils/ids.js
import crypto from "crypto";

/**
 * Generates a short, human-readable payment ID, e.g. "PAY-9F3K2A".
 * Not cryptographically significant - just needs to be unique enough
 * for a small/medium volume of payments and easy to read/search in logs.
 */
export function generatePaymentId() {
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `PAY-${random}`;
}
