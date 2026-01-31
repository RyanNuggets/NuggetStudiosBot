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
  { label: "General", value: "general" },
  { label: "Management", value: "management" }
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
  ratePrefix: "ticket_rate" // ticket_rate:<ticketId>:<openerId>:<handlerId>:<rating>
};

// ---------------- HELPERS ----------------
const safeChannelName = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90);

const hasRole = (interaction, roleId) => {
  const member = interaction.member;
  if (!member || !roleId) return false;
  const roles = member.roles?.cache ?? member.roles;
  return roles?.has ? roles.has(roleId) : Array.isArray(roles) ? roles.includes(roleId) : false;
};

// Topic tags (stable storage)
const ticketTopicTag = (userId, ticketTypeValue) => `ns_ticket:${userId}:${ticketTypeValue}`;
const staffRoleTopicTag = (roleId) => `ns_staffrole:${roleId}`;
const claimedTopicTag = (staffId) => `ns_claimed:${staffId}`;

const hasClaimTag = (topic = "") => topic.includes("ns_claimed:");
const getClaimedBy = (topic = "") => {
  const m = topic.match(/ns_claimed:(\d{5,})/);
  return m ? m[1] : null;
};

const getTicketInfoFromTopic = (topic = "") => {
  const m = topic.match(/ns_ticket:(\d{5,}):([a-z0-9_-]+)/i);
  if (!m) return { openerId: null, ticketTypeValue: null };
  return { openerId: m[1], ticketTypeValue: m[2] };
};

const getStaffRoleFromTopic = (topic = "") => {
  const m = topic.match(/ns_staffrole:(\d{5,})/);
  return m ? m[1] : null;
};

const appendTopicTag = (topic = "", tag = "") => (topic ? `${topic} | ${tag}` : tag).slice(0, 1024);

// ---------------- COMPONENT-BASED LAYOUT BUILDERS ----------------
const BRAND_IMAGE =
  "https://media.discordapp.net/attachments/1467051814733222043/1467051887936147486/Dashboard_1.png";

function layoutMessage(contentMarkdown, { pingLine = null } = {}) {
  const components = [];

  if (pingLine) components.push({ type: 10, content: pingLine });

  components.push({
    type: 17,
    components: [
      { type: 12, items: [{ media: { url: BRAND_IMAGE } }] },
      { type: 14, spacing: 2 },
      { type: 10, content: contentMarkdown },
      { type: 14, spacing: 2 }
    ]
  });

  return {
    flags: 32768,
    allowed_mentions: { parse: ["users", "roles"] },
    components
  };
}

function ratingRow(ticketId, openerId, handlerId) {
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

// ---------------- RAW REST SEND HELPERS ----------------
async function postRaw(client, channelId, body, files = undefined) {
  return client.rest.post(Routes.channelMessages(channelId), {
    body,
    ...(files ? { files } : {})
  });
}

async function getDmChannelId(client, userId) {
  const dm = await client.rest.post(Routes.userChannels(), {
    body: { recipient_id: userId }
  });
  return dm.id;
}

async function postRawDM(client, userId, body, files = undefined) {
  const dmId = await getDmChannelId(client, userId);
  return postRaw(client, dmId, body, files);
}

async function logTicket(client, conf, body, files = undefined) {
  const logId = conf.ticketLogsChannelId;
  if (!logId) return;
  try {
    await postRaw(client, logId, body, files);
  } catch {
    // never break ticket flow
  }
}

// ---------------- TRANSCRIPT BUILDER (.txt) ----------------
async function buildTranscript(channel, maxMessages = 2000) {
  const lines = [];
  lines.push(`Ticket Transcript`);
  lines.push(`Channel: #${channel.name} (${channel.id})`);
  lines.push(`Created: ${new Date(channel.createdTimestamp).toISOString()}`);
  lines.push(`Topic: ${channel.topic ?? ""}`);
  lines.push(`----------------------------------------\n`);

  let lastId = undefined;
  const collected = [];

  while (collected.length < maxMessages) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {})
    });
    if (!batch || batch.size === 0) break;

    collected.push(...batch.values());
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }

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

    if (msg.embeds?.length) lines.push(`(embeds) ${msg.embeds.length} embed(s)`);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------- BUILD TICKET OPEN MESSAGE ----------------
