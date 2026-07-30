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
//
// GAMEPASS PRICING SPECIFICALLY now goes through Roblox's Open Cloud Game
// Passes API (see updateGamepassPrice below) using an Open Cloud API key,
// not the .ROBLOSECURITY cookie - Roblox deprecated the old cookie-based
// path for this one endpoint.

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
 * Updates the configured gamepass's price.
 *
 * Roblox moved this specific endpoint to their Open Cloud "Game Passes v1"
 * API, scoped per-universe. It no longer accepts the .ROBLOSECURITY cookie
 * + CSRF flow that still works for other endpoints in this file (e.g. the
 * economy/transactions call below) - it wants an Open Cloud API key sent
 * as `x-api-key`, and the body is form-data rather than JSON. Using the old
 * cookie-based approach here is what caused the 404s.
 *
 * The API key needs to be created in the Creator Hub for the experience
 * that owns the gamepass, scoped to that universe, with Game Passes
 * read & write access. Set its value in `ROBLOX_OPEN_CLOUD_KEY` (or
 * whatever `robloxApiKeyEnvVar` points to), and set `universeId` in the
 * payment config to that experience's universe ID.
 */
export async function updateGamepassPrice(newPrice) {
  const { gamepassId, universeId, robloxApiKeyEnvVar } = getConfig();
  if (!gamepassId) throw new Error("Missing config.payment.gamepassId");
  if (!universeId) throw new Error("Missing config.payment.universeId");

  const apiKey = process.env[robloxApiKeyEnvVar];
  if (!apiKey) throw new Error(`Missing ${robloxApiKeyEnvVar} env var (Roblox Open Cloud API key).`);

  const url = `https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes/${gamepassId}`;

  const form = new FormData();
  form.append("price", String(newPrice));

  const res = await fetch(url, {
    method: "PATCH",
    headers: { "x-api-key": apiKey },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to update gamepass price (${res.status}): ${body}`);
  }

  return { gamepassId, after: newPrice };
}

/**
 * Updates the configured t-shirt's price.
 *
 * noblox.js's `configureItem()` is broken against current Roblox behavior
 * (see https://github.com/noblox/noblox.js/issues/836) - Roblox folded
 * clothing into their newer "collectibles" configuration system, which
 * noblox never picked up. There's no Open Cloud equivalent for this yet
 * (unlike gamepasses), so this calls Roblox's own internal endpoint
 * directly, captured from the network tab on the item's Configure page.
 * That endpoint only accepts PATCH (a GET on the same path 404s), so there's
 * no clean way to read the current config back from Roblox first.
 *
 * That endpoint is keyed by a GUID ("collectible item ID"), not the
 * t-shirt's numeric asset ID - it's a different identifier system and
 * doesn't change for a given item, so it's stored once in config
 * (`tshirtCollectibleId`) rather than resolved on every call.
 *
 * The endpoint uses "price floor + amount above floor" rather than a single
 * final price (Roblox's 70%-creator-share marketplace change). For basic
 * clothing (t-shirts/shirts/pants) the floor is a fixed platform constant
 * of 1 Robux - not something Roblox varies per item the way it can for
 * limited/UGC accessories - so it's hardcoded below rather than fetched.
 * If Roblox ever changes that constant, bump `TSHIRT_PRICE_FLOOR`.
 */
const TSHIRT_PRICE_FLOOR = 1;

export async function updateTshirtPrice(newFinalPrice) {
  const { tshirtCollectibleId } = getConfig();
  if (!tshirtCollectibleId) throw new Error("Missing config.payment.tshirtCollectibleId");

  await ensureRobloxLogin();

  const url = `https://itemconfiguration.roblox.com/v1/collectibles/${tshirtCollectibleId}`;

  const priceFloor = TSHIRT_PRICE_FLOOR;
  const priceOffset = Math.max(0, newFinalPrice - priceFloor);

  const body = {
    saleLocationConfiguration: { saleLocationType: 1, places: [] },
    saleStatus: 0,
    quantityLimitPerUser: 0,
    resaleRestriction: 2,
    priceInRobux: priceFloor,
    priceOffset,
    optOutFromRegionalPricing: true,
    isFree: false,
  };

  const patchRes = await robloxApiRequest(url, { method: "PATCH", body: JSON.stringify(body) });

  if (!patchRes.ok) {
    const errBody = await patchRes.text().catch(() => "");
    throw new Error(`Failed to update t-shirt price (${patchRes.status}): ${errBody}`);
  }

  return { tshirtCollectibleId, priceFloor, priceOffset, after: priceFloor + priceOffset };
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
 * Checks whether the Roblox Group that owns the gamepass/t-shirt has
 * received a Robux sale from `robloxUserId` for `assetId` at/after `sinceMs`.
 *
 * Uses Roblox's GROUP transactions endpoint, since the gamepass/t-shirt are
 * owned by the group, not the bot's personal account - sales pay out to the
 * group's Robux balance, so checking the bot account's own transactions
 * would never find them. Requires the bot's Roblox cookie to belong to an
 * account with permission to view the group's revenue/transactions (e.g.
 * the group owner, or a role with the "View group payouts"/analytics
 * permission).
 */
export async function verifyRobuxPaymentReceived({ assetId, robloxUserId, sinceMs }) {
  const { groupId } = getConfig();
  if (!groupId) throw new Error("Missing config.payment.groupId");

  await ensureRobloxLogin();

  const res = await robloxApiRequest(
    `https://economy.roblox.com/v2/groups/${groupId}/transactions?transactionType=Sale&limit=100`,
    { method: "GET" }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to fetch transactions (${res.status}): ${body}`);
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
