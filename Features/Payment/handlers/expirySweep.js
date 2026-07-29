// Features/Payment/handlers/expirySweep.js
// Periodically checks for payments that have sat unpaid past the
// configured expiry window and marks them Expired, editing their message
// so customers/staff aren't left looking at a stale "pay now" button.

import getConfig from "../config/config.js";
import { listActivePayments, markExpired } from "../database/paymentStore.js";
import { buildWarningEmbed } from "../embeds/statusEmbeds.js";
import { logEvent } from "../utils/logger.js";

const SWEEP_INTERVAL_MS = 60 * 1000;

export function startExpirySweep(client) {
  setInterval(() => sweep(client).catch((err) => console.error("[Payment] expiry sweep error:", err)), SWEEP_INTERVAL_MS);
}

async function sweep(client) {
  const { paymentExpiryMinutes } = getConfig();
  const expiryMs = paymentExpiryMinutes * 60 * 1000;
  const now = Date.now();

  // We don't know every guildId up front, so pull from all guilds the
  // client is in - listActivePayments filters per guild, so just union them.
  for (const [, guild] of client.guilds.cache) {
    const active = listActivePayments(guild.id);

    for (const payment of active) {
      if (now - payment.createdAt < expiryMs) continue;

      await markExpired(payment.paymentId);

      if (payment.channelId && payment.messageId) {
        try {
          const channel = await client.channels.fetch(payment.channelId);
          const message = await channel.messages.fetch(payment.messageId);
          await message.edit({
            embeds: [buildWarningEmbed("⏱️ Payment Expired", `Payment \`${payment.paymentId}\` expired after ${paymentExpiryMinutes} minutes of inactivity.`)],
            components: [],
          });
        } catch {
          // Message may have been deleted - nothing more to do.
        }
      }

      await logEvent(client, "⏱️ Payment Expired", `**Payment ID:** \`${payment.paymentId}\`\n**Customer:** <@${payment.customerId}>`);
    }
  }
}
