// Features/Payment/utils/logger.js
// Sends embeds to configured log channels. Never throws - logging must
// never be the reason a payment flow breaks for a customer.

import { EmbedBuilder } from "discord.js";
import getConfig from "../config/config.js";

/**
 * @param {import('discord.js').Client} client
 * @param {string} event - short event name, e.g. "Payment Created"
 * @param {string} description - markdown body for the embed
 * @param {"payments"|"errors"|"default"} channelKey
 */
export async function logEvent(client, event, description, channelKey = "payments") {
  try {
    const config = getConfig();
    const channelId = config.logChannels[channelKey] || config.logChannels.default;
    if (!channelId) return; // logging not configured, silently skip

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(event)
      .setDescription(description)
      .setColor(channelKey === "errors" ? config.embedColors.danger : config.embedColors.default)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    // Intentionally swallow - see comment above.
    console.error("[Payment] logEvent failed:", err);
  }
}

export async function logError(client, event, err) {
  const message = err?.message || String(err);
  await logEvent(client, `❌ ${event}`, `\`\`\`${message}\`\`\``, "errors");
}
