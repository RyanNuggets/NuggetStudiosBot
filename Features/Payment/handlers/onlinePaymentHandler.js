// Features/Payment/handlers/onlinePaymentHandler.js
import { MessageFlags } from "discord.js";
import { CustomId, PaymentMethod, PaymentStatus } from "../config/constants.js";
import { getPayment, updatePayment, markCompleted } from "../database/paymentStore.js";
import { convertFromAed, robuxToAed } from "../utils/pricing.js";
import {
  createZiinaPaymentIntent,
  getZiinaPaymentStatus,
  isZiinaSuccessStatus,
} from "../providers/ziinaProvider.js";
import { buildOnlinePaymentEmbed } from "../embeds/paymentGeneratedEmbed.js";
import { buildIvePaidButton } from "../buttons/ivePaidButton.js";
import { buildPaymentCompleteEmbed } from "../embeds/paymentCompleteEmbed.js";
import { buildPaymentNotDetectedEmbed, buildErrorEmbed } from "../embeds/statusEmbeds.js";
import { logEvent, logError } from "../utils/logger.js";

export function isOnlinePaid(interaction) {
  return interaction.isButton?.() && interaction.customId.startsWith(`${CustomId.ONLINE_PAID}:`);
}

/**
 * Generates the card / Apple Pay / Google Pay checkout link for a payment
 * and edits the message in place. Called from the currency choice-confirm
 * step (see handlers/paymentChoiceHandler.js) once the currency has been
 * confirmed - by this point `interaction` has already been deferred.
 *
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Interaction} interaction - deferred component interaction
 * @param {string} paymentId
 * @param {"AED"|"USD"|"EUR"|"GBP"} currency
 */
export async function generateOnlinePaymentLink(client, interaction, paymentId, currency) {
  const payment = getPayment(paymentId);
  if (!payment) {
    await interaction
      .followUp({ content: "This payment session no longer exists.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return;
  }

  try {
    const aedAmount = robuxToAed(payment.robuxAmount);
    const convertedAmount = await convertFromAed(aedAmount, currency);

    const intent = await createZiinaPaymentIntent({
      amount: convertedAmount,
      currency,
      message: `${payment.paymentId} - ${payment.description || "Payment"}`,
    });
    const providerPaymentId = intent.id;
    const paymentUrl = intent.paymentUrl;

    const updated = await updatePayment(paymentId, {
      method: PaymentMethod.ONLINE_PAYMENT,
      currency,
      convertedAmount,
      providerPaymentId,
      paymentUrl,
      status: PaymentStatus.AWAITING_PAYMENT,
    });

    const embed = buildOnlinePaymentEmbed({ payment: updated, actionRow: buildIvePaidButton(paymentId, "online") });

    await interaction.message.edit({ flags: MessageFlags.IsComponentsV2, components: [embed] });

    await logEvent(
      client,
      "🔗 Online Payment Generated",
      `**Payment ID:** \`${paymentId}\`\n**Method:** ${updated.method}\n**Amount:** ${convertedAmount} ${currency}`
    );
  } catch (err) {
    await logError(client, `Failed to generate online payment (${paymentId})`, err);
    await interaction
      .followUp({
        embeds: [buildErrorEmbed(`Failed to generate the payment link: ${err.message}`)],
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }
}

export async function handleOnlinePaid(client, interaction) {
  const paymentId = interaction.customId.split(":")[3];
  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.reply({ content: "This payment session no longer exists.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();

  try {
    const { status } = await getZiinaPaymentStatus(payment.providerPaymentId);
    const success = isZiinaSuccessStatus(status);

    if (!success) {
      await interaction.followUp({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [buildPaymentNotDetectedEmbed()],
      });
      return;
    }

    const completed = await markCompleted(paymentId);
    const container = buildPaymentCompleteEmbed({ payment: completed, staffId: completed.staffId });

    await interaction.message.edit({ flags: MessageFlags.IsComponentsV2, components: [container] });

    await logEvent(
      client,
      "✅ Payment Completed",
      `**Payment ID:** \`${paymentId}\`\n**Customer:** <@${completed.customerId}>\n**Method:** ${completed.method}`
    );
  } catch (err) {
    await logError(client, `Failed to verify online payment (${paymentId})`, err);
    await interaction.followUp({
      embeds: [buildErrorEmbed(`Couldn't check payment status: ${err.message}`)],
      flags: MessageFlags.Ephemeral,
    });
  }
}
