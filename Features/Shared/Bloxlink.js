// Features/Shared/Bloxlink.js
// Shared Bloxlink (roblox<->discord linking) client, used by both the
// package system and the order logging system.
//
// Docs: https://blox.link/docs/guild/discord-to-roblox
// Requires a Bloxlink "Server API Key" (Bloxlink dashboard -> Developers),
// and the Bloxlink bot must be present in the guild.
import { MessageFlags } from "discord.js";

const RATE_LIMIT_DELAY = 2000;
const CACHE_TTL_MS = 5 * 60 * 1000;

let requestQueue = [];
let isProcessing = false;

const robloxCache = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const NOT_LINKED_MESSAGE =
  "> Please link your Roblox account with **Bloxlink** (run `/verify` with the Bloxlink bot in this server) and then try again.";

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;

  isProcessing = true;
  const { userId, interaction, KEY, resolve, reject } = requestQueue.shift();

  try {
    const cached = robloxCache.get(userId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      resolve(cached.robloxId);
      isProcessing = false;
      processQueue();
      return;
    }

    const guildId = interaction.guildId;

    const response = await fetch(
      `https://api.blox.link/v4/public/guilds/${guildId}/discord-to-roblox/${userId}`,
      {
        method: "GET",
        headers: {
          Authorization: KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = data.error || "Unknown API error";

      let replyMessage;
      if (response.status === 429) {
        replyMessage = "Rate limit exceeded. Please try again later.";
      } else if (response.status === 401 || response.status === 403) {
        replyMessage = "Error: the Bloxlink API key is invalid, or Bloxlink isn't set up for this server.";
      } else if (response.status === 400 || response.status === 404) {
        replyMessage = NOT_LINKED_MESSAGE;
      } else {
        replyMessage = `API error: ${errorMessage} (Status: ${response.status})`;
      }

      if (interaction.deferred) {
        await interaction.followUp({ content: replyMessage, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: replyMessage, flags: MessageFlags.Ephemeral });
      }

      resolve(null);
    } else if (!data.robloxID) {
      if (interaction.deferred) {
        await interaction.followUp({ content: NOT_LINKED_MESSAGE, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: NOT_LINKED_MESSAGE, flags: MessageFlags.Ephemeral });
      }
      resolve(null);
    } else {
      robloxCache.set(userId, {
        robloxId: data.robloxID,
        expiresAt: now + CACHE_TTL_MS,
      });

      resolve(data.robloxID);
    }
  } catch (error) {
    console.error("Error fetching Roblox info:", error.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Failed to fetch Roblox ID. Please try again later.",
        flags: MessageFlags.Ephemeral,
      });
    } else if (interaction.deferred && !interaction.replied) {
      await interaction.followUp({
        content: "Failed to fetch Roblox ID. Please try again later.",
        flags: MessageFlags.Ephemeral,
      });
    }
    resolve(null);
  }

  await delay(RATE_LIMIT_DELAY);
  isProcessing = false;
  processQueue();
}

// Same lookup, but returns the raw Bloxlink payload (used for group-eligibility
// checks). Does not reply on failure - caller decides what to do.
async function getRobloxFromDiscord(discordId, guildId) {
  const KEY = process.env.BLOXLINK_API_KEY;
  if (!KEY) {
    console.warn("⚠️ Missing BLOXLINK_API_KEY env var.");
    return null;
  }

  try {
    const res = await fetch(`https://api.blox.link/v4/public/guilds/${guildId}/discord-to-roblox/${discordId}`, {
      headers: { Authorization: KEY },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.robloxID) return null;
    return json;
  } catch (error) {
    console.error("Error fetching Roblox info (raw):", error.message);
    return null;
  }
}

async function getRobloxInfo(userId, interaction, KEY) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ userId, interaction, KEY, resolve, reject });
    processQueue();
  });
}

export { getRobloxInfo, getRobloxFromDiscord };
