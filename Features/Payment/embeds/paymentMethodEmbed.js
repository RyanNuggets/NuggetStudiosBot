// Features/Payment/embeds/paymentMethodEmbed.js
import getConfig from "../config/config.js";
import { buildContainer, Emoji } from "./brand.js";

/**
 * Shown after Robux + the service agreement are confirmed - lets the
 * customer pick Gamepass or T-Shirt.
 *
 * @param {import('discord.js').ActionRowBuilder} actionRow - Gamepass/T-Shirt select menu
 */
export function buildPaymentMethodEmbed({ payment, actionRow }) {
  const { embedColors } = getConfig();

  const content =
    `# ${Emoji.greenCheck} Choose Your Robux Payment\n` +
    `> Select how you'd like to pay with Robux.\n\n` +
    `-# **\`Customer\`**   ${Emoji.dot}   <@${payment.customerId}>\n` +
    `-# **\`Payment ID\`**   ${Emoji.dot}   \`${payment.paymentId}\`\n` +
    `## Choose a Payment Method\n` +
    `${Emoji.ticket} __Gamepass__\n` +
    `> Available for Roblox accounts **16 years or older**.\n\n` +
    `${Emoji.shirt} __Classic T-Shirt__\n` +
    `> Available for Roblox accounts **under 16 years old**.`;

  return buildContainer({ content, accentColorHex: embedColors.default, actionRows: [actionRow] });
}
