// Features/Payment/commands/forceexpirepayment.js
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from "discord.js";
import getConfig from "../config/config.js";
import { hasAllowedRole } from "../utils/permissions.js";
import { findActiveRobloxPayment, markExpired } from "../database/paymentStore.js";
import { logEvent } from "../utils/logger.js";

export const forceExpirePaymentCommandData = {
  name: "forceexpirepayment",
  description: "Expire the currently pending Robux Gamepass/T-Shirt payment, if any.",
  options: [],
};

const CONFIRM_CUSTOM_ID = "pay:forceexpire:confirm";

export async function handleForceExpireCommand(client, interaction) {
  const { allowedRoleId, embedColors } = getConfig();

  if (!hasAllowedRole(interaction.member, allowedRoleId)) {
    return interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
  }

  const active = findActiveRobloxPayment(interaction.guildId);
  if (!active) {
    return interaction.reply({
      content: "There is no pending Roblox payment right now.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("Expire pending Roblox payment?")
    .setColor(embedColors.warning)
    .setDescription(
      `**Payment ID:** \`${active.paymentId}\`\n` +
        `**Customer:** <@${active.customerId}>\n` +
        `**Method:** ${active.method || "Not yet chosen"}\n` +
        `**Status:** ${active.status}`
    );

  const confirmButton = new ButtonBuilder()
    .setCustomId(`${CONFIRM_CUSTOM_ID}:${active.paymentId}`)
    .setLabel("Confirm Expire")
    .setStyle(ButtonStyle.Danger);

  return interaction.reply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(confirmButton)],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleForceExpireConfirm(client, interaction, paymentId) {
  const { allowedRoleId } = getConfig();
  if (!hasAllowedRole(interaction.member, allowedRoleId)) {
    return interaction.reply({ content: "You don't have permission to do that.", flags: MessageFlags.Ephemeral });
  }

  const updated = await markExpired(paymentId);
  if (!updated) {
    return interaction.update({ content: "That payment no longer exists.", embeds: [], components: [] });
  }

  await logEvent(
    client,
    "⏱️ Payment Force-Expired",
    `**Payment ID:** \`${paymentId}\`\n**By:** <@${interaction.user.id}>`
  );

  return interaction.update({
    content: `✅ Payment \`${paymentId}\` has been expired. A new Roblox payment can now be created.`,
    embeds: [],
    components: [],
  });
}
