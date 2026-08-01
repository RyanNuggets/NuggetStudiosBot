// Features/Payment/handlers/paymentChoiceHandler.js
//
// The very first step after a customer is picked for a payment: choose
// Robux (Gamepass/T-Shirt) or a real-world currency (Card / Apple Pay /
// Google Pay), then confirm that choice, then agree to the service
// agreement, before anything is actually generated.
//
//   choice select -> confirm/back -> service agreement -> (Robux: method select) | (currency: link generated)

import { MessageFlags } from "discord.js";
import { CustomId } from "../config/constants.js";
import { getPayment, updatePayment, findActiveRobloxPayment } from "../database/paymentStore.js";
import { buildCurrencyChoiceSelect } from "../buttons/currencySelectMenu.js";
import { buildChoiceConfirmButtons } from "../buttons/choiceConfirmButtons.js";
import { buildTosAgreementButtons } from "../buttons/tosAgreementButtons.js";
import { buildCurrencyChoiceEmbed, buildChoiceConfirmEmbed, buildTosAgreementEmbed } from "../embeds/choiceEmbeds.js";
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
export function isTosAgree(interaction) {
  return interaction.isButton?.() && interaction.customId.startsWith(`${CustomId.TOS_AGREE}:`);
}

function componentsV2(container, extraFlags = 0) {
  return { flags: MessageFlags.IsComponentsV2 | extraFlags, components: [container] };
}

export async function handleChoiceSelect(client, interaction) {
  const paymentId = interaction.customId.split(":")[3];
  const value = interaction.values[0]; // "ROBUX" or a currency code

  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.update({ content: "This payment session no longer exists.", components: [] });
  }

  if (value === "ROBUX") {
    const buttons = buildChoiceConfirmButtons(paymentId, value);
    const container = buildChoiceConfirmEmbed({ payment, value, actionRow: buttons });
    return interaction.update(componentsV2(container));
  }

  // Currency path - preview the converted amount before confirming.
  await interaction.deferUpdate();
  try {
    const pricing = await buildPricingBreakdown(payment.robuxAmount, value);
    const buttons = buildChoiceConfirmButtons(paymentId, value);
    const container = buildChoiceConfirmEmbed({ payment, value, convertedAmount: pricing.amount, actionRow: buttons });
    await interaction.message.edit(componentsV2(container));
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
    return interaction.update({ content: "This payment session no longer exists.", components: [] });
  }

  const select = buildCurrencyChoiceSelect(paymentId);
  const container = buildCurrencyChoiceEmbed({ payment, actionRow: select });
  await interaction.update(componentsV2(container));
}

export async function handleChoiceConfirm(client, interaction) {
  const parts = interaction.customId.split(":"); // pay:choice:confirm:{paymentId}:{value}
  const paymentId = parts[3];
  const value = parts[4];

  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.update({ content: "This payment session no longer exists.", components: [] });
  }

  // Require agreeing to the service agreement before anything is actually
  // generated - applies to both the Robux and currency paths.
  const buttons = buildTosAgreementButtons(paymentId, value);
  const container = buildTosAgreementEmbed({ payment, actionRow: buttons });
  await interaction.update(componentsV2(container));
}

export async function handleTosAgree(client, interaction) {
  const parts = interaction.customId.split(":"); // pay:tos:agree:{paymentId}:{value}
  const paymentId = parts[3];
  const value = parts[4];

  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.update({ content: "This payment session no longer exists.", components: [] });
  }

  await updatePayment(paymentId, { tosAgreedAt: Date.now() });

  if (value === "ROBUX") {
    // Enforce: only one pending Roblox payment at a time.
    const active = findActiveRobloxPayment(payment.guildId);
    if (active && active.paymentId !== payment.paymentId) {
      const jumpLink = `https://discord.com/channels/${payment.guildId}/${active.channelId}/${active.messageId}`;
      const container = buildPendingRobloxPaymentEmbed({ existingPayment: active, jumpLink });
      return interaction.reply(componentsV2(container, MessageFlags.Ephemeral));
    }

    const select = buildPaymentMethodSelect(paymentId);
    const container = buildPaymentMethodEmbed({ payment, actionRow: select });
    await interaction.update(componentsV2(container));

    await logEvent(client, "🎮 Robux Path Chosen", `**Payment ID:** \`${paymentId}\``);
    return;
  }

  // Currency confirmed and agreement accepted - generate the online
  // payment link directly.
  await interaction.deferUpdate();
  await generateOnlinePaymentLink(client, interaction, paymentId, value);
}
