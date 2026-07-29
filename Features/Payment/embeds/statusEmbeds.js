// Features/Payment/embeds/statusEmbeds.js
import { EmbedBuilder } from "discord.js";
import getConfig from "../config/config.js";

export function buildErrorEmbed(message) {
  const { embedColors } = getConfig();
  return new EmbedBuilder().setTitle("❌ Something went wrong").setDescription(message).setColor(embedColors.danger);
}

export function buildWarningEmbed(title, message) {
  const { embedColors } = getConfig();
  return new EmbedBuilder().setTitle(title).setDescription(message).setColor(embedColors.warning);
}

export function buildPendingRobloxPaymentEmbed({ existingPayment, jumpLink }) {
  const { embedColors } = getConfig();
  return new EmbedBuilder()
    .setTitle("⚠️ A Roblox payment is already pending")
    .setColor(embedColors.warning)
    .setDescription(
      `Only one Robux Gamepass/T-Shirt payment can be active at a time.\n\n` +
        `**Existing Payment:** \`${existingPayment.paymentId}\`\n` +
        `**Customer:** <@${existingPayment.customerId}>\n` +
        `**Status:** ${existingPayment.status}\n\n` +
        `[Jump to the existing payment](${jumpLink})\n\n` +
        `That payment must be completed or expired (use \`/forceexpirepayment\`) before another Roblox payment can be created. ` +
        `This restriction does not apply to Apple Pay, Google Pay, or Card payments.`
    );
}

export function buildPaymentNotDetectedEmbed() {
  const { embedColors } = getConfig();
  return new EmbedBuilder()
    .setTitle("Payment not detected yet")
    .setColor(embedColors.warning)
    .setDescription("We haven't detected your payment yet. This can take a minute - please try again shortly, or contact staff if this persists.");
}
