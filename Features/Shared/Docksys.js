// Features/Shared/Docksys.js
// Shared Docksys (roblox<->discord linking) client, used by both the
// package system and the order logging system.
import { MessageFlags } from "discord.js";

const RATE_LIMIT_DELAY = 2000;
const CACHE_TTL_MS = 5 * 60 * 1000;

let requestQueue = [];
let isProcessing = false;

const robloxCache = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      `https://api.docksys.xyz/api/v1/public/discord-to-roblox?discordId=${userId}&guildId=${guildId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error || "Unknown API error";

      let replyMessage;
      if (errorData.status === 429) {
        replyMessage = "Rate limit exceeded. Please try again later.";
      } else if (errorData.status === 403) {
        replyMessage = "Error: Bot is not in the specified guild.";
      } else if (errorData.status === 400) {
        replyMessage = "Error: Missing required parameters. Please check the input.";
      } else {
        replyMessage = `API error: ${errorMessage} (Status: ${errorData.status})`;
      }

      if (interaction.deferred) {
        await interaction.followUp({ content: replyMessage, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: replyMessage, flags: MessageFlags.Ephemeral });
      }

      resolve(null);
    } else {
      const data = await response.json();

      if (!data.data || !data.data.robloxId) {
        const replyMessage = `> Please link your Roblox account to your Discord account [**here**](https://api.docksys.xyz/v1/api/verify/discord) and then try again.`;
        if (interaction.deferred) {
          await interaction.followUp({ content: replyMessage, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: replyMessage, flags: MessageFlags.Ephemeral });
        }
        resolve(null);
      } else {
        robloxCache.set(userId, {
          robloxId: data.data.robloxId,
          expiresAt: now + CACHE_TTL_MS,
        });

        resolve(data.data.robloxId);
      }
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

// Same lookup, but returns the full docksys payload (used for group-eligibility
// checks). Does not reply on failure - caller decides what to do.
async function getRobloxFromDiscord(discordId, guildId) {
  const KEY = process.env.DOCKSYS_API_KEY;
  if (!KEY) {
    console.warn("⚠️ Missing DOCKSYS_API_KEY env var.");
    return null;
  }

  try {
    const res = await fetch(
      `https://api.docksys.xyz/api/v1/public/discord-to-roblox?discordId=${discordId}&guildId=${guildId}`,
      { headers: { Authorization: `Bearer ${KEY}` } }
    );
    const json = await res.json().catch(() => null);
    if (!json || json.status !== 200) return null;
    return json.data;
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
