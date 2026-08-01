// Features/Payment/embeds/paymentGeneratedEmbed.js
import getConfig from "../config/config.js";
import { formatCurrency, formatRobux } from "../utils/pricing.js";
import { buildContainer, Emoji } from "./brand.js";

/**
 * For Robux Gamepass / T-Shirt payments: shows the Robux price and the
 * purchase link.
 *
 * @param {import('discord.js').ActionRowBuilder} actionRow - "I've Paid" button
 */
export function buildRobloxPaymentEmbed({ payment, actionRow }) {
  const { embedColors } = getConfig();

  const content =
    `# ${Emoji.shoppingCart} Complete Your Payment\n` +
    `> Your secure payment link is ready.\n\n` +
    `-# **\`Amount Due\`**   ${Emoji.dot}   **${formatRobux(payment.robuxAmount)}**\n` +
    `-# **\`Payment ID\`**   ${Emoji.dot}   \`${payment.paymentId}\`\n\n` +
    `## ${Emoji.link} Secure Checkout\n` +
    `> **[Click here to pay](${payment.paymentUrl})**\n\n` +
    `> Complete your payment by purchasing the linked **Gamepass** or **Classic T-Shirt**.\n\n` +
    `${Emoji.dot} Press **I've Paid** below to verify your payment automatically.`;

  return buildContainer({ content, accentColorHex: embedColors.default, actionRows: [actionRow] });
}

/**
 * For the grouped online payment method (Card / Apple Pay / Google Pay):
 * shows the converted amount, currency, and the checkout link.
 *
 * @param {import('discord.js').ActionRowBuilder} actionRow - "I've Paid" button
 */
export function buildOnlinePaymentEmbed({ payment, actionRow }) {
  const { embedColors } = getConfig();

  const content =
    `# ${Emoji.shoppingCart} Complete Your Payment\n` +
    `> Your secure payment link is ready.\n\n` +
    `-# **\`Amount Due\`**   ${Emoji.dot}   **${formatCurrency(payment.convertedAmount, payment.currency)}**\n` +
    `-# **\`Payment ID\`**   ${Emoji.dot}   \`${payment.paymentId}\`\n\n` +
    `## ${Emoji.link} Secure Checkout\n` +
    `> **[Click here to pay](${payment.paymentUrl})**\n\n` +
    `> Supports **Visa, Mastercard, Apple Pay,** and **Google Pay**.\n\n` +
    `${Emoji.dot} Press **I've Paid** below to verify your payment automatically.`;

  return buildContainer({ content, accentColorHex: embedColors.default, actionRows: [actionRow] });
}
