// Features/Payment/providers/bloxlinkProvider.js
// Thin wrapper around the Bloxlink v4 public API, scoped to what the
// payment feature needs (looking up a customer's linked Roblox account).

import getConfig from "../config/config.js";

const BASE_URL = "https://api.blox.link/v4/public";

async function bloxlinkRequest(pathSuffix, options = {}) {
  const { bloxlinkApiKey } = getConfig();
  if (!bloxlinkApiKey) {
    return { ok: false, status: 0, data: null, error: new Error("Missing bloxlinkApiKey in config.json") };
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${pathSuffix}`, {
      ...options,
      headers: {
        Authorization: bloxlinkApiKey,
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // no/invalid JSON body
  }

  return { ok: res.ok, status: res.status, data, error: null };
}

/**
 * Forward lookup: Discord user ID -> linked Roblox ID, for this guild.
 * @returns {Promise<{ linked: boolean, robloxId: string|null }>}
 */
export async function getLinkedRobloxId(guildId, discordUserId) {
  const result = await bloxlinkRequest(`/guilds/${guildId}/discord-to-roblox/${discordUserId}`);
  if (result.ok && result.data?.robloxID) {
    return { linked: true, robloxId: result.data.robloxID };
  }
  return { linked: false, robloxId: null };
}
