// Features/Payment/providers/robloxProvider.js
//
// Everything that talks to Roblox directly (as opposed to Bloxlink):
//   - public profile/avatar lookups for the "confirm your account" step
//   - updating the configured gamepass/t-shirt price
//   - building the purchase link the customer clicks
//   - checking whether a Robux sale has actually come through
//
// NOTE ON ROBLOX ENDPOINTS: Roblox's internal economy/game-pass endpoints
// occasionally change shape or path. The endpoints below are correct as of
// writing, but if Roblox returns unexpected 4xx/5xx responses after an
// update on their end, check https://roblox.notion.site (Roblox Studio/API
// docs) or your noblox.js version's own helpers before assuming this file
// is broken - noblox.js often gets updated for exactly this reason, so
// wherever it exposes an equivalent helper, prefer swapping to that.

import noblox from "noblox.js";
import getConfig from "../config/config.js";

// --------- Roblox login (cached) - reused across the whole feature ----------
let loginPromise = null;
async function ensureRobloxLogin() {
  if (loginPromise) return loginPromise;

  const { robloxCookieEnvVar } = getConfig();
  const cookie = process.env[robloxCookieEnvVar];
  if (!cookie) throw new Error(`Missing ${robloxCookieEnvVar} env var.`);

  loginPromise = (async () => noblox.setCookie(cookie))();
  return loginPromise;
}

// --------- CSRF-aware raw request helper for Roblox endpoints noblox.js doesn't cover ----------
async function robloxApiRequest(url, options = {}, _retried = false) {
  const { robloxCookieEnvVar } = getConfig();
  const cookie = process.env[robloxCookieEnvVar];

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Cookie: `.ROBLOSECURITY=${cookie}`,
      ...(options.headers || {}),
    },
  });

  // Roblox requires an X-CSRF-TOKEN on write requests. First attempt gets
  // rejected with 403 and the token in a response header - retry once with it.
  if (res.status === 403 && !_retried) {
    const token = res.headers.get("x-csrf-token");
    if (token) {
      return robloxApiRequest(url, { ...options, headers: { ...(options.headers || {}), "X-CSRF-TOKEN": token } }, true);
    }
  }

  return res;
}

// --------- Public profile lookups (no auth needed) ----------

export async function getRobloxUserProfile(robloxUserId) {
  const res = await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`);
  if (!res.ok) return null;
  return res.json(); // { name, displayName, id, description, created, ... }
}

export async function getRobloxAvatarUrl(robloxUserId) {
  const res = await fetch(
    `https://thumbnails.roblox.com/v1/users/avatar-bust?userIds=${robloxUserId}&size=420x420&format=Png&isCircular=false`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.data?.[0]?.imageUrl || null;
}

// --------- Pricing updates ----------

/**
 * Updates the configured t-shirt's price using noblox.js (matches the
 * bot's existing shirt-price command).
 */
export async function updateTshirtPrice(newPrice) {
  const { tshirtId } = getConfig();
  if (!tshirtId) throw new Error("Missing config.payment.tshirtId");

  await ensureRobloxLogin();

  const infoBefore = await noblox.getProductInfo(tshirtId);
  const name = infoBefore?.Name ?? infoBefore?.name ?? "Untitled";
  const description = infoBefore?.Description ?? infoBefore?.description ?? "";

  await noblox.configureItem(tshirtId, name, description, undefined, newPrice, undefined);

  const infoAfter = await noblox.getProductInfo(tshirtId);
  return { assetId: tshirtId, name, before: infoBefore?.PriceInRobux ?? null, after: infoAfter?.PriceInRobux ?? null };
}

/**
 * Updates the configured gamepass's price. Uses Roblox's Game Passes API
 * directly since noblox.js's gamepass-pricing helper name varies across
 * versions - check your installed version for `updateGamepassPrice` or
 * similar and prefer that if present, it'll be more resilient to Roblox
 * API changes than the raw call below.
 */
export async function updateGamepassPrice(newPrice) {
  const { gamepassId } = getConfig();
  if (!gamepassId) throw new Error("Missing config.payment.gamepassId");

  await ensureRobloxLogin();

  const res = await robloxApiRequest(`https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}/details`, {
    method: "PATCH",
    body: JSON.stringify({ price: newPrice, isForSale: true }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to update gamepass price (${res.status}): ${body}`);
  }

  return { gamepassId, after: newPrice };
}

// --------- Purchase links ----------

export function buildGamepassPurchaseLink(gamepassId) {
  return `https://www.roblox.com/game-pass/${gamepassId}/x`;
}

export function buildTshirtPurchaseLink(tshirtId) {
  return `https://www.roblox.com/catalog/${tshirtId}/x`;
}

// --------- Payment verification ----------

/**
 * Checks whether the bot's account has received a Robux sale from
 * `robloxUserId` for `assetId` (gamepass or t-shirt) at/after `sinceMs`.
 *
 * Uses Roblox's transactions endpoint for the receiving account. Requires
 * the bot's Roblox cookie to belong to the account that owns the
 * gamepass/t-shirt (i.e. the one actually receiving the Robux).
 */
export async function verifyRobuxPaymentReceived({ assetId, robloxUserId, sinceMs }) {
  await ensureRobloxLogin();
  const currentUser = await noblox.getCurrentUser();

  const res = await robloxApiRequest(
    `https://economy.roblox.com/v2/users/${currentUser.id}/transactions?transactionType=Sale&limit=100`,
    { method: "GET" }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch transactions (${res.status})`);
  }

  const data = await res.json();
  const transactions = data?.data ?? [];

  const match = transactions.find((tx) => {
    const txAssetId = tx?.details?.id;
    const txBuyerId = tx?.agent?.id;
    const txCreated = new Date(tx?.created).getTime();

    return (
      String(txAssetId) === String(assetId) &&
      String(txBuyerId) === String(robloxUserId) &&
      (!sinceMs || txCreated >= sinceMs)
    );
  });

  return { received: Boolean(match), transaction: match ?? null };
}