function buildTicketOpenPayload({ userId, staffRoleId, ticketTypeValue, enquiry }) {
  const typeLabel = ticketTypeLabel(ticketTypeValue);

  return {
    flags: 32768,
    allowed_mentions: { parse: ["users", "roles"] },
    components: [
      {
        type: 10,
        content: `-# <@${userId}> | <@&${staffRoleId}>`
      },
      {
        type: 17,
        components: [
          { type: 12, items: [{ media: { url: BRAND_IMAGE } }] },
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
  await postRaw(client, conf.dashboardChannelId, DASHBOARD_LAYOUT);
  console.log("✅ Dashboard sent");
}

// ---------------- INTERACTION HANDLER ----------------
export async function handleDashboardInteractions(client, interaction) {
  const { dashboard: conf } = readConfig();

  // ---------------- RATING BUTTONS (DM) ----------------
  if (interaction.isButton?.() && interaction.customId.startsWith(IDS.ratePrefix + ":")) {
    const parts = interaction.customId.split(":");
    const ticketId = parts[1];
    const openerId = parts[2];
    const handlerId = parts[3];
    const rating = parts[4];

    if (interaction.user.id !== openerId) {
      return interaction.reply({ content: "Only the ticket opener can rate this ticket.", ephemeral: true });
    }

    const ratingLog = layoutMessage(
      `## ⭐ **Ticket Rated**\n` +
        `> **Ticket:** \`${ticketId}\`\n` +
        `> **Opener:** <@${openerId}>\n` +
        `> **Handler:** ${handlerId && handlerId !== "none" ? `<@${handlerId}>` : "*Unclaimed*"}\n` +
        `> **Rating:** **${rating}/5**`
    );
    await logTicket(client, conf, ratingLog);

    // Disable buttons
    try {
      const disabledRow = new ActionRowBuilder().addComponents(
        interaction.message.components[0].components.map((b) => ButtonBuilder.from(b).setDisabled(true))
      );

      const confirm = layoutMessage(`## ✅ **Thank you!**\n> You rated this ticket **${rating}/5**.`);

      await interaction.update({
        content: "",
        components: [...confirm.components, disabledRow.toJSON()]
      });
    } catch {
      await interaction.reply({ content: `Thanks! You rated this ticket **${rating}/5**.`, ephemeral: true });
    }
    return;
  }

  // Dashboard select
  if (interaction.isStringSelectMenu?.() && interaction.customId === IDS.mainSelect) {
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
  if (interaction.isStringSelectMenu?.() && interaction.customId === IDS.ticketTypeSelect) {
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
  if (interaction.isModalSubmit?.() && interaction.customId.startsWith(IDS.modalBase + ":")) {
    const ticketTypeValue = interaction.customId.split(":")[1];
    const enquiry = interaction.fields.getTextInputValue(IDS.modalInput);

    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: "Server only.", ephemeral: true });

    // choose staff role per ticket type
    const staffRoleId =
      ticketTypeValue === "management" ? conf.managementRoleId : conf.supportRoleId;

    if (!staffRoleId) {
      return interaction.reply({
        content: "Missing staff role ID in config for this ticket type.",
        ephemeral: true
      });
    }

    // Only one ticket per type per user
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

    // perms: opener + staffRole only (management should NOT include support)
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: conf.ticketCategoryId,
      topic: appendTopicTag(tag, staffRoleTopicTag(staffRoleId)),
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
          id: staffRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages
          ]
        }
      ]
    });

    await postRaw(
      client,
      channel.id,
      buildTicketOpenPayload({
        userId: interaction.user.id,
        staffRoleId,
        ticketTypeValue,
        enquiry
      })
    );

    // LOG: opened (component-based)
    const openedLog = layoutMessage(
      `## 🟢 **Ticket Opened**\n` +
        `> **Ticket:** <#${channel.id}> (\`${channel.id}\`)\n` +
        `> **Opener:** <@${interaction.user.id}>\n` +
        `> **Type:** **${ticketTypeLabel(ticketTypeValue)}**\n` +
        `> **Staff Role:** <@&${staffRoleId}>\n` +
        `> **Enquiry:** ${enquiry.length > 250 ? enquiry.slice(0, 250) + "…" : enquiry}`
    );
    await logTicket(client, conf, openedLog);

    return interaction.reply({
      content: `You have successfully created a **${ticketTypeLabel(ticketTypeValue)}** ticket. View your ticket ⁠<#${channel.id}>.`,
      ephemeral: true
    });
  }

  // Add/Remove user picker submit
  if (interaction.isUserSelectMenu?.() && interaction.customId === IDS.ticketUserToggleSelect) {
    const channel = interaction.channel;
    if (!channel) return interaction.reply({ content: "No channel found.", ephemeral: true });

    const staffRoleId = getStaffRoleFromTopic(channel.topic ?? "") || conf.supportRoleId;

    // only the correct staff role can manage this ticket
    if (!hasRole(interaction, staffRoleId)) {
      return interaction.reply({
        content: "Only the assigned staff team for this ticket can manage ticket users.",
        ephemeral: true
      });
    }

    const targetId = interaction.values?.[0];
    if (!targetId) return interaction.reply({ content: "No user selected.", ephemeral: true });

    // block adding/removing ANY staff (support or management)
    const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
    const isStaff =
      (conf.supportRoleId && targetMember?.roles.cache.has(conf.supportRoleId)) ||
      (conf.managementRoleId && targetMember?.roles.cache.has(conf.managementRoleId));

    if (isStaff) {
      return interaction.reply({
        content: "You can’t add or remove staff members from tickets.",
        ephemeral: true
      });
    }

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

  // Ticket actions: claim / close / toggle_user
  if (interaction.isStringSelectMenu?.() && interaction.customId === IDS.ticketActionsSelect) {
    const action = interaction.values[0];
    const channel = interaction.channel;
    const msg = interaction.message;
    if (!channel) return;

    const staffRoleId = getStaffRoleFromTopic(channel.topic ?? "") || conf.supportRoleId;

    // only correct staff team for this ticket
    if (!hasRole(interaction, staffRoleId)) {
      return interaction.reply({
        content: "Only the assigned staff team for this ticket can use ticket actions.",
        ephemeral: true
      });
    }

    // CLAIM (one person only, locked by topic)
    if (action === "claim") {
      const topic = channel.topic ?? "";
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

      try {
        await channel.setTopic(appendTopicTag(topic, claimedTopicTag(interaction.user.id)));
      } catch {}

      // LOG: claimed (component-based)
      const claimedLog = layoutMessage(
        `## 🟡 **Ticket Claimed**\n` +
          `> **Ticket:** <#${channel.id}> (\`${channel.id}\`)\n` +
          `> **Claimed By:** <@${interaction.user.id}>\n` +
          `> **Staff Role:** <@&${staffRoleId}>`
      );
      await logTicket(client, conf, claimedLog);

      // visual placeholder update (optional)
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
      } catch {}

      return interaction.reply({ content: "Ticket claimed.", ephemeral: true });
    }

    // TOGGLE USER (open user picker)
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

    // CLOSE: logs + transcript (.txt) to logs + DM + rating
    if (action === "close") {
      await interaction.reply({ content: "Closing ticket… generating transcript.", ephemeral: true });

      const topic = channel.topic ?? "";
      const { openerId, ticketTypeValue } = getTicketInfoFromTopic(topic);
      const handlerId = getClaimedBy(topic) ?? "none";

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

      // LOG: closed (component-based) + transcript attached
      const closedLog = layoutMessage(
        `## 🔴 **Ticket Closed**\n` +
          `> **Ticket:** <#${channel.id}> (\`${channel.id}\`)\n` +
          `> **Opener:** ${openerId ? `<@${openerId}>` : "*Unknown*"}\n` +
          `> **Type:** **${ticketTypeValue ? ticketTypeLabel(ticketTypeValue) : "Unknown"}**\n` +
          `> **Handler:** ${handlerId !== "none" ? `<@${handlerId}>` : "*Unclaimed*"}\n` +
          `> **Staff Role:** <@&${staffRoleId}>\n\n` +
          `> **Transcript:** Attached below.`
      );
      await logTicket(client, conf, closedLog, [transcriptFile]);

      // DM opener (component-based) + transcript + rating buttons
      if (openerId) {
        try {
          const dmBody = layoutMessage(
            `## ✅ **Your ticket has been closed**\n` +
              `> **Ticket ID:** \`${channel.id}\`\n` +
              `> **Type:** **${ticketTypeValue ? ticketTypeLabel(ticketTypeValue) : "Unknown"}**\n` +
              `> **Handler:** ${handlerId !== "none" ? `<@${handlerId}>` : "Unclaimed"}\n\n` +
              `### ⭐ **Rate your experience (optional)**\n` +
              `> Click a number below (1–5).`
          );

          const row = ratingRow(channel.id, openerId, handlerId);

          await postRawDM(
            client,
            openerId,
            {
              ...dmBody,
              components: [...dmBody.components, row.toJSON()]
            },
            [transcriptFile]
          );
        } catch {
          // DMs closed, ignore
        }
      }

      setTimeout(() => {
        channel.delete("Ticket closed").catch(() => {});
      }, 2500);

      return;
    }
  }
}
