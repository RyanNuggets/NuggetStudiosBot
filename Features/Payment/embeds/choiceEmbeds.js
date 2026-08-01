// Features/Payment/embeds/choiceEmbeds.js
import { EmbedBuilder } from "discord.js";
import getConfig from "../config/config.js";
import { formatCurrency, formatRobux } from "../utils/pricing.js";

/**
 * First screen shown after a customer is picked: choose Robux or a currency.
 */
export function buildCurrencyChoiceEmbed({ payment }) {
  const { embedColors } = getConfig();

  return new EmbedBuilder()
    .setTitle("How would you like to pay?")
    .setColor(embedColors.default)
    .setDescription(
      `**Payment ID:** \`${payment.paymentId}\`\n` +
        `**Customer:** <@${payment.customerId}>\n` +
        (payment.description ? `**Description:** ${payment.description}\n` : "") +
        `**Robux Amount:** ${formatRobux(payment.robuxAmount)}\n\n` +
        `Choose **Robux** below to pay via Gamepass/T-Shirt, or pick a currency to pay by card / Apple Pay / Google Pay.`
    )
    .setTimestamp();
}

/**
 * Confirm/back screen after picking Robux.
 */
export function buildRobuxChoiceConfirmEmbed({ payment }) {
  const { embedColors } = getConfig();

  return new EmbedBuilder()
    .setTitle("Pay with Robux?")
    .setColor(embedColors.warning)
    .setDescription(
      `**Payment ID:** \`${payment.paymentId}\`\n` +
        `**Amount:** ${formatRobux(payment.robuxAmount)}\n\n` +
        `Confirm to continue with a Robux Gamepass/T-Shirt purchase, or go back to change your choice.`
    );
}

/**
 * Confirm/back screen after picking a currency - previews the converted
 * amount before anything is generated.
 */
export function buildCurrencyChoiceConfirmEmbed({ payment, currency, convertedAmount }) {
  const { embedColors } = getConfig();

  return new EmbedBuilder()
    .setTitle(`Pay ${formatCurrency(convertedAmount, currency)}?`)
    .setColor(embedColors.warning)
    .setDescription(
      `**Payment ID:** \`${payment.paymentId}\`\n` +
        `**Amount:** ${formatCurrency(convertedAmount, currency)}\n\n` +
        `Confirm to generate a card / Apple Pay / Google Pay payment link in **${currency}**, or go back to change your currency.`
    );
}

/**
 * Service agreement gate - shown after the Robux/currency choice is
 * confirmed, before anything is actually generated (Gamepass/T-Shirt
 * select, or the online payment link).
 */
export function buildTosAgreementEmbed({ payment, value }) {
  const { embedColors } = getConfig();
  const payingWith = value === "ROBUX" ? formatRobux(payment.robuxAmount) : `${value} (via card / Apple Pay / Google Pay)`;

  return new EmbedBuilder()
    .setTitle("Service Agreement")
    .setColor(embedColors.warning)
    .setDescription(
      `**Payment ID:** \`${payment.paymentId}\`\n` +
        `**Paying with:** ${payingWith}\n\n` +
        `Before continuing, please read our [Service Agreement](https://nuggetstudios.xyz/tos).\n\n` +
        `Click **I Agree** below to confirm you've read and accept it and continue, or **Back** to change your payment choice.`
    );
}
