// Features/Payment/handlers/paymentChoiceHandler.js
//
// The very first step after a customer is picked for a payment: choose
// Robux (Gamepass/T-Shirt) or a real-world currency (Card / Apple Pay /
// Google Pay), then confirm that choice before anything is generated.
//
//   choice select -> confirm/back screen -> (Robux: method select) | (currency: link generated)

import { MessageFlags } from "discord.js";
import { CustomId } from "../config/constants.js";
import { getPayment, findActiveRobloxPayment } from "../database/paymentStore.js";
import { buildCurrencyChoiceSelect } from "../buttons/currencySelectMenu.js";
import { buildChoiceConfirmButtons } from "../buttons/choiceConfirmButtons.js";
import {
  buildCurrencyChoiceEmbed,
  buildRobuxChoiceConfirmEmbed,
  buildCurrencyChoiceConfirmEmbed,
} from "../embeds/choiceEmbeds.js";
import { buildPaymentMethodEmbed } from "../embeds/paymentMethodEmbed.js";
import { buildPaymentMethodSelect } from "../buttons/paymentMethodComponents.js";
import { buildPendingRobloxPaymentEmbed, buildErrorEmbed } from "../embeds/statusEmbeds.js";
import { buildPricingBreakdown } from "../utils/pricing.js";
import { generateOnlinePaymentLink } from "./onlinePaymentHandler.js";
import { logEvent } from "../utils/logger.js";

export function isChoiceSelect(interaction) {
  return interaction.isStringSelectMenu?.() && interaction.customId.startsWith(`${CustomId.CHOICE_SELECT}:`);
}
export function isChoiceConfirm(interaction) {
  return interaction.isButton?.() && interaction.customId.startsWith(`${CustomId.CHOICE_CONFIRM}:`);
}
export function isChoiceBack(interaction) {
  return interaction.isButton?.() && interaction.customId.startsWith(`${CustomId.CHOICE_BACK}:`);
}

export async function handleChoiceSelect(client, interaction) {
  const paymentId = interaction.customId.split(":")[3];
  const value = interaction.values[0]; // "ROBUX" or a currency code

  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.update({ content: "This payment session no longer exists.", embeds: [], components: [] });
  }

  if (value === "ROBUX") {
    return interaction.update({
      content: null,
      embeds: [buildRobuxChoiceConfirmEmbed({ payment })],
      components: [buildChoiceConfirmButtons(paymentId, value)],
    });
  }

  // Currency path - preview the converted amount before confirming.
  await interaction.deferUpdate();
  try {
    const pricing = await buildPricingBreakdown(payment.robuxAmount, value);
    await interaction.message.edit({
      content: null,
      embeds: [buildCurrencyChoiceConfirmEmbed({ payment, currency: value, convertedAmount: pricing.amount })],
      components: [buildChoiceConfirmButtons(paymentId, value)],
    });
  } catch (err) {
    await interaction.followUp({
      embeds: [buildErrorEmbed(`Failed to calculate pricing: ${err.message}`)],
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleChoiceBack(client, interaction) {
  const paymentId = interaction.customId.split(":")[3];
  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.update({ content: "This payment session no longer exists.", embeds: [], components: [] });
  }

  await interaction.update({
    content: null,
    embeds: [buildCurrencyChoiceEmbed({ payment })],
    components: [buildCurrencyChoiceSelect(paymentId)],
  });
}

export async function handleChoiceConfirm(client, interaction) {
  const parts = interaction.customId.split(":"); // pay:choice:confirm:{paymentId}:{value}
  const paymentId = parts[3];
  const value = parts[4];

  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.update({ content: "This payment session no longer exists.", embeds: [], components: [] });
  }

  if (value === "ROBUX") {
    // Enforce: only one pending Roblox payment at a time.
    const active = findActiveRobloxPayment(payment.guildId);
    if (active && active.paymentId !== payment.paymentId) {
      const jumpLink = `https://discord.com/channels/${payment.guildId}/${active.channelId}/${active.messageId}`;
      return interaction.reply({
        embeds: [buildPendingRobloxPaymentEmbed({ existingPayment: active, jumpLink })],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.update({
      content: null,
      embeds: [buildPaymentMethodEmbed({ payment })],
      components: [buildPaymentMethodSelect(paymentId)],
    });

    await logEvent(client, "🎮 Robux Path Chosen", `**Payment ID:** \`${paymentId}\``);
    return;
  }

  // Currency confirmed - generate the online payment link directly.
  await interaction.deferUpdate();
  await generateOnlinePaymentLink(client, interaction, paymentId, value);
}
