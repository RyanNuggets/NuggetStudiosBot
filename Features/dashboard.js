import { Routes } from "discord-api-types/v10";
import {
  ActionRowBuilder,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder
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
            "**Nugget Studios** is a commission-based design studio specializing in **clean, high-impact graphics** for creators, communities, and game brands. We produce **banners, discord embeds, uniforms and refined promotional visuals** — built to impress and designed to last."
        },
        // Dropdown: Regulations + About Us
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "dashboard_main_select",
              placeholder: "Select an option…",
              options: [
                { label: "Studio Regulations", value: "regulations" },
                { label: "About Us", value: "about" }
              ]
            }
          ]
        },
        // Buttons under dropdown: Support + Website
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 1, // Primary
              custom_id: "dashboard_support_button",
              label: "Support"
            },
            {
              type: 2,
              style: 5, // Link
              url: "https://nuggetstudios.xyz",
              label: "Website"
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
  supportButton: "dashboard_support_button",
  ticketTypeSelect: "support_ticket_type_select",
  modalBase: "support_enquiry_modal",
  modalInput: "support_enquiry_input",
  ticketActionsSelect: "ticket_actions_select",
  ticketUserToggleSelect: "ticket_user_toggle_select"
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

// Topic tags
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

// ---------------- BRAND IMAGE ----------------
const BRAND_IMAGE =
  "https://media.discordapp.net/attachments/1467051814733222043/1467051887936147486/Dashboard_1.png";

// ---------------- STUDIO REGULATIONS (EPHEMERAL EMBEDS) ----------------
const STUDIO_REGULATIONS_EMBEDS = [
  {
    image: {
      url: "https://media.discordapp.net/attachments/1467051814733222043/1467051887936147486/Dashboard_1.png?ex=697efa0a&is=697da88a&hm=7f3d70a98d76fe62886d729de773f0d2d178184711381f185521366f88f93423&=&format=webp&quality=lossless&width=550&height=165"
    }
  },
  {
    description:
      "These rules must be followed at all times. Violations may result in warnings, mutes, kicks, or bans.\n\n" +
      "1. **`Respect All Members`**\n" +
      "> Treat everyone with kindness and professionalism. Harassment, discrimination, or toxic behavior will not be tolerated.\n\n" +
      "2. **`Spam & Flooding`**\n" +
      "> Do not send repetitive messages, excessive emojis, links, or mentions. Keep all channels clean and readable.\n\n" +
      "3. **`Proper Channel Usage`**\n" +
      "> Stay on-topic and use channels for their intended purpose. For example, uniform requests must be posted in the appropriate request section.\n\n" +
      "4. **`Advertising & Promotion`**\n" +
      "> Advertising or promoting other servers, groups, or products without staff permission is strictly prohibited.\n\n" +
      "5. **`Roblox & Discord Terms of Service`**\n" +
      "> All members must comply with both Roblox and Discord ToS. Any violations may result in immediate moderation action.\n\n" +
      "6. **`Leaking & Reselling`**\n" +
      "> Leaking or reselling any content from **Nugget Studios** is strictly forbidden and will result in an immediate blacklist.\n\n" +
      "7. **`Staff Authority`**\n" +
      "> Staff decisions are final. If a staff member asks you to stop an action, you are expected to comply.\n\n" +
      "8. **`Usernames & Avatars`**\n" +
      "> Offensive or inappropriate usernames and avatars are not allowed within the server.\n\n" +
      "9. **`NSFW & Inappropriate Content`**\n" +
      "> This is a safe, all-ages server. NSFW or inappropriate content of any kind is not permitted.\n\n" +
      "10. **`Reporting Issues`**\n" +
      "> If you encounter rule-breaking or issues, report them privately to staff via DMs or support channels. Do not call out users publicly."
  }
];

// ---------------- ABOUT US (EPHEMERAL EMBEDS) ----------------
const ABOUT_US_EMBEDS = [
  {
    image: {
      url: "https://media.discordapp.net/attachments/1467051814733222043/1467051887936147486/Dashboard_1.png?ex=697efa0a&is=697da88a&hm=7f3d70a98d76fe62886d729de773f0d2d178184711381f185521366f88f93423&=&format=webp&quality=lossless&width=550&height=165"
    }
  },
  {
    description:
      "Welcome to **Nugget Studios** — a commission-based design studio focused on **clean, premium visuals** made for communities, creators, and game brands.\n\n" +
      "1. **`What We Do`**\n" +
      "> We create high-impact graphics like banners, Discord assets, uniforms, and polished promotional designs.\n\n" +
      "2. **`Our Standard`**\n" +
      "> Every delivery is built with consistency in mind: clean spacing, strong readability, and a professional finish.\n\n" +
      "3. **`How It Works`**\n" +
      "> Open a support ticket, share what you need, and we’ll guide you through the process from concept to delivery.\n\n" +
      "4. **`Communication`**\n" +
      "> Clear updates, respectful timelines, and organized revisions — so you always know what’s happening.\n\n" +
      "5. **`Goal`**\n" +
      "> Make your server or brand look more official, more polished, and more memorable."
  }
];

// ---------------- COMPONENT-BASED LAYOUT FOR LOGS/DMs ----------------
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

async function logTicketMessage(client, conf, body) {
  const logId = conf.ticketLogsChannelId;
  if (!logId) return;
  return postRaw(client, logId, body);
}

// ---------------- TRANSCRIPT (PLAIN TEXT MESSAGES) ----------------
async function buildTranscriptTxt(channel, maxMessages = 4000) {
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

function splitPlainTextMessages(text, chunkSize = 1800) {
  const chunks = [];
  const lines = String(text ?? "").split("\n");

  let cur = "";
  for (const line of lines) {
    if (cur.length + line.length + 1 > chunkSize) {
      if (cur) chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? cur + "\n" + line : line;
    }
  }
  if (cur) chunks.push(cur);

  const finalChunks = [];
  for (const c of chunks) {
    if (c.length <= chunkSize) finalChunks.push(c);
    else {
      for (let i = 0; i < c.length; i += chunkSize) {
        finalChunks.push(c.slice(i, i + chunkSize));
      }
    }
  }
  return finalChunks;
}

async function sendPlainTranscriptToChannel(client, channelId, ticketId, transcriptText) {
  if (!channelId) return;
  const chunks = splitPlainTextMessages(transcriptText, 1800);

  await postRaw(client, channelId, {
    content: `**Transcript for ticket \`${ticketId}\`** (${chunks.length} message${
      chunks.length === 1 ? "" : "s"
    })`
  });

  for (const chunk of chunks) {
    await postRaw(client, channelId, { content: "```txt\n" + chunk + "\n```" });
  }
}

async function sendPlainTranscriptToDM(client, userId, ticketId, transcriptText) {
  const chunks = splitPlainTextMessages(transcriptText, 1800);

  await postRawDM(client, userId, {
    content: `**Your transcript for ticket \`${ticketId}\`** (${chunks.length} message${
      chunks.length === 1 ? "" : "s"
    })`
  });

  for (const chunk of chunks) {
    await postRawDM(client, userId, { content: "```txt\n" + chunk + "\n```" });
  }
}

// ---------------- BUILD TICKET OPEN MESSAGE ----------------
function buildTicketOpenPayload({ userId, staffRoleId, ticketTypeValue, enquiry }) {
  const typeLabel = ticketTypeLabel(ticketTypeValue);

  return {
    flags: 32768,
    allowed_mentions: { parse: ["users", "roles"] },
    components: [
      { type: 10, content: `-# <@${userId}> | <@&${staffRoleId}>` },
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

  // Dropdown interactions (Regulations / About)
  if (interaction.isStringSelectMenu?.() && interaction.customId === IDS.mainSelect) {
    const selected = interaction.values?.[0];
    console.log("[DASHBOARD] dropdown:", selected, "by", interaction.user?.id);

    if (selected === "regulations") {
      return interaction.reply({
        ephemeral: true,
        embeds: STUDIO_REGULATIONS_EMBEDS,
        allowedMentions: { parse: [] }
      });
    }

    if (selected === "about") {
      return interaction.reply({
        ephemeral: true,
        embeds: ABOUT_US_EMBEDS,
        allowedMentions: { parse: [] }
      });
    }
  }

  // Support button -> ticket type selector (ephemeral)
  if (interaction.isButton?.() && interaction.customId === IDS.supportButton) {
    console.log("[DASHBOARD] support button by", interaction.user?.id);

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
    console.log("[TICKET] type selected:", interaction.values?.[0], "by", interaction.user?.id);

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

    console.log("[TICKET] modal submit:", ticketTypeValue, "by", interaction.user?.id);

    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: "Server only.", ephemeral: true });

    const staffRoleId =
      ticketTypeValue === "management" ? conf.managementRoleId : conf.supportRoleId;

    if (!staffRoleId) {
      return interaction.reply({
        content: "Missing staff role ID in config for this ticket type.",
        ephemeral: true
      });
    }

    // one ticket per type per user
    await guild.channels.fetch().catch((e) => console.error("[TICKET] channels.fetch failed:", e));
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
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
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

    try {
      const openedLog = layoutMessage(
        `## 🟢 **Ticket Opened**\n` +
          `> **Ticket:** <#${channel.id}> (\`${channel.id}\`)\n` +
          `> **Opener:** <@${interaction.user.id}>\n` +
          `> **Type:** **${ticketTypeLabel(ticketTypeValue)}**\n` +
          `> **Staff Role:** <@&${staffRoleId}>`
      );
      await logTicketMessage(client, conf, openedLog);
    } catch (e) {
      console.error("Open log failed:", e);
    }

    return interaction.reply({
      content: `You have successfully created a ticket. View your ticket ⁠<#${channel.id}>.`,
      ephemeral: true
    });
  }

  // Add/Remove user picker submit
  if (interaction.isUserSelectMenu?.() && interaction.customId === IDS.ticketUserToggleSelect) {
    const channel = interaction.channel;
    if (!channel) return interaction.reply({ content: "No channel found.", ephemeral: true });

    const staffRoleId = getStaffRoleFromTopic(channel.topic ?? "") || conf.supportRoleId;

    if (!hasRole(interaction, staffRoleId)) {
      return interaction.reply({
        content: "Only the assigned staff team for this ticket can manage ticket users.",
        ephemeral: true
      });
    }

    const targetId = interaction.values?.[0];
    if (!targetId) return interaction.reply({ content: "No user selected.", ephemeral: true });

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
        return interaction.reply({
          content: `Removed <@${targetId}> from this ticket.`,
          ephemeral: true
        });
      } else {
        await channel.permissionOverwrites.edit(targetId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
          EmbedLinks: true
        });
        return interaction.reply({
          content: `Added <@${targetId}> to this ticket.`,
          ephemeral: true
        });
      }
    } catch (e) {
      console.error("Toggle user failed:", e);
      return interaction.reply({ content: "Failed to update ticket permissions.", ephemeral: true });
    }
  }

  // Ticket actions
  if (interaction.isStringSelectMenu?.() && interaction.customId === IDS.ticketActionsSelect) {
    const action = interaction.values[0];
    const channel = interaction.channel;
    const msg = interaction.message;
    if (!channel) return;

    const staffRoleId = getStaffRoleFromTopic(channel.topic ?? "") || conf.supportRoleId;

    if (!hasRole(interaction, staffRoleId)) {
      return interaction.reply({
        content: "Only the assigned staff team for this ticket can use ticket actions.",
        ephemeral: true
      });
    }

    // CLAIM
    if (action === "claim") {
      const topic = channel.topic ?? "";
      if (hasClaimTag(topic)) {
        const claimedBy = getClaimedBy(topic);
        return interaction.reply({
          content: claimedBy
            ? `This ticket is already claimed by <@${claimedBy}>.`
            : "This ticket has already been claimed.",
          ephemeral: true
        });
      }

      const claimMessage = `Hello! My name is <@${interaction.user.id}> and I’ll be assisting you with this ticket.`;
      await msg.reply({ content: claimMessage, allowedMentions: { parse: ["users"] } });

      try {
        await channel.setTopic(appendTopicTag(topic, claimedTopicTag(interaction.user.id)));
      } catch {}

      try {
        const claimedLog = layoutMessage(
          `## 🟡 **Ticket Claimed**\n` +
            `> **Ticket:** <#${channel.id}> (\`${channel.id}\`)\n` +
            `> **Claimed By:** <@${interaction.user.id}>\n` +
            `> **Staff Role:** <@&${staffRoleId}>`
        );
        await logTicketMessage(client, conf, claimedLog);
      } catch (e) {
        console.error("Claim log failed:", e);
      }

      return interaction.reply({ content: "Ticket claimed.", ephemeral: true });
    }

    // TOGGLE USER
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

    // CLOSE
    if (action === "close") {
      await interaction.reply({ content: "Closing ticket… generating transcript.", ephemeral: true });

      const topic = channel.topic ?? "";
      const { openerId, ticketTypeValue } = getTicketInfoFromTopic(topic);
      const handlerId = getClaimedBy(topic) ?? "none";

      // Log: closed
      try {
        const closedLog = layoutMessage(
          `## 🔴 **Ticket Closed**\n` +
            `> **Ticket:** <#${channel.id}> (\`${channel.id}\`)\n` +
            `> **Opener:** ${openerId ? `<@${openerId}>` : "*Unknown*"}\n` +
            `> **Type:** **${ticketTypeValue ? ticketTypeLabel(ticketTypeValue) : "Unknown"}**\n` +
            `> **Handler:** ${handlerId !== "none" ? `\`${handlerId}\`` : "*Unclaimed*"}\n` +
            `> **Staff Role:** <@&${staffRoleId}>`
        );
        await logTicketMessage(client, conf, closedLog);
      } catch (e) {
        console.error("Closed log failed:", e);
      }

      // Build transcript
      let transcriptText = "";
      try {
        transcriptText = await buildTranscriptTxt(channel);
      } catch (e) {
        console.error("Transcript build failed:", e);
        transcriptText = `Transcript failed to generate.\nChannel: #${channel.name} (${channel.id})`;
      }

      // Transcript in logs
      try {
        await sendPlainTranscriptToChannel(client, conf.ticketLogsChannelId, channel.id, transcriptText);
      } catch (e) {
        console.error("Transcript send to logs failed:", e);
      }

      // DM opener: closed + transcript
      if (openerId) {
        try {
          const dmBody = layoutMessage(
            `## ✅ **Your ticket has been closed**\n` +
              `> **Ticket ID:** \`${channel.id}\`\n` +
              `> **Type:** **${ticketTypeValue ? ticketTypeLabel(ticketTypeValue) : "Unknown"}**\n` +
              `> **Handler:** ${handlerId !== "none" ? `\`${handlerId}\`` : "Unclaimed"}\n\n` +
              `> If you need anything else, feel free to open a new ticket from the dashboard.`
          );

          await postRawDM(client, openerId, dmBody);
        } catch (e) {
          console.error("DM closed failed:", e);
        }

        try {
          await sendPlainTranscriptToDM(client, openerId, channel.id, transcriptText);
        } catch (e) {
          console.error("DM transcript failed:", e);
        }
      }

      setTimeout(() => {
        channel.delete("Ticket closed").catch(() => {});
      }, 2500);

      return;
    }
  }
}
