// Features/Payment/embeds/statusEmbeds.js
import { EmbedBuilder } from "discord.js";
import getConfig from "../config/config.js";
import { Emoji, buildContainer } from "./brand.js";

// buildErrorEmbed/buildWarningEmbed stay as plain embeds - they're system-
// level error notices (failed API calls, etc.), not part of the branded
// customer-facing payment journey, so they don't need the full container
// treatment.
export function buildErrorEmbed(message) {
  const { embedColors } = getConfig();
  return new EmbedBuilder().setTitle("❌ Something went wrong").setDescription(message).setColor(embedColors.danger);
}

export function buildWarningEmbed(title, message) {
  const { embedColors } = getConfig();
  return new EmbedBuilder().setTitle(title).setDescription(message).setColor(embedColors.warning);
}

/**
 * No Discohook template was provided for this one - built to match the
 * style of the ones that were (same conventions, brand accent color,
 * footer banner).
 */
export function buildPendingRobloxPaymentEmbed({ existingPayment, jumpLink }) {
  const { embedColors } = getConfig();

  const content =
    `# ⚠️ A Roblox Payment Is Already Pending\n` +
    `> Only one Robux Gamepass/T-Shirt payment can be active at a time.\n\n` +
    `-# **\`Existing Payment\`**   ${Emoji.dot}   \`${existingPayment.paymentId}\`\n` +
    `-# **\`Customer\`**   ${Emoji.dot}   <@${existingPayment.customerId}>\n` +
    `-# **\`Status\`**   ${Emoji.dot}   ${existingPayment.status}\n\n` +
    `> **[Jump to the existing payment](${jumpLink})**\n\n` +
    `> That payment must be completed or expired (use \`/payment diagnose\`) before another Roblox payment can be created. ` +
    `This restriction does not apply to Apple Pay, Google Pay, or Card payments.`;

  return buildContainer({ content, accentColorHex: embedColors.warning });
}

/**
 * Shown when a payment auto-expires (see handlers/expirySweep.js). No
 * Discohook template was provided for this one - matches the same style.
 */
export function buildPaymentExpiredEmbed({ payment, minutes }) {
  const { embedColors } = getConfig();

  const content =
    `# ⏱️ Payment Expired\n` +
    `> This payment expired after ${minutes} minute(s) of inactivity.\n\n` +
    `-# **\`Payment ID\`**   ${Emoji.dot}   \`${payment.paymentId}\``;

  return buildContainer({ content, accentColorHex: embedColors.danger });
}

/**
 * No Discohook template was provided for this one either - same approach.
 */
export function buildPaymentNotDetectedEmbed() {
  const { embedColors } = getConfig();

  const content =
    `# ⏳ Payment Not Detected Yet\n` +
    `> We haven't detected your payment yet. This can take a minute - please try again shortly, or contact staff if this persists.`;

  return buildContainer({ content, accentColorHex: embedColors.warning });
}
