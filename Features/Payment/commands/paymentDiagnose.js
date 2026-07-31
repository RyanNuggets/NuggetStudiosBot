// Features/Payment/commands/paymentDiagnose.js
//
// /payment diagnose - replaces the old /forceexpirepayment command.
//
// Flow:
//   1. Run /payment diagnose -> ephemeral list of every open payment in this
//      guild, each with a jump link to its message, and one button per
//      payment to select it (no more typing/pasting a payment ID).
//   2. Click a payment -> full diagnostics: the raw record, plus live
//      checks (Bloxlink link, Roblox sale verification, Ziina status -
//      whichever apply), all shown in readable code blocks. Buttons let you
//      refresh, go back to the list, or force-expire it.
//   3. Force Expire asks for a confirm/cancel before actually expiring -
//      this is the only place force-expire lives now.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import getConfig from "../config/config.js";
import { hasAllowedRole } from "../utils/permissions.js";
import { CustomId, PaymentMethod, PaymentStatus } from "../config/constants.js";
import { getPayment, listActivePayments, markExpired } from "../database/paymentStore.js";
import { getLinkedRobloxId } from "../providers/bloxlinkProvider.js";
import { verifyRobuxPaymentReceived } from "../providers/robloxProvider.js";
import { getZiinaPaymentStatus } from "../providers/ziinaProvider.js";
import { logEvent } from "../utils/logger.js";

const ACTIVE_STATUSES = [PaymentStatus.PENDING, PaymentStatus.AWAITING_VERIFICATION, PaymentStatus.AWAITING_PAYMENT];

// ---------------------------------------------------------------------------
// /payment diagnose - list view
// ---------------------------------------------------------------------------

export async function handlePaymentDiagnoseCommand(client, interaction) {
  const { allowedRoleId } = getConfig();
  if (!hasAllowedRole(interaction.member, allowedRoleId)) {
    return interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
  }

  const payments = listActivePayments(interaction.guildId);

  return interaction.reply({
    embeds: [buildListEmbed(payments)],
    components: buildListButtons(payments),
    flags: MessageFlags.Ephemeral,
  });
}

function jumpLinkFor(payment) {
  if (!payment.guildId || !payment.channelId || !payment.messageId) return null;
  return `https://discord.com/channels/${payment.guildId}/${payment.channelId}/${payment.messageId}`;
}

function buildListEmbed(payments) {
  const { embedColors } = getConfig();

  if (payments.length === 0) {
    return new EmbedBuilder()
      .setTitle("🔍 Payment Diagnostics")
      .setColor(embedColors.default)
      .setDescription("There are no open payments right now.");
  }

  const lines = payments.map((p) => {
    const link = jumpLinkFor(p);
    return (
      `**${p.paymentId}** — <@${p.customerId}> — *${p.status}*` +
      (p.method ? ` — ${p.method}` : "") +
      (link ? ` — [Jump to message](${link})` : " — _no message yet_")
    );
  });

  return new EmbedBuilder()
    .setTitle("🔍 Payment Diagnostics")
    .setColor(embedColors.default)
    .setDescription(`Select a payment below to view its full diagnostics.\n\n${lines.join("\n")}`)
    .setFooter({ text: `${payments.length} open payment(s)` })
    .setTimestamp();
}

