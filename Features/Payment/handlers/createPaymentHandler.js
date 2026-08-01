// Features/Payment/handlers/createPaymentHandler.js
// Covers the two steps between running /payment and seeing the payment
// method embed: modal submission, then customer selection.

import { MessageFlags } from "discord.js";
import { PAYMENT_MODAL_ID, parsePaymentModalSubmission } from "../modals/paymentModal.js";
import { buildCustomerSelect } from "../buttons/customerSelectMenu.js";
import { createDraft, getDraft, deleteDraft } from "../utils/draftStore.js";
import { createPayment, updatePayment } from "../database/paymentStore.js";
import { generatePaymentId } from "../utils/ids.js";
import { currencyToRobux } from "../utils/pricing.js";
import { buildCurrencyChoiceEmbed } from "../embeds/choiceEmbeds.js";
import { buildCurrencyChoiceSelect } from "../buttons/currencySelectMenu.js";
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

  // Ack immediately - if a USD amount was entered it needs a live exchange
  // rate lookup below before we know the equivalent Robux amount.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let robuxAmount = parsed.robuxAmount;
  if (robuxAmount == null) {
    try {
      robuxAmount = await currencyToRobux(parsed.usdAmount, "USD");
    } catch (err) {
      await interaction.editReply({ embeds: [buildErrorEmbed(`Failed to convert USD to Robux: ${err.message}`)] });
      return;
    }
  }

  const draftId = createDraft({
    robuxAmount,
    staffId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
  });

  await interaction.editReply({
    content: "Who is this payment for?",
    components: [buildCustomerSelect(draftId)],
  });

  await logEvent(
    client,
    "🧾 /payment used",
    `**By:** <@${interaction.user.id}>\n**Robux Amount:** ${robuxAmount}` +
      (parsed.usdAmount != null ? ` (entered as $${parsed.usdAmount})` : "")
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
      content: "This payment creation session has expired. Please run `/payment create` again.",
      components: [],
    });
  }

  const customerId = interaction.values[0];
  const paymentId = generatePaymentId();

  // Ack immediately - creating the payment record and posting the public
  // message below both do I/O that can add up past Discord's 3s window.
  await interaction.deferUpdate();

  const payment = await createPayment({
    paymentId,
    customerId,
    staffId: draft.staffId,
    robuxAmount: draft.robuxAmount,
    guildId: draft.guildId,
    channelId: draft.channelId,
  });

  deleteDraft(draftId);

  const select = buildCurrencyChoiceSelect(payment.paymentId);
  const container = buildCurrencyChoiceEmbed({ payment, actionRow: select });

  // Post the interactive payment message publicly in the channel so the
  // customer (not just the staff member who ran /payment) can use it.
  // Components V2 messages can't carry a top-level `content` (that's how
  // the customer ping used to be attached), so the ping is a small plain
  // message sent right before the container.
  await interaction.channel.send({ content: `<@${customerId}>` });
  const publicMessage = await interaction.channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  });

  await updatePaymentMessageId(payment.paymentId, publicMessage.id);

  await interaction.editReply({
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
