import { Routes } from "discord-api-types/v10";
import {
  ActionRowBuilder,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import fs from "fs";

// ---------------- CONFIG ----------------
const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));

// ---------------- DASHBOARD LAYOUT ----------------
const DASHBOARD_LAYOUT = {
  flags: 32768,
  components: [
    {
      type: 17,
      components: [
        {
          type: 12,
          items: [
            {
              media: {
                url: "https://media.discordapp.net/attachments/1467051814733222043/1467051887936147486/Dashboard_1.png"
              }
            }
          ]
        },
        { type: 14 },
        {
          type: 10,
          content:
            "Nugget Studios is a commission-based design shop focused on clean, high-impact graphics for creators, communities, and game brands — from banners and Discord panels to uniforms, embeds, and polished promo visuals."
        },
        { type: 14 },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "dashboard_main_select",
              placeholder: "Select an option…",
              options: [{ label: "Support", value: "support" }]
            }
          ]
        }
      ]
    }
  ]
};

// ---------------- TICKET TYPES ----------------
const TICKET_TYPES = [
  { label: "General Support", value: "general" },
  { label: "Order / Commission", value: "order" },
  { label: "Billing", value: "billing" }
];

const ticketTypeLabel = (value) =>
  TICKET_TYPES.find((t) => t.value === value)?.label ?? value;

// ---------------- IDS ----------------
const IDS = {
  mainSelect: "dashboard_main_select",
  ticketTypeSelect: "support_ticket_type_select",
  modalBase: "support_enquiry_modal",
  modalInput: "support_enquiry_input",
  ticketActionsSelect: "ticket_actions_select",
  ticketUserToggleSelect: "ticket_user_toggle_select",

  // Rating in DMs (buttons)
  ratePrefix: "ticket_rate" // customId: ticket_rate:<ticketId>:<openerId>:<handlerId>:<rating>
};

// ---------------- HELPERS ----------------
const safeChannelName = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90);

const isSupport = (interaction, supportRoleId) => {
  const member = interaction.member;
  if (!member) return false;
  const roles = member.roles?.cache ?? member.roles;
  return roles?.has ? roles.has(supportRoleId) : Array.isArray(roles) ? roles.includes(supportRoleId) : false;
};

// Hidden tag stored in channel topic to prevent duplicates per type
const ticketTopicTag = (userId, ticketTypeValue) => `ns_ticket:${userId}:${ticketTypeValue}`;

// Claim tag stored in channel topic (reliable)
const claimedTopicTag = (staffId) => `ns_claimed:${staffId}`;
const hasClaimTag = (topic = "") => topic.includes("ns_claimed:");
const getClaimedBy = (topic = "") => {
  const m = topic.match(/ns_claimed:(\d{5,})/);
  return m ? m[1] : null;
};

// Parse opener + ticket type from topic
const getTicketInfoFromTopic = (topic = "") => {
  const m = topic.match(/ns_ticket:(\d{5,}):([a-z0-9_-]+)/i);
  if (!m) return { openerId: null, ticketTypeValue: null };
  return { openerId: m[1], ticketTypeValue: m[2] };
};

const appendTopicTag = (topic = "", tag = "") => {
  const next = (topic ? `${topic} | ${tag}` : tag).slice(0, 1024);
  return next;
};

// Log helper (sends to log channel if configured)
async function logTicket(client, conf, payload) {
  const logChannelId = conf.ticketLogsChannelId;
  if (!logChannelId) return;
  try {
    await client.rest.post(Routes.channelMessages(logChannelId), { body: payload });
  } catch {
    // ignore logging failures so tickets still work
  }
}

// Fetch messages and create transcript string
async function buildTranscript(channel, maxMessages = 2000) {
  const lines = [];
  lines.push(`Ticket Transcript`);
  lines.push(`Channel: #${channel.name} (${channel.id})`);
  lines.push(`Created: ${new Date(channel.createdTimestamp).toISOString()}`);
  lines.push(`Topic: ${channel.topic ?? ""}`);
  lines.push(`----------------------------------------\n`);

  // Fetch in pages of 100 (oldest -> newest after reverse at end)
  let lastId = undefined;
  const collected = [];

  while (collected.length < maxMessages) {
    const batch = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
    if (!batch || batch.size === 0) break;

    collected.push(...batch.values());
    lastId = batch.last().id;

    if (batch.size < 100) break;
  }

  // Oldest -> newest
  collected.reverse();

  for (const msg of collected) {
    const ts = new Date(msg.createdTimestamp).toISOString();
    const author = `${msg.author?.tag ?? "Unknown"} (${msg.author?.id ?? "?"})`;
    const content = (msg.content ?? "").replace(/\r/g, "");

    lines.push(`[${ts}] ${author}`);
    if (content) lines.push(content);

    if (msg.attachments?.size) {
      for (const att of msg.attachments.values()) {
        lines.push(`(attachment) ${att.name ?? "file"} - ${att.url}`);
      }
    }

    if (msg.embeds?.length) {
      lines.push(`(embeds) ${msg.embeds.length} embed(s)`);
    }

    lines.push(""); // blank line between messages
  }

  return lines.join("\n");
}