function buildListButtons(payments) {
  const rows = [];
  let row = new ActionRowBuilder();

  for (const p of payments.slice(0, 25)) {
    if (row.components.length === 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CustomId.DIAGNOSE_SELECT}:${p.paymentId}`)
        .setLabel(p.paymentId)
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (row.components.length) rows.push(row);

  return rows.slice(0, 5); // Discord hard cap: 5 action rows per message
}

// ---------------------------------------------------------------------------
// Selecting a payment -> diagnostics view
// ---------------------------------------------------------------------------

export function isDiagnoseSelect(interaction) {
  return interaction.isButton?.() && interaction.customId.startsWith(`${CustomId.DIAGNOSE_SELECT}:`);
}
export function isDiagnoseRefresh(interaction) {
  return interaction.isButton?.() && interaction.customId.startsWith(`${CustomId.DIAGNOSE_REFRESH}:`);
}
export function isDiagnoseBack(interaction) {
  return interaction.isButton?.() && interaction.customId === CustomId.DIAGNOSE_BACK;
}

export async function handleDiagnoseSelect(client, interaction) {
  const { allowedRoleId } = getConfig();
  if (!hasAllowedRole(interaction.member, allowedRoleId)) {
    return interaction.reply({ content: "You don't have permission to do that.", flags: MessageFlags.Ephemeral });
  }

  const paymentId = interaction.customId.split(":")[3];
  await interaction.deferUpdate(); // ack immediately - the diagnostics checks below hit live APIs
  return renderDiagnoseView(interaction, paymentId);
}

export async function handleDiagnoseRefresh(client, interaction) {
  const { allowedRoleId } = getConfig();
  if (!hasAllowedRole(interaction.member, allowedRoleId)) {
    return interaction.reply({ content: "You don't have permission to do that.", flags: MessageFlags.Ephemeral });
  }

  const paymentId = interaction.customId.split(":")[3];
  await interaction.deferUpdate();
  return renderDiagnoseView(interaction, paymentId);
}

export async function handleDiagnoseBack(client, interaction) {
  const { allowedRoleId } = getConfig();
  if (!hasAllowedRole(interaction.member, allowedRoleId)) {
    return interaction.reply({ content: "You don't have permission to do that.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();
  const payments = listActivePayments(interaction.guildId);
  await interaction.editReply({
    content: null,
    embeds: [buildListEmbed(payments)],
    components: buildListButtons(payments),
  });
}

/**
 * Pure render step - assumes the interaction has ALREADY been acknowledged
 * (deferUpdate) by the caller. Never defers/acks itself, so it's safe to
 * call from multiple places (select, refresh, after force-expiring) without
 * risking a double-ack or an ack that comes too late.
 */
async function renderDiagnoseView(interaction, paymentId) {
  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.editReply({ content: "That payment no longer exists.", embeds: [], components: [] });
  }

  const diagnostics = await runDiagnostics(payment);

  await interaction.editReply({
    content: null,
    embeds: [buildDiagnoseEmbed({ payment, diagnostics })],
    components: buildDiagnoseButtons(payment),
  });
}

/**
 * Runs whatever live checks are relevant to this payment's method/status,
 * catching every error individually so one failed check doesn't blank out
 * the rest of the diagnostics.
 */
async function runDiagnostics(payment) {
  const results = {};

  if (payment.customerId && payment.guildId) {
    try {
      results.bloxlinkLink = await getLinkedRobloxId(payment.guildId, payment.customerId);
    } catch (err) {
      results.bloxlinkLinkError = err?.message || String(err);
    }
  }

  const isRobloxMethod = payment.method === PaymentMethod.ROBUX_GAMEPASS || payment.method === PaymentMethod.ROBUX_TSHIRT;
  if (isRobloxMethod) {
    const { gamepassId, tshirtId } = getConfig();
    const assetId = payment.method === PaymentMethod.ROBUX_GAMEPASS ? gamepassId : tshirtId;
    results.configuredAssetId = assetId ?? null;

    if (payment.status === PaymentStatus.AWAITING_VERIFICATION && payment.robloxUserId && assetId) {
      try {
        results.robuxSaleCheck = await verifyRobuxPaymentReceived({
          assetId,
          robloxUserId: payment.robloxUserId,
          sinceMs: payment.createdAt,
        });
      } catch (err) {
        results.robuxSaleCheckError = err?.message || String(err);
      }
    }
  }

  if (payment.method === PaymentMethod.ONLINE_PAYMENT && payment.providerPaymentId) {
    try {
      results.ziinaStatus = await getZiinaPaymentStatus(payment.providerPaymentId);
    } catch (err) {
      results.ziinaStatusError = err?.message || String(err);
    }
  }

  return results;
}

function statusColor(status, embedColors) {
  if (status === PaymentStatus.COMPLETED) return embedColors.success;
  if (status === PaymentStatus.EXPIRED || status === PaymentStatus.CANCELLED || status === PaymentStatus.FAILED) {
    return embedColors.danger;
  }
  return embedColors.warning; // Pending / Awaiting Verification / Awaiting Payment
}

function buildDiagnoseEmbed({ payment, diagnostics }) {
  const { embedColors } = getConfig();
  const link = jumpLinkFor(payment);
  const ageMinutes = Math.floor((Date.now() - payment.createdAt) / 60000);

  const summary =
    `**Payment ID:** \`${payment.paymentId}\`\n` +
    `**Customer:** <@${payment.customerId}>\n` +
    `**Staff:** <@${payment.staffId}>\n` +
    `**Status:** ${payment.status}\n` +
    `**Method:** ${payment.method || "Not yet chosen"}\n` +
    `**Age:** ${ageMinutes} minute(s)\n` +
    (link ? `**Message:** [Jump to message](${link})\n` : "");

  const recordBlock = "```json\n" + JSON.stringify(payment, null, 2) + "\n```";
  const diagnosticsBlock =
    Object.keys(diagnostics).length > 0
      ? "```json\n" + JSON.stringify(diagnostics, null, 2) + "\n```"
      : "```\nNo live checks applicable for this payment's current method/status.\n```";

  // Embed description hard-caps at 4096 chars - trim the record dump if a
  // payment ever somehow grows huge, so the embed never fails to send.
  let description = `${summary}\n**Record**\n${recordBlock}\n**Live Checks**\n${diagnosticsBlock}`;
  if (description.length > 4000) {
    description = description.slice(0, 3990) + "\n... (truncated)";
  }

  return new EmbedBuilder()
    .setTitle(`🔍 Diagnostics — ${payment.paymentId}`)
    .setColor(statusColor(payment.status, embedColors))
    .setDescription(description)
    .setTimestamp();
}

function buildDiagnoseButtons(payment) {
  const row = new ActionRowBuilder();

  if (ACTIVE_STATUSES.includes(payment.status)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CustomId.DIAGNOSE_FORCEEXPIRE_ASK}:${payment.paymentId}`)
        .setLabel("Force Expire")
        .setStyle(ButtonStyle.Danger)
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${CustomId.DIAGNOSE_REFRESH}:${payment.paymentId}`)
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CustomId.DIAGNOSE_BACK).setLabel("Back to list").setStyle(ButtonStyle.Secondary)
  );

  return [row];
}

