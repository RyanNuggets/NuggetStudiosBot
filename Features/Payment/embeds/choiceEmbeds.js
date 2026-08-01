// Features/Payment/embeds/choiceEmbeds.js
import getConfig from "../config/config.js";
import { formatCurrency, formatRobux } from "../utils/pricing.js";
import { buildContainer, Emoji } from "./brand.js";

/**
 * First screen shown after a customer is picked: choose Robux or a
 * currency. `actionRow` is the select menu from
 * buttons/currencySelectMenu.js.
 */
export function buildCurrencyChoiceEmbed({ payment, actionRow }) {
  const { embedColors } = getConfig();

  const content =
    `# ${Emoji.greenCheck} How would you like to pay?\n` +
    `> Ready to complete your purchase?\n\n` +
    `-# **\`Customer\`**   ${Emoji.dot}   <@${payment.customerId}>\n` +
    `-# **\`Payment ID\`**   ${Emoji.dot}   \`${payment.paymentId}\`\n` +
    `## Choose a Payment Method\n` +
    `${Emoji.robux} __Robux__\n` +
    `> Pay instantly using a Gamepass or Classic T-Shirt.\n\n` +
    `${Emoji.creditCard} __Credit / Debit Card__\n` +
    `> Visa, Mastercard, Apple Pay & Google Pay.`;

  return buildContainer({ content, accentColorHex: embedColors.default, actionRows: [actionRow] });
}

/**
 * Confirm/back screen shown after picking Robux or a currency. One
 * template covers both paths - only the closing "Supports ..." line and
 * the amount shown change depending on `value`.
 *
 * @param {object} params
 * @param {object} params.payment
 * @param {"ROBUX"|"AED"|"USD"|"EUR"|"GBP"} params.value
 * @param {number} [params.convertedAmount] - required when value isn't "ROBUX"
 * @param {import('discord.js').ActionRowBuilder} params.actionRow - Confirm/Back buttons
 */
export function buildChoiceConfirmEmbed({ payment, value, convertedAmount, actionRow }) {
  const { embedColors } = getConfig();
  const isRobux = value === "ROBUX";

  const priceDisplay = isRobux ? formatRobux(payment.robuxAmount) : formatCurrency(convertedAmount, value);
  const supportsLine = isRobux
    ? "Supports **Gamepass** and **Classic T-Shirt** purchases."
    : "Supports **Visa, Mastercard, Apple Pay,** and **Google Pay**.";

  const content =
    `# ${Emoji.wallet} Confirm Payment\n` +
    `> Review your payment before continuing.\n\n` +
    `-# **\`Payment ID\`**   ${Emoji.dot}   \`${payment.paymentId}\`\n` +
    `## Amount Due\n` +
    `${Emoji.dot}**${priceDisplay}**\n\n` +
    `> Press **Confirm** to generate your secure payment link, or go back to change your currency.\n\n` +
    `> ${supportsLine}`;

  return buildContainer({ content, accentColorHex: embedColors.warning, actionRows: [actionRow] });
}

/**
 * Service agreement gate - shown after the choice is confirmed, before
 * anything is actually generated.
 *
 * @param {import('discord.js').ActionRowBuilder} actionRow - Read/I Agree/Back buttons
 */
export function buildTosAgreementEmbed({ payment, actionRow }) {
  const { embedColors } = getConfig();

  const content =
    `# ${Emoji.document} Service Agreement\n` +
    `> Please review our terms before continuing.\n\n` +
    `-# **\`Payment ID\`** ${Emoji.dot} \`${payment.paymentId}\`\n\n` +
    `## ${Emoji.shield} Before You Continue\n` +
    `> By selecting **I Agree**, you confirm that you've read and accepted the **Nugget Studios Service Agreement** and wish to proceed with your payment.\n\n` +
    `> If you'd like to use a different payment method, press **Back** below.`;

  return buildContainer({ content, accentColorHex: embedColors.warning, actionRows: [actionRow] });
}