function ratingButtons(ticketId, openerId, handlerId) {
  const row = new ActionRowBuilder();
  for (let i = 1; i <= 5; i++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${IDS.ratePrefix}:${ticketId}:${openerId}:${handlerId}:${i}`)
        .setLabel(String(i))
        .setStyle(ButtonStyle.Secondary)
    );
  }
  return row;
}

// ---------------- BUILD TICKET MESSAGE ----------------
function buildTicketOpenPayload({ userId, supportRoleId, ticketTypeValue, enquiry }) {
  const typeLabel = ticketTypeLabel(ticketTypeValue);

  return {
    flags: 32768,
    allowed_mentions: { parse: ["users", "roles"] },
    components: [
      {
        type: 10,
        content: `-# <@${userId}> | <@&${supportRoleId}>`
      },
      {
        type: 17,
        components: [
          {
            type: 12,
            items: [
              {
                media: {
                  url: "https://media.discordapp.net/attachments/1467051814733222043/1467051887936147486/Dashboard_1.png"
                }
              }
            ]
          },
          { type: 14, spacing: 2 },
          {
            type: 10,
            content:
              `## **Thank you for contacting Nugget Studios.**\n` +
              `> Thanks for reaching out to Nugget Studios. Your request has been received and is now in our queue. Please share all relevant details so we can assist you efficiently. While we review your ticket, we ask that you do not tag or message staff directly.\n\n` +
              `### **Ticket Information:**\n` +
              `> *User:* <@${userId}>\n` +
              `> *Ticket Type:* ${typeLabel}\n\n` +
              `### **Enquiry:**\n` +
              `> *${enquiry}*`
          },
          { type: 14, spacing: 2 },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: IDS.ticketActionsSelect,
                placeholder: "Ticket Actions…",
                options: [
                  { label: "Claim", value: "claim" },
                  { label: "Close", value: "close" },
                  { label: "Add/Remove User", value: "toggle_user" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

// ---------------- SEND DASHBOARD ----------------
export async function sendDashboard(client) {
  const conf = readConfig().dashboard;

  await client.rest.post(Routes.channelMessages(conf.dashboardChannelId), {
    body: DASHBOARD_LAYOUT
  });

  console.log("✅ Dashboard sent");
}

// ---------------- INTERACTION HANDLER ----------------
export async function handleDashboardInteractions(client, interaction) {
  const { dashboard: conf } = readConfig();

  // ---------------- Rating buttons (DM) ----------------
  if (interaction.isButton && interaction.isButton() && interaction.customId.startsWith(IDS.ratePrefix + ":")) {
    const parts = interaction.customId.split(":");
    const ticketId = parts[1];
    const openerId = parts[2];
    const handlerId = parts[3];
    const rating = parts[4];

    // Only the ticket opener can rate
    if (interaction.user.id !== openerId) {
      return interaction.reply({ content: "Only the ticket opener can rate this ticket.", ephemeral: true });
    }

    // Log rating
    await logTicket(client, conf, {
      content:
        `⭐ **Ticket Rated**\n` +
        `• Ticket: \`${ticketId}\`\n` +
        `• Opener: <@${openerId}>\n` +
        `• Handler: ${handlerId && handlerId !== "none" ? `<@${handlerId}>` : "*Unclaimed*"}\n` +
        `• Rating: **${rating}/5**`
    });

    // Disable buttons after rating
    try {
      const disabledRow = new ActionRowBuilder().addComponents(
        interaction.message.components[0].components.map((b) => ButtonBuilder.from(b).setDisabled(true))
      );
      await interaction.update({ content: `Thanks! You rated this ticket **${rating}/5**.`, components: [disabledRow] });
    } catch {
      // fallback
      return interaction.reply({ content: `Thanks! You rated this ticket **${rating}/5**.`, ephemeral: true });
    }

    return;
  }

  // Dashboard select
  if (interaction.isStringSelectMenu() && interaction.customId === IDS.mainSelect) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(IDS.ticketTypeSelect)
      .setPlaceholder("Choose ticket type…")
      .addOptions(TICKET_TYPES);

    return interaction.reply({
      content: "Select a ticket type:",
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: true
    });
  }

  // Ticket type → modal
  if (interaction.isStringSelectMenu() && interaction.customId === IDS.ticketTypeSelect) {
    const modal = new ModalBuilder()
      .setCustomId(`${IDS.modalBase}:${interaction.values[0]}`)
      .setTitle("Support Enquiry");

    const input = new TextInputBuilder()
      .setCustomId(IDS.modalInput)
      .setLabel("Describe your issue")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(1000);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Modal submit → create ticket
  if (interaction.isModalSubmit() && interaction.customId.startsWith(IDS.modalBase + ":")) {
    const ticketTypeValue = interaction.customId.split(":")[1];
    const enquiry = interaction.fields.getTextInputValue(IDS.modalInput);

    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: "Server only.", ephemeral: true });

    // ✅ Only one ticket per type per user
    await guild.channels.fetch().catch(() => {});
    const tag = ticketTopicTag(interaction.user.id, ticketTypeValue);

    const existing = guild.channels.cache.find((ch) => {
      return (
        ch?.type === ChannelType.GuildText &&
        ch?.parentId === conf.ticketCategoryId &&
        typeof ch.topic === "string" &&
        ch.topic.includes(tag)
      );
    });

    if (existing) {
      return interaction.reply({
        content: `You already have an open **${ticketTypeLabel(ticketTypeValue)}** ticket: <#${existing.id}>`,
        ephemeral: true
      });
    }

    const channelName = safeChannelName(
      conf.ticketChannelNameFormat.replace("{username}", interaction.user.username)
    );

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: conf.ticketCategoryId,
      topic: tag, // hidden marker
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        {
          id: conf.supportRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages
          ]
        }
      ]
    });

    await client.rest.post(Routes.channelMessages(channel.id), {
      body: buildTicketOpenPayload({
        userId: interaction.user.id,
        supportRoleId: conf.supportRoleId,
        ticketTypeValue,
        enquiry
      })
    });

    // ✅ Log opened
    await logTicket(client, conf, {
      content:
        `🟢 **Ticket Opened**\n` +
        `• Ticket: <#${channel.id}> (\`${channel.id}\`)\n` +
        `• Opener: <@${interaction.user.id}>\n` +
        `• Type: **${ticketTypeLabel(ticketTypeValue)}**\n` +
        `• Enquiry: ${enquiry.length > 200 ? enquiry.slice(0, 200) + "…" : enquiry}`
    });

    return interaction.reply({
      content: `You have successfully created a ticket. View your ticket ⁠<#${channel.id}>.`,
      ephemeral: true
    });
  }

  // ---------------- ADD/REMOVE USER picker submit ----------------
  if (
    interaction.isUserSelectMenu &&
    interaction.isUserSelectMenu() &&
    interaction.customId === IDS.ticketUserToggleSelect
  ) {
    // only support can use
    if (!isSupport(interaction, conf.supportRoleId)) {
      return interaction.reply({
        content: "Only the support team can manage ticket users.",
        ephemeral: true
      });
    }

    const channel = interaction.channel;
    if (!channel) return interaction.reply({ content: "No channel found.", ephemeral: true });

    const targetId = interaction.values?.[0];
    if (!targetId) return interaction.reply({ content: "No user selected.", ephemeral: true });

    // prevent staff adding/removing staff
    const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (targetMember && targetMember.roles.cache.has(conf.supportRoleId)) {
      return interaction.reply({
        content: "You can’t add or remove support staff from tickets.",
        ephemeral: true
      });
    }

    // Toggle overwrite
    const existingOw = channel.permissionOverwrites.cache.get(targetId);
    const hasViewAllow = existingOw?.allow?.has(PermissionFlagsBits.ViewChannel) ?? false;

    try {
      if (existingOw && hasViewAllow) {
        await channel.permissionOverwrites.delete(targetId);
        return interaction.reply({ content: `Removed <@${targetId}> from this ticket.`, ephemeral: true });
      } else {
        await channel.permissionOverwrites.edit(targetId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
          EmbedLinks: true
        });
        return interaction.reply({ content: `Added <@${targetId}> to this ticket.`, ephemeral: true });
      }
    } catch {
      return interaction.reply({ content: "Failed to update ticket permissions.", ephemeral: true });
    }
  }

  // ---------------- CLAIM / CLOSE / ADD-REMOVE USER ----------------
  if (interaction.isStringSelectMenu() && interaction.customId === IDS.ticketActionsSelect) {
    const action = interaction.values[0];

    // Only support can use this menu
    if (!isSupport(interaction, conf.supportRoleId)) {
      return interaction.reply({
        content: "Only the support team can use ticket actions.",
        ephemeral: true
      });
    }

    const channel = interaction.channel;
    const msg = interaction.message;

    // CLAIM (only one person total, enforced by channel topic tag)
    if (action === "claim") {
      const topic = channel?.topic ?? "";
      if (hasClaimTag(topic)) {
        const claimedBy = getClaimedBy(topic);
        return interaction.reply({
          content: claimedBy ? `This ticket is already claimed by <@${claimedBy}>.` : "This ticket has already been claimed.",
          ephemeral: true
        });
      }

      const claimMessage = `Hello! My name is <@${interaction.user.id}> and I’ll be assisting you with this ticket.`;

      await msg.reply({
        content: claimMessage,
        allowedMentions: { parse: ["users"] }
      });

      // store claim in channel topic
      try {
        const nextTopic = appendTopicTag(topic, claimedTopicTag(interaction.user.id));
        await channel.setTopic(nextTopic);
      } catch {
        // ignore
      }

      // Log claimed
      await logTicket(client, conf, {
        content:
          `🟡 **Ticket Claimed**\n` +
          `• Ticket: <#${channel.id}> (\`${channel.id}\`)\n` +
          `• Claimed By: <@${interaction.user.id}>`
      });

      // Optional: update placeholder visually (not relied on)
      try {
        const newComponents = msg.components.map((row) => {
          const rowJson = row.toJSON();
          rowJson.components = rowJson.components.map((c) => {
            if (c.type === 3 && c.custom_id === IDS.ticketActionsSelect) {
              return { ...c, placeholder: `Claimed by ${interaction.user.username}` };
            }
            return c;
          });
          return rowJson;
        });
        await msg.edit({ components: newComponents });
      } catch {
        // ignore
      }

      return interaction.reply({ content: "Ticket claimed.", ephemeral: true });
    }

    // CLOSE (log + transcript + DM + rating)
    if (action === "close") {
      await interaction.reply({ content: "Closing ticket… generating transcript.", ephemeral: true });

      const topic = channel?.topic ?? "";
      const { openerId, ticketTypeValue } = getTicketInfoFromTopic(topic);
      const handlerId = getClaimedBy(topic) ?? "none";

      // Build transcript
      let transcriptText = "";
      try {
        transcriptText = await buildTranscript(channel);
      } catch {
        transcriptText = `Transcript failed to generate.\nChannel: #${channel?.name} (${channel?.id})`;
      }

      const transcriptName = `ticket-${channel.id}.txt`;
      const transcriptFile = {
        attachment: Buffer.from(transcriptText, "utf8"),
        name: transcriptName
      };

      // Log closed + attach transcript
      await logTicket(client, conf, {
        content:
          `🔴 **Ticket Closed**\n` +
          `• Ticket: \`${channel.id}\`\n` +
          `• Opener: ${openerId ? `<@${openerId}>` : "*Unknown*"}\n` +
          `• Type: **${ticketTypeValue ? ticketTypeLabel(ticketTypeValue) : "Unknown"}**\n` +
          `• Handler: ${handlerId !== "none" ? `<@${handlerId}>` : "*Unclaimed*"}`,
        files: [transcriptFile]
      });

      // DM opener with transcript + rating
      if (openerId) {
        try {
          const openerUser = await client.users.fetch(openerId);
          const row = ratingButtons(channel.id, openerId, handlerId);

          await openerUser.send({
            content:
              `✅ Your ticket has been closed.\n` +
              `Ticket ID: \`${channel.id}\`\n` +
              `Handler: ${handlerId !== "none" ? `<@${handlerId}>` : "Unclaimed"}\n\n` +
              `If you’d like, rate your support experience (1–5):`,
            files: [transcriptFile],
            components: [row]
          });
        } catch {
          // If DMs are closed, we just skip DM
        }
      }

      // Delete channel shortly after
      setTimeout(() => {
        interaction.channel?.delete("Ticket closed").catch(() => {});
      }, 2500);

      return;
    }

    // ADD/REMOVE USER (opens user picker)
    if (action === "toggle_user") {
      const picker = new UserSelectMenuBuilder()
        .setCustomId(IDS.ticketUserToggleSelect)
        .setPlaceholder("Select a user to add/remove…")
        .setMinValues(1)
        .setMaxValues(1);

      return interaction.reply({
        content: "Select a user to **add/remove** from this ticket:",
        components: [new ActionRowBuilder().addComponents(picker)],
        ephemeral: true
      });
    }
  }
}
