// Features/Payment/handlers/onlinePaymentHandler.js
import { MessageFlags } from "discord.js";
import { CustomId, PaymentStatus, ZIINA_METHODS, PAYPAL_METHODS } from "../config/constants.js";
import { getPayment, updatePayment, markCompleted } from "../database/paymentStore.js";
import { convertFromAed, robuxToAed } from "../utils/pricing.js";
import {
  createZiinaPaymentIntent,
  getZiinaPaymentStatus,
  isZiinaSuccessStatus,
} from "../providers/ziinaProvider.js";
import {
  createPaypalOrder,
  getPaypalOrderStatus,
  capturePaypalOrder,
  isPaypalSuccessStatus,
} from "../providers/paypalProvider.js";
import { buildOnlinePaymentEmbed } from "../embeds/paymentGeneratedEmbed.js";
import { buildIvePaidButton } from "../buttons/ivePaidButton.js";
import { buildPaymentCompleteEmbed } from "../embeds/paymentCompleteEmbed.js";
import { buildPaymentNotDetectedEmbed, buildErrorEmbed } from "../embeds/statusEmbeds.js";
import { logEvent, logError } from "../utils/logger.js";

export function isCurrencySelect(interaction) {
  return interaction.isStringSelectMenu?.() && interaction.customId.startsWith(`${CustomId.CURRENCY_SELECT}:`);
}
export function isOnlinePaid(interaction) {
  return interaction.isButton?.() && interaction.customId.startsWith(`${CustomId.ONLINE_PAID}:`);
}

export async function handleCurrencySelect(client, interaction) {
  const paymentId = interaction.customId.split(":")[2];
  const currency = interaction.values[0];

  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.reply({ content: "This payment session no longer exists.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();

  try {
    const aedAmount = robuxToAed(payment.robuxAmount);
    const convertedAmount = await convertFromAed(aedAmount, currency);

    let providerPaymentId;
    let paymentUrl;

    if (ZIINA_METHODS.includes(payment.method)) {
      const intent = await createZiinaPaymentIntent({
        amount: convertedAmount,
        currency,
        message: `${payment.paymentId} - ${payment.description || "Payment"}`,
      });
      providerPaymentId = intent.id;
      paymentUrl = intent.paymentUrl;
    } else if (PAYPAL_METHODS.includes(payment.method)) {
      const order = await createPaypalOrder({
        amount: convertedAmount,
        currency,
        description: payment.description,
        paymentId: payment.paymentId,
      });
      providerPaymentId = order.id;
      paymentUrl = order.paymentUrl;
    } else {
      throw new Error(`Method ${payment.method} is not an online payment method.`);
    }

    const updated = await updatePayment(paymentId, {
      currency,
      convertedAmount,
      providerPaymentId,
      paymentUrl,
      status: PaymentStatus.AWAITING_PAYMENT,
    });

    const embed = buildOnlinePaymentEmbed({ payment: updated });
    const button = buildIvePaidButton(paymentId, "online");

    await interaction.message.edit({ content: null, embeds: [embed], components: [button] });

    await logEvent(
      client,
      "🔗 Online Payment Generated",
      `**Payment ID:** \`${paymentId}\`\n**Method:** ${payment.method}\n**Amount:** ${convertedAmount} ${currency}`
    );
  } catch (err) {
    await logError(client, `Failed to generate online payment (${paymentId})`, err);
    await interaction.followUp({
      embeds: [buildErrorEmbed(`Failed to generate the payment link: ${err.message}`)],
      flags: MessageFlags.Ephemeral,
    });
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
    let success = false;

    if (ZIINA_METHODS.includes(payment.method)) {
      const { status } = await getZiinaPaymentStatus(payment.providerPaymentId);
      success = isZiinaSuccessStatus(status);
    } else if (PAYPAL_METHODS.includes(payment.method)) {
      const { status } = await getPaypalOrderStatus(payment.providerPaymentId);
      if (status === "APPROVED") {
        const captured = await capturePaypalOrder(payment.providerPaymentId);
        success = isPaypalSuccessStatus(captured.status);
      } else {
        success = isPaypalSuccessStatus(status);
      }
    }

    if (!success) {
      await interaction.followUp({ embeds: [buildPaymentNotDetectedEmbed()], flags: MessageFlags.Ephemeral });
      return;
    }

    const completed = await markCompleted(paymentId);
    const embed = buildPaymentCompleteEmbed({ payment: completed, staffId: completed.staffId });

    await interaction.message.edit({ embeds: [embed], components: [] });

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
