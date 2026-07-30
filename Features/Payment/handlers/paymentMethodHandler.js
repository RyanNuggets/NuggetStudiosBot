// Features/Payment/handlers/paymentMethodHandler.js
//
// Only ever reached via the Robux path (see handlers/paymentChoiceHandler.js)
// since currency/online routing now happens earlier, on the choice screen.
import { MessageFlags } from "discord.js";
import { CustomId } from "../config/constants.js";
import { getPayment, updatePayment, findActiveRobloxPayment } from "../database/paymentStore.js";
import { getLinkedRobloxId } from "../providers/bloxlinkProvider.js";
import { getRobloxUserProfile, getRobloxAvatarUrl } from "../providers/robloxProvider.js";
import { buildRobloxConfirmEmbed } from "../embeds/robloxConfirmEmbed.js";
import { buildRobloxConfirmButtons } from "../buttons/robloxConfirmButtons.js";
import { buildPendingRobloxPaymentEmbed } from "../embeds/statusEmbeds.js";
import { logEvent } from "../utils/logger.js";

export function isPaymentMethodSelect(interaction) {
  return interaction.isStringSelectMenu?.() && interaction.customId.startsWith(`${CustomId.METHOD_SELECT}:`);
}

export async function handlePaymentMethodSelect(client, interaction) {
  const paymentId = interaction.customId.split(":")[2];
  const method = interaction.values[0];

  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.reply({ content: "This payment session no longer exists.", flags: MessageFlags.Ephemeral });
  }

  return handleRobloxMethodChosen(client, interaction, payment, method);
}

async function handleRobloxMethodChosen(client, interaction, payment, method) {
  // Enforce: only one pending Roblox payment at a time. (Also checked
  // earlier when Robux was confirmed on the choice screen - this is a
  // defensive re-check in case another payment slipped in between.)
  const active = findActiveRobloxPayment(payment.guildId);
  if (active && active.paymentId !== payment.paymentId) {
    const jumpLink = `https://discord.com/channels/${payment.guildId}/${active.channelId}/${active.messageId}`;
    return interaction.reply({
      embeds: [buildPendingRobloxPaymentEmbed({ existingPayment: active, jumpLink })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferUpdate();

  const { linked, robloxId } = await getLinkedRobloxId(payment.guildId, payment.customerId);
  if (!linked) {
    await interaction.followUp({
      content:
        `<@${payment.customerId}> doesn't have a Roblox account linked yet. ` +
        `Please verify your account first, then select a payment method again.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [profile, avatarUrl] = await Promise.all([getRobloxUserProfile(robloxId), getRobloxAvatarUrl(robloxId)]);

  const updated = await updatePayment(payment.paymentId, {
    method,
    robloxUserId: robloxId,
    robloxUsername: profile?.name ?? `Roblox User (${robloxId})`,
    robloxAvatarUrl: avatarUrl,
  });

  const embed = buildRobloxConfirmEmbed({ payment: updated });
  const buttons = buildRobloxConfirmButtons(updated.paymentId);

  await interaction.message.edit({ embeds: [embed], components: [buttons] });

  await logEvent(
    client,
    "🔎 Roblox Account Presented",
    `**Payment ID:** \`${updated.paymentId}\`\n**Method:** ${method}\n**Roblox User:** ${updated.robloxUsername} (${robloxId})`
  );
}
