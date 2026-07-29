// Features/Payment/handlers/createPaymentHandler.js
// Covers the two steps between running /payment and seeing the payment
// method embed: modal submission, then customer selection.

import { MessageFlags } from "discord.js";
import { PAYMENT_MODAL_ID, parsePaymentModalSubmission } from "../modals/paymentModal.js";
import { buildCustomerSelect } from "../buttons/customerSelectMenu.js";
import { createDraft, getDraft, deleteDraft } from "../utils/draftStore.js";
import { createPayment, updatePayment } from "../database/paymentStore.js";
import { generatePaymentId } from "../utils/ids.js";
import { buildPaymentMethodEmbed } from "../embeds/paymentMethodEmbed.js";
import { buildPaymentMethodSelect } from "../buttons/paymentMethodComponents.js";
import { buildPricingBreakdown } from "../utils/pricing.js";
import { buildErrorEmbed } from "../embeds/statusEmbeds.js";
import { logEvent } from "../utils/logger.js";
import { CustomId } from "../config/constants.js";

export function isPaymentModalSubmit(interaction) {
  return interaction.isModalSubmit() && interaction.customId === PAYMENT_MODAL_ID;
}

export async function handlePaymentModalSubmit(client, interaction) {
  const parsed = parsePaymentModalSubmission(interaction);
  if (parsed.error) {
    return interaction.reply({ content: parsed.error, flags: MessageFlags.Ephemeral });
  }

  const draftId = createDraft({
    robuxAmount: parsed.robuxAmount,
    description: parsed.description,
    staffId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
  });

  await interaction.reply({
    content: "Who is this payment for?",
    components: [buildCustomerSelect(draftId)],
    flags: MessageFlags.Ephemeral,
  });

  await logEvent(
    client,
    "🧾 /payment used",
    `**By:** <@${interaction.user.id}>\n**Robux Amount:** ${parsed.robuxAmount}`
  );
}

export function isCustomerSelect(interaction) {
  return interaction.isUserSelectMenu?.() && interaction.customId.startsWith(`${CustomId.CUSTOMER_SELECT}:`);
}

export async function handleCustomerSelect(client, interaction) {
  const draftId = interaction.customId.split(":")[2];
  const draft = getDraft(draftId);

  if (!draft) {
    return interaction.update({
      content: "This payment creation session has expired. Please run `/payment` again.",
      components: [],
    });
  }

  const customerId = interaction.values[0];
  const paymentId = generatePaymentId();

  const payment = await createPayment({
    paymentId,
    customerId,
    staffId: draft.staffId,
    description: draft.description,
    robuxAmount: draft.robuxAmount,
    guildId: draft.guildId,
    channelId: draft.channelId,
  });

  deleteDraft(draftId);

  let pricing;
  try {
    pricing = await buildPricingBreakdown(payment.robuxAmount, "AED");
  } catch (err) {
    return interaction.update({
      content: "",
      embeds: [buildErrorEmbed(`Failed to calculate pricing: ${err.message}`)],
      components: [],
    });
  }

  const embed = buildPaymentMethodEmbed({ payment, convertedAmount: pricing.amount, currency: "AED" });
  const select = buildPaymentMethodSelect(payment.paymentId);

  // Post the interactive payment-method message publicly in the channel so
  // the customer (not just the staff member who ran /payment) can use it.
  const publicMessage = await interaction.channel.send({
    content: `<@${customerId}>`,
    embeds: [embed],
    components: [select],
  });

  await updatePaymentMessageId(payment.paymentId, publicMessage.id);

  await interaction.update({
    content: `✅ Payment session \`${payment.paymentId}\` created for <@${customerId}>. See the message below.`,
    components: [],
  });

  await logEvent(
    client,
    "🧾 Payment Session Created",
    `**Payment ID:** \`${payment.paymentId}\`\n**Customer:** <@${customerId}>\n**Staff:** <@${draft.staffId}>\n**Robux Amount:** ${payment.robuxAmount}`
  );
}

async function updatePaymentMessageId(paymentId, messageId) {
  await updatePayment(paymentId, { messageId });
}
