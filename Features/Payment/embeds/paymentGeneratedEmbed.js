// Features/Payment/embeds/paymentGeneratedEmbed.js
import { EmbedBuilder } from "discord.js";
import getConfig from "../config/config.js";
import { formatCurrency, formatRobux } from "../utils/pricing.js";

/**
 * For Robux Gamepass / T-Shirt payments: shows the item, Robux price, and
 * the purchase link.
 */
export function buildRobloxPaymentEmbed({ payment }) {
  const { embedColors } = getConfig();

  return new EmbedBuilder()
    .setTitle(`Pay with ${payment.method}`)
    .setColor(embedColors.default)
    .setDescription(
      `Click the link below to complete your purchase on Roblox, then press **I've Paid**.\n\n` +
        `**Item:** ${payment.method}\n` +
        `**Price:** ${formatRobux(payment.robuxAmount)}\n` +
        `**Purchase Link:** [Click here to pay](${payment.paymentUrl})`
    )
    .setFooter({ text: `Payment ID: ${payment.paymentId}` });
}

/**
 * For the grouped online payment method (Card / Apple Pay / Google Pay):
 * shows the converted amount, currency, and the checkout link.
 */
export function buildOnlinePaymentEmbed({ payment }) {
  const { embedColors } = getConfig();

  return new EmbedBuilder()
    .setTitle(`Pay with ${payment.method}`)
    .setColor(embedColors.default)
    .setDescription(
      `Click the link below to complete your payment, then press **I've Paid**.\n\n` +
        `**Amount:** ${formatCurrency(payment.convertedAmount, payment.currency)}\n` +
        `**Payment Link:** [Click here to pay](${payment.paymentUrl})`
    )
    .setFooter({ text: `Payment ID: ${payment.paymentId}` });
}
