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
  await postRaw(client, logId, body, files);
}

// ---------------- TRANSCRIPT (.html) ----------------
const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

function htmlWrapper({ title, subtitle, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background: #0b0d10; color:#e8eef6; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 24px; }
  .card { background: #0f1318; border: 1px solid rgba(255,255,255,.08); border-radius: 14px; overflow: hidden; }
  .hdr { padding: 18px 18px 0; }
  h1 { font-size: 18px; margin: 0 0 6px; }
  .sub { color: rgba(232,238,246,.7); font-size: 12px; margin: 0 0 14px; }
  .meta { display:flex; gap:10px; flex-wrap: wrap; font-size: 12px; color: rgba(232,238,246,.75); padding: 0 18px 14px; }
  .pill { padding: 6px 10px; border-radius: 999px; background: rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.06); }
  table { width: 100%; border-collapse: collapse; }
  tr { border-top: 1px solid rgba(255,255,255,.06); }
  td { padding: 12px 18px; vertical-align: top; }
  .ts { width: 210px; color: rgba(232,238,246,.65); font-size: 12px; white-space: nowrap; }
  .auth { width: 260px; font-size: 12px; color: rgba(232,238,246,.85); }
  .msg { font-size: 13px; line-height: 1.35; white-space: pre-wrap; }
  .att { margin-top: 6px; font-size: 12px; color: rgba(232,238,246,.7); }
  a { color: #8ab4ff; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="hdr">
        <h1>${escapeHtml(title)}</h1>
        <p class="sub">${escapeHtml(subtitle)}</p>
      </div>
      ${bodyHtml}
    </div>
  </div>
</body>
</html>`;
}

async function buildTranscriptHtml(channel, maxMessages = 4000) {
  const headerTitle = `Ticket Transcript — #${channel.name}`;
  const headerSub = `Channel ID: ${channel.id}`;

  // fetch messages
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

  const meta = `
    <div class="meta">
      <div class="pill">Created: ${escapeHtml(new Date(channel.createdTimestamp).toISOString())}</div>
      <div class="pill">Messages: ${escapeHtml(collected.length)}</div>
      <div class="pill">Topic: ${escapeHtml(channel.topic ?? "")}</div>
    </div>
  `;

  let rows = "";
  for (const msg of collected) {
    const ts = new Date(msg.createdTimestamp).toISOString();
    const author = `${msg.author?.tag ?? "Unknown"} (${msg.author?.id ?? "?"})`;
    const content = msg.content ?? "";

    let attachmentsHtml = "";
    if (msg.attachments?.size) {
      const items = [];
      for (const att of msg.attachments.values()) {
        items.push(
          `<div class="att">(attachment) ${escapeHtml(att.name ?? "file")} — <a href="${escapeHtml(att.url)}">${escapeHtml(att.url)}</a></div>`
        );
      }
      attachmentsHtml = items.join("");
    }

    // basic indicator for embeds
    const embedsNote = msg.embeds?.length ? `<div class="att">(embeds) ${msg.embeds.length} embed(s)</div>` : "";

    rows += `
      <tr>
        <td class="ts">${escapeHtml(ts)}</td>
        <td class="auth">${escapeHtml(author)}</td>
        <td class="msg">${escapeHtml(content)}${attachmentsHtml}${embedsNote}</td>
      </tr>
    `;
  }

  const table = `<table>${rows}</table>`;
  return htmlWrapper({
    title: headerTitle,
    subtitle: headerSub,
    bodyHtml: meta + table
  });
}

// Discord upload safety: split into multiple html files if needed
function splitHtmlFiles({ html, baseName }) {
  // Safe bot upload cap ~7.5MB each (headroom under 8MB)
  const MAX_BYTES = 7_500_000;
  const buf = Buffer.from(html, "utf8");
  if (buf.length <= MAX_BYTES) {
    return [{ attachment: buf, name: baseName }];
  }

  // Split by chunks while keeping valid HTML per part.
  // We’ll split the BODY table rows across parts.
  // Find a spot to split: between <tr>...</tr> blocks.
  const parts = [];
  const htmlStr = html;

  // Very simple approach: split by row boundaries.
  const start = htmlStr.indexOf("<table>");
  const end = htmlStr.lastIndexOf("</table>");
  if (start === -1 || end === -1 || end <= start) {
    // fallback: raw byte chunking (still valid-ish)
    let offset = 0;
    let idx = 1;
    while (offset < buf.length) {
      const chunk = buf.slice(offset, offset + MAX_BYTES);
      parts.push({ attachment: chunk, name: baseName.replace(".html", `-part${idx}.html`) });
      offset += MAX_BYTES;
      idx++;
    }
    return parts;
  }

  const head = htmlStr.slice(0, start + "<table>".length);
  const tail = htmlStr.slice(end); // includes </table>...rest
  const rowsBlob = htmlStr.slice(start + "<table>".length, end);

  // split rowsBlob by </tr>
  const rows = rowsBlob.split("</tr>").map((r) => (r.trim() ? r + "</tr>" : "")).filter(Boolean);

  let current = "";
  let idx = 1;

  const pushPart = (rowsHtml) => {
    const partHtml = head + rowsHtml + tail;
    parts.push({
      attachment: Buffer.from(partHtml, "utf8"),
      name: baseName.replace(".html", `-part${idx}.html`)
    });
    idx++;
  };

  for (const r of rows) {
    const next = current + r;
    const size = Buffer.byteLength(head + next + tail, "utf8");

    if (size > MAX_BYTES && current) {
      pushPart(current);
      current = r;
    } else if (size > MAX_BYTES && !current) {
      // single row too large, force push anyway
      pushPart(r);
      current = "";
    } else {
      current = next;
    }
  }

  if (current) pushPart(current);

  return parts;
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
    const [_, ticketId, openerId, handlerId, rating] = interaction.customId.split(":");

    if (interaction.user.id !== openerId) {
      return interaction.reply({ content: "Only the ticket opener can rate this ticket.", ephemeral: true });
    }

    try {
      const ratingLog = layoutMessage(
        `## ⭐ **Ticket Rated**\n` +
          `> **Ticket:** \`${ticketId}\`\n` +
          `> **Opener:** <@${openerId}>\n` +
          `> **Handler:** ${handlerId && handlerId !== "none" ? `<@${handlerId}>` : "*Unclaimed*"}\n` +
          `> **Rating:** **${rating}/5**`
      );
      await logTicket(client, conf, ratingLog);

      // Disable buttons on the DM message
      const disabledRow = new ActionRowBuilder().addComponents(
        interaction.message.components[0].components.map((b) => ButtonBuilder.from(b).setDisabled(true))
      );

      const confirm = layoutMessage(`## ✅ **Thank you!**\n> You rated this ticket **${rating}/5**.`);
      await interaction.update({
        content: "",
        components: [...confirm.components, disabledRow.toJSON()]
      });
    } catch (e) {
      console.error("Rating handling failed:", e);
      return interaction.reply({ content: "Rating failed to log. Please try again.", ephemeral: true });
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

    // perms: opener + staffRole only
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

    // Log opened (component-based)
    try {
      const openedLog = layoutMessage(
        `## 🟢 **Ticket Opened**\n` +
          `> **Ticket:** <#${channel.id}> (\`${channel.id}\`)\n` +
          `> **Opener:** <@${interaction.user.id}>\n` +
          `> **Type:** **${ticketTypeLabel(ticketTypeValue)}**\n` +
          `> **Staff Role:** <@&${staffRoleId}>\n` +
          `> **Enquiry:** ${enquiry.length > 250 ? enquiry.slice(0, 250) + "…" : enquiry}`
      );
      await logTicket(client, conf, openedLog);
    } catch (e) {
      console.error("Log ticket opened failed:", e);
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
    } catch (e) {
      console.error("Toggle user failed:", e);
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

    // CLAIM
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

      // Log claimed
      try {
        const claimedLog = layoutMessage(
          `## 🟡 **Ticket Claimed**\n` +
            `> **Ticket:** <#${channel.id}> (\`${channel.id}\`)\n` +
            `> **Claimed By:** <@${interaction.user.id}>\n` +
            `> **Staff Role:** <@&${staffRoleId}>`
        );
        await logTicket(client, conf, claimedLog);
      } catch (e) {
        console.error("Log ticket claimed failed:", e);
      }

      // Optional visual update
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

      // Build HTML transcript
      let html = "";
      try {
        html = await buildTranscriptHtml(channel);
      } catch (e) {
        console.error("Transcript build failed:", e);
        html = htmlWrapper({
          title: `Ticket Transcript — #${channel.name}`,
          subtitle: `Channel ID: ${channel.id}`,
          bodyHtml: `<div class="meta"><div class="pill">Transcript failed to generate.</div></div>`
        });
      }

      const baseName = `ticket-${channel.id}.html`;
      const transcriptFiles = splitHtmlFiles({ html, baseName });

      // LOG: closed + transcript attachments
      try {
        const closedLog = layoutMessage(
          `## 🔴 **Ticket Closed**\n` +
            `> **Ticket:** <#${channel.id}> (\`${channel.id}\`)\n` +
            `> **Opener:** ${openerId ? `<@${openerId}>` : "*Unknown*"}\n` +
            `> **Type:** **${ticketTypeValue ? ticketTypeLabel(ticketTypeValue) : "Unknown"}**\n` +
            `> **Handler:** ${handlerId !== "none" ? `<@${handlerId}>` : "*Unclaimed*"}\n` +
            `> **Staff Role:** <@&${staffRoleId}>\n\n` +
            `> **Transcript:** Attached (${transcriptFiles.length} file${transcriptFiles.length === 1 ? "" : "s"}).`
        );
        await logTicket(client, conf, closedLog, transcriptFiles);
      } catch (e) {
        console.error("Log ticket closed failed:", e);
      }

      // DM opener: closed + transcript + rating buttons
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
            { ...dmBody, components: [...dmBody.components, row.toJSON()] },
            transcriptFiles
          );
        } catch (e) {
          console.error("DM transcript failed (user likely has DMs closed):", e);
        }
      }

      setTimeout(() => {
        channel.delete("Ticket closed").catch(() => {});
      }, 2500);

      return;
    }
  }
}
