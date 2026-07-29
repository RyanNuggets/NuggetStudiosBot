// Features/Payment/handlers/robloxPaymentHandler.js
import { MessageFlags } from "discord.js";
import { CustomId, PaymentMethod, PaymentStatus } from "../config/constants.js";
import { getPayment, updatePayment, markCompleted } from "../database/paymentStore.js";
import getConfig from "../config/config.js";
import { getLinkedRobloxId } from "../providers/bloxlinkProvider.js";
import {
  updateGamepassPrice,
  updateTshirtPrice,
  buildGamepassPurchaseLink,
  buildTshirtPurchaseLink,
  verifyRobuxPaymentReceived,
  getRobloxUserProfile,
  getRobloxAvatarUrl,
} from "../providers/robloxProvider.js";
import { buildRobloxConfirmEmbed } from "../embeds/robloxConfirmEmbed.js";
import { buildRobloxConfirmButtons } from "../buttons/robloxConfirmButtons.js";
import { buildRobloxPaymentEmbed } from "../embeds/paymentGeneratedEmbed.js";
import { buildIvePaidButton } from "../buttons/ivePaidButton.js";
import { buildPaymentCompleteEmbed } from "../embeds/paymentCompleteEmbed.js";
import { buildPaymentNotDetectedEmbed, buildErrorEmbed } from "../embeds/statusEmbeds.js";
import { logEvent, logError } from "../utils/logger.js";

export function isRobloxConfirm(interaction) {
  return interaction.isButton?.() && interaction.customId.startsWith(`${CustomId.ROBLOX_CONFIRM}:`);
}
export function isRobloxReverify(interaction) {
  return interaction.isButton?.() && interaction.customId.startsWith(`${CustomId.ROBLOX_REVERIFY}:`);
}
export function isRobloxPaid(interaction) {
  return interaction.isButton?.() && interaction.customId.startsWith(`${CustomId.ROBLOX_PAID}:`);
}

export async function handleRobloxConfirm(client, interaction) {
  const paymentId = interaction.customId.split(":")[3];
  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.reply({ content: "This payment session no longer exists.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();

  try {
    const { gamepassId, tshirtId } = getConfig();
    let purchaseLink;

    if (payment.method === PaymentMethod.ROBUX_GAMEPASS) {
      await updateGamepassPrice(payment.robuxAmount);
      purchaseLink = buildGamepassPurchaseLink(gamepassId);
    } else {
      await updateTshirtPrice(payment.robuxAmount);
      purchaseLink = buildTshirtPurchaseLink(tshirtId);
    }

    const updated = await updatePayment(paymentId, {
      paymentUrl: purchaseLink,
      status: PaymentStatus.AWAITING_VERIFICATION,
    });

    const embed = buildRobloxPaymentEmbed({ payment: updated });
    const button = buildIvePaidButton(paymentId, "roblox");

    await interaction.message.edit({ embeds: [embed], components: [button] });

    await logEvent(
      client,
      "🔗 Roblox Payment Generated",
      `**Payment ID:** \`${paymentId}\`\n**Method:** ${payment.method}\n**Robux:** ${payment.robuxAmount}`
    );
  } catch (err) {
    await logError(client, `Failed to generate Roblox payment (${paymentId})`, err);
    await interaction.followUp({
      embeds: [buildErrorEmbed(`Failed to generate the payment link: ${err.message}`)],
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Re-checks the customer's Bloxlink link (in case they've since linked a
 * different Roblox account) and refreshes the confirm embed. Bloxlink
 * itself is the source of truth for linking/verification - this button
 * doesn't need its own verification flow, it just re-reads the current
 * link and shows it again.
 */
export async function handleRobloxReverify(client, interaction) {
  const paymentId = interaction.customId.split(":")[3];
  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.reply({ content: "This payment session no longer exists.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();

  const { linked, robloxId } = await getLinkedRobloxId(payment.guildId, payment.customerId);

  if (!linked) {
    await interaction.followUp({
      content: `<@${payment.customerId}> doesn't have a Roblox account linked via Bloxlink. Please link an account, then press Reverify again.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [profile, avatarUrl] = await Promise.all([getRobloxUserProfile(robloxId), getRobloxAvatarUrl(robloxId)]);

  const updated = await updatePayment(paymentId, {
    robloxUserId: robloxId,
    robloxUsername: profile?.name ?? `Roblox User (${robloxId})`,
    robloxAvatarUrl: avatarUrl,
  });

  const embed = buildRobloxConfirmEmbed({ payment: updated });
  const buttons = buildRobloxConfirmButtons(paymentId);

  await interaction.message.edit({ embeds: [embed], components: [buttons] });

  await logEvent(
    client,
    "🔁 Roblox Account Reverified",
    `**Payment ID:** \`${paymentId}\`\n**Roblox User:** ${updated.robloxUsername} (${robloxId})`
  );
}

export async function handleRobloxPaid(client, interaction) {
  const paymentId = interaction.customId.split(":")[3];
  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.reply({ content: "This payment session no longer exists.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();

  try {
    const { gamepassId, tshirtId } = getConfig();
    const assetId = payment.method === PaymentMethod.ROBUX_GAMEPASS ? gamepassId : tshirtId;

    const { received } = await verifyRobuxPaymentReceived({
      assetId,
      robloxUserId: payment.robloxUserId,
      sinceMs: payment.createdAt,
    });

    if (!received) {
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
    await logError(client, `Failed to verify Roblox payment (${paymentId})`, err);
    await interaction.followUp({
      embeds: [buildErrorEmbed(`Couldn't check payment status: ${err.message}`)],
      flags: MessageFlags.Ephemeral,
    });
  }
}