// ---------------------------------------------------------------------------
// Force expire (confirm/cancel) - lives entirely inside diagnose now
// ---------------------------------------------------------------------------

export function isDiagnoseForceExpireAsk(interaction) {
  return interaction.isButton?.() && interaction.customId.startsWith(`${CustomId.DIAGNOSE_FORCEEXPIRE_ASK}:`);
}
export function isDiagnoseForceExpireConfirm(interaction) {
  return interaction.isButton?.() && interaction.customId.startsWith(`${CustomId.DIAGNOSE_FORCEEXPIRE_CONFIRM}:`);
}
export function isDiagnoseForceExpireCancel(interaction) {
  return interaction.isButton?.() && interaction.customId.startsWith(`${CustomId.DIAGNOSE_FORCEEXPIRE_CANCEL}:`);
}

export async function handleDiagnoseForceExpireAsk(client, interaction) {
  const paymentId = interaction.customId.split(":")[4];
  const payment = getPayment(paymentId);
  if (!payment) {
    return interaction.update({ content: "That payment no longer exists.", embeds: [], components: [] });
  }

  const { embedColors } = getConfig();
  const embed = new EmbedBuilder()
    .setTitle("Expire this payment?")
    .setColor(embedColors.warning)
    .setDescription(
      `**Payment ID:** \`${payment.paymentId}\`\n` +
        `**Customer:** <@${payment.customerId}>\n` +
        `**Method:** ${payment.method || "Not yet chosen"}\n` +
        `**Status:** ${payment.status}\n\n` +
        `This will mark it Expired so a new Roblox payment can be created if needed. This can't be undone.`
    );

  const confirm = new ButtonBuilder()
    .setCustomId(`${CustomId.DIAGNOSE_FORCEEXPIRE_CONFIRM}:${paymentId}`)
    .setLabel("Confirm Expire")
    .setStyle(ButtonStyle.Danger);
  const cancel = new ButtonBuilder()
    .setCustomId(`${CustomId.DIAGNOSE_FORCEEXPIRE_CANCEL}:${paymentId}`)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);

  await interaction.update({
    content: null,
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(confirm, cancel)],
  });
}

export async function handleDiagnoseForceExpireConfirm(client, interaction) {
  const { allowedRoleId } = getConfig();
  if (!hasAllowedRole(interaction.member, allowedRoleId)) {
    return interaction.reply({ content: "You don't have permission to do that.", flags: MessageFlags.Ephemeral });
  }

  const paymentId = interaction.customId.split(":")[4];

  // Ack immediately - markExpired/logEvent/diagnostics below all do I/O
  // (file writes, a Discord message send, live API checks) that can easily
  // add up past Discord's 3s interaction window if we wait to ack until
  // after they're done.
  await interaction.deferUpdate();

  const updated = await markExpired(paymentId);
  if (!updated) {
    return interaction.editReply({ content: "That payment no longer exists.", embeds: [], components: [] });
  }

  await logEvent(
    client,
    "⏱️ Payment Force-Expired",
    `**Payment ID:** \`${paymentId}\`\n**By:** <@${interaction.user.id}>`
  );

  return renderDiagnoseView(interaction, paymentId);
}

export async function handleDiagnoseForceExpireCancel(client, interaction) {
  const paymentId = interaction.customId.split(":")[4];
  await interaction.deferUpdate();
  return renderDiagnoseView(interaction, paymentId);
}
