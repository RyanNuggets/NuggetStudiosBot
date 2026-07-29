// Features/Payment/embeds/paymentMethodEmbed.js
import { EmbedBuilder } from "discord.js";
import getConfig from "../config/config.js";
import { formatCurrency, formatRobux } from "../utils/pricing.js";

/**
 * Builds the "choose your payment method" embed with live-calculated
 * prices for every option, in the given display currency (defaults AED).
 *
 * @param {object} params
 * @param {object} params.payment - the payment record
 * @param {number} params.convertedAmount - the amount in `currency`
 * @param {string} params.currency
 */
export function buildPaymentMethodEmbed({ payment, convertedAmount, currency }) {
  const { embedColors } = getConfig();
  const robuxDisplay = formatRobux(payment.robuxAmount);
  const cashDisplay = formatCurrency(convertedAmount, currency);

  return new EmbedBuilder()
    .setTitle("Choose your payment method")
    .setColor(embedColors.default)
    .setDescription(
      `**Payment ID:** \`${payment.paymentId}\`\n` +
        `**Customer:** <@${payment.customerId}>\n` +
        (payment.description ? `**Description:** ${payment.description}\n` : "") +
        `\nSelect how you'd like to pay below. Prices update automatically if you switch currency.`
    )
    .addFields(
      { name: "🎮 Robux Gamepass", value: robuxDisplay, inline: true },
      { name: "👕 Robux T-Shirt", value: robuxDisplay, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "🍎 Apple Pay", value: cashDisplay, inline: true },
      { name: "🅶 Google Pay", value: cashDisplay, inline: true },
      { name: "💳 Credit/Debit Card", value: cashDisplay, inline: true }
    )
    .setFooter({ text: `Displaying prices in ${currency} • Robux amount is fixed for Roblox payments` })
    .setTimestamp();
}
