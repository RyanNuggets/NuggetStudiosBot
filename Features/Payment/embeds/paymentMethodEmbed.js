// Features/Payment/embeds/paymentMethodEmbed.js
import { EmbedBuilder } from "discord.js";
import getConfig from "../config/config.js";
import { formatRobux } from "../utils/pricing.js";

/**
 * Shown after Robux is confirmed on the choice screen - lets the customer
 * pick Gamepass or T-Shirt. Currency is no longer relevant here since the
 * Robux amount is fixed and chosen up front (see embeds/choiceEmbeds.js).
 *
 * @param {object} params
 * @param {object} params.payment - the payment record
 */
export function buildPaymentMethodEmbed({ payment }) {
  const { embedColors } = getConfig();
  const robuxDisplay = formatRobux(payment.robuxAmount);

  return new EmbedBuilder()
    .setTitle("Choose your Robux payment type")
    .setColor(embedColors.default)
    .setDescription(
      `**Payment ID:** \`${payment.paymentId}\`\n` +
        `**Customer:** <@${payment.customerId}>\n` +
        (payment.description ? `**Description:** ${payment.description}\n` : "") +
        `\nSelect Gamepass or T-Shirt below.`
    )
    .addFields(
      { name: "🎮 Robux Gamepass", value: robuxDisplay, inline: true },
      { name: "👕 Robux T-Shirt", value: robuxDisplay, inline: true }
    )
    .setFooter({ text: "Paying with Robux • Fixed Robux amount" })
    .setTimestamp();
}
