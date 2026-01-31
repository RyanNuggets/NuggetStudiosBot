// /Features/orderhub.js
import { Routes } from "discord-api-types/v10";
import {
  ActionRowBuilder,
  ChannelType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder
} from "discord.js";
import fs from "fs";

// ---------------- CONFIG ----------------
const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));

// ---------------- IDS (ORDER HUB) ----------------
const IDS = {
  // public order hub buttons
  orderStandardBtn: "orderhub_standard",
  orderPackageBtn: "orderhub_package",

  // payment buttons (encoded with order type)
  payPaypal: "orderhub_paypal",
  payCard: "orderhub_card",
  payRobux: "orderhub_robux",

  // ticket actions (same behavior as support tickets)
  ticketActionsSelect: "orderhub_ticket_actions_select",
  ticketUserToggleSelect: "orderhub_ticket_user_toggle_select"
};

// ---------------- BRAND / IMAGES ----------------
const BRAND_IMAGE =
  "https://media.discordapp.net/attachments/1467051814733222043/1467051887936147486/Dashboard_1.png?ex=697efa0a&is=697da88a&hm=7f3d70a98d76fe62886d729de773f0d2d178184711381f185521366f88f93423&=&format=webp&quality=lossless&width=550&height=165";

// ---------------- ORDER HUB MESSAGE (PUBLIC; COMPONENT-V2 OK) ----------------
const ORDER_HUB_LAYOUT = {
  flags: 32768,
  components: [
    {
      type: 17,
      components: [
        {
          type: 12,
          items: [{ media: { url: BRAND_IMAGE } }]
        },
        { type: 14, spacing: 1 },
        {
          type: 10,
          content:
            "## **Order Here**\n" +
            "Looking for a **custom, high-quality banner or graphic**? Start an order and our team will review your request shortly. Choose one of the options below to continue.\n\n" +
            "<:shoppingcart:1467165075025432618> **Select an Order Type:**\n" +
            "<:dot:1467233440117297203> **Standard Order**  **`-`**  Order a single custom banner or graphic\n" +
            "<:dot:1467233440117297203> **Package Order**  **`-`**  Order multiple designs in one bundle"
        },
        { type: 14, spacing: 2 },
        {
          type: 1,
          components: [
            { type: 2, style: 2, label: "Standard Order", custom_id: IDS.orderStandardBtn },
            { type: 2, style: 2, label: "Package Order", custom_id: IDS.orderPackageBtn }
          ]
        }
      ]
    }
  ]
};

// ---------------- PAYMENT PROMPT (EPHEMERAL EMBED + BUTTONS) ----------------
// NOTE: Must be RAW JSON components (not builders) to avoid "toJSON is not a function"
function buildPaymentPrompt(orderTypeLabel, encodedOrderType) {
  return {
    ephemeral: true,
    allowedMentions: { parse: [] },
    embeds: [
      { image: { url: BRAND_IMAGE } },
      {
        description:
          "## **Payment Method**\n" +
          "To proceed with your order, please select your **preferred payment method** below. Once payment is confirmed, your order will be officially queued.\n\n" +
          "**`-`** **Available Payment Options:**\n" +
          "<:paypal:1467236926993072280> **PayPal**  **`-`**  Fast and secure online payments\n" +
          "<:card:1467165047624302664> **Credit/Debit Cards**  **`-`**  All major credit/debit cards accepted\n" +
          "<:robux:1467165348565487841> **Robux**  **`-`**  Robux payments are accepted for eligible orders\n\n" +
          `**Order Type:** **${orderTypeLabel}**`
      }
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 2, label: "PayPal", custom_id: `${IDS.payPaypal}:${encodedOrderType}` },
          {
            type: 2,
            style: 2,
            label: "Credit/Debit Card",
            custom_id: `${IDS.payCard}:${encodedOrderType}`
          },
          { type: 2, style: 2, label: "Robux", custom_id: `${IDS.payRobux}:${encodedOrderType}` }
        ]
      }
    ]
  };
}

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

// topic tags (separate namespace so it doesn’t collide with support tickets)
const orderTopicTag = (userId, orderType, payType) => `ns_order:${userId}:${orderType}:${payType}`;
const staffRoleTopicTag = (roleId) => `ns_staffrole:${roleId}`;
const claimedTopicTag = (staffId) => `ns_claimed:${staffId}`;

const hasClaimTag = (topic = "") => topic.includes("ns_claimed:");
const getClaimedBy = (topic = "") => {
  const m = topic.match(/ns_claimed:(\d{5,})/);
  return m ? m[1] : null;
};

const getOrderInfoFromTopic = (topic = "") => {
  const m = topic.match(/ns_order:(\d{5,}):([a-z0-9_-]+):([a-z0-9_-]+)/i);
  if (!m) return { openerId: null, orderType: null, payType: null };
  return { openerId: m[1], orderType: m[2], payType: m[3] };
};

const getStaffRoleFromTopic = (topic = "") => {
  const m = topic.match(/ns_staffrole:(\d{5,})/);
  return m ? m[1] : null;
};

const appendTopicTag = (topic = "", tag = "") => (topic ? `${topic} | ${tag}` : tag).slice(0, 1024);

// ---------------- REST SEND HELPERS ----------------
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

async function postRawDM(client, userId, body) {
  const dmId = await getDmChannelId(client, userId);
  return postRaw(client, dmId, body);
}

async function logOrderMessage(client, conf, body) {
  const logId = conf.orderLogsChannelId;
  if (!logId) return;
  return postRaw(client, logId, body);
}

// ---------------- LOG / DM COMPONENT LAYOUT ----------------
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

// ---------------- TRANSCRIPT ----------------
async function buildTranscriptTxt(channel, maxMessages = 4000) {
  const lines = [];
  lines.push(`Order Transcript`);
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

async function sendPlainTranscriptToChannel(client, channelId, orderId, transcriptText) {
  if (!channelId) return;
  const chunks = splitPlainTextMessages(transcriptText, 1800);

  await postRaw(client, channelId, {
    content: `**Transcript for order \`${orderId}\`** (${chunks.length} message${
      chunks.length === 1 ? "" : "s"
    })`
  });

  for (const chunk of chunks) {
    await postRaw(client, channelId, { content: "```txt\n" + chunk + "\n```" });
  }
}

async function sendPlainTranscriptToDM(client, userId, orderId, transcriptText) {
  const chunks = splitPlainTextMessages(transcriptText, 1800);

  await postRawDM(client, userId, {
    content: `**Your transcript for order \`${orderId}\`** (${chunks.length} message${
      chunks.length === 1 ? "" : "s"
    })`
  });

  for (const chunk of chunks) {
    await postRawDM(client, userId, { content: "```txt\n" + chunk + "\n```" });
  }
}

// ---------------- BUILD ORDER OPEN MESSAGE ----------------
function buildOrderOpenPayload({ userId, staffRoleId, orderTypeLabel, payTypeLabel }) {
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
              `## **Order Request Received**\n` +
              `> Thanks for choosing **Nugget Studios**. Your order request has been received and is now in our queue.\n` +
              `> Please provide all relevant details (references, theme, text, size, deadline). Avoid tagging staff directly.\n\n` +
              `### **Order Information:**\n` +
              `> *User:* <@${userId}>\n` +
              `> *Order Type:* **${orderTypeLabel}**\n` +
              `> *Payment:* **${payTypeLabel}**\n\n` +
              `### **Next Step:**\n` +
              `> Send your order details in this channel. A staff member will respond shortly.`
          },
          { type: 14, spacing: 2 },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: IDS.ticketActionsSelect,
                placeholder: "Order Actions…",
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

// ---------------- SEND ORDER HUB MESSAGE ----------------
export async function sendOrderHub(client) {
  const conf = readConfig();
  const oh = conf.orderhub;

  if (!oh?.orderHubChannelId) throw new Error("Missing config.orderhub.orderHubChannelId");
  await postRaw(client, oh.orderHubChannelId, ORDER_HUB_LAYOUT);
  console.log("✅ Order Hub sent");
}

// ---------------- INTERACTION HANDLER ----------------
export async function handleOrderHubInteractions(client, interaction) {
  const conf = readConfig();
  const oh = conf.orderhub;
  const globalGuildId = conf.guildId;

  // only run in your main server
  if (globalGuildId && interaction.guild?.id && interaction.guild.id !== globalGuildId) return;

  // -------- Order type buttons -> show payment method (ephemeral) --------
  if (interaction.isButton?.()) {
    if (interaction.customId === IDS.orderStandardBtn) {
      return interaction.reply(buildPaymentPrompt("Standard Order", "standard"));
    }
    if (interaction.customId === IDS.orderPackageBtn) {
      return interaction.reply(buildPaymentPrompt("Package Order", "package"));
    }

    // -------- Payment buttons -> open ticket --------
    if (
      interaction.customId.startsWith(IDS.payPaypal + ":") ||
      interaction.customId.startsWith(IDS.payCard + ":") ||
      interaction.customId.startsWith(IDS.payRobux + ":")
    ) {
      const [base, orderType] = interaction.customId.split(":");
      const payType = base === IDS.payPaypal ? "paypal" : base === IDS.payCard ? "card" : "robux";

      const guild = interaction.guild;
      if (!guild) return interaction.reply({ content: "Server only.", ephemeral: true });

      if (!oh?.staffRoleId) {
        return interaction.reply({
          content: "Missing orderhub.staffRoleId in config.json",
          ephemeral: true
        });
      }
      if (!oh?.categoryFiatId || !oh?.categoryRobuxId) {
        return interaction.reply({
          content: "Missing orderhub.categoryFiatId / orderhub.categoryRobuxId in config.json",
          ephemeral: true
        });
      }

      const parentId = payType === "robux" ? oh.categoryRobuxId : oh.categoryFiatId;

      // one open order per type per user (within that category)
      await guild.channels.fetch().catch(() => {});
      const tag = orderTopicTag(interaction.user.id, orderType, payType);

      const existing = guild.channels.cache.find((ch) => {
        return (
          ch?.type === ChannelType.GuildText &&
          ch?.parentId === parentId &&
          typeof ch.topic === "string" &&
          ch.topic.includes(`ns_order:${interaction.user.id}:${orderType}`)
        );
      });

      if (existing) {
        return interaction.reply({
          content: `You already have an open **${orderType}** order: <#${existing.id}>`,
          ephemeral: true
        });
      }

      const channelName = safeChannelName(
        (oh.orderChannelNameFormat ?? "order-{username}").replace(
          "{username}",
          interaction.user.username
        )
      );

      const topic = appendTopicTag(tag, staffRoleTopicTag(oh.staffRoleId));

      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: parentId,
        topic,
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
            id: oh.staffRoleId,
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

      const orderTypeLabel = orderType === "package" ? "Package Order" : "Standard Order";
      const payTypeLabel =
        payType === "paypal" ? "PayPal" : payType === "card" ? "Credit/Debit Card" : "Robux";

      await postRaw(
        client,
        channel.id,
        buildOrderOpenPayload({
          userId: interaction.user.id,
          staffRoleId: oh.staffRoleId,
          orderTypeLabel,
          payTypeLabel
        })
      );

      // Log opened
      try {
        const openedLog = layoutMessage(
          `## 🟢 **Order Opened**\n` +
            `> **Order:** <#${channel.id}> (\`${channel.id}\`)\n` +
            `> **User:** <@${interaction.user.id}>\n` +
            `> **Type:** **${orderTypeLabel}**\n` +
            `> **Payment:** **${payTypeLabel}**\n` +
            `> **Staff Role:** <@&${oh.staffRoleId}>`
        );
        await logOrderMessage(client, oh, openedLog);
      } catch (e) {
        console.error("[ORDERHUB] open log failed:", e);
      }

      return interaction.reply({
        content: `✅ Your order has been created: <#${channel.id}>`,
        ephemeral: true
      });
    }
  }

  // -------- Ticket Actions select menu --------
  if (interaction.isStringSelectMenu?.() && interaction.customId === IDS.ticketActionsSelect) {
    const action = interaction.values[0];
    const channel = interaction.channel;
    const msg = interaction.message;
    if (!channel) return;

    const staffRoleId = getStaffRoleFromTopic(channel.topic ?? "") || oh?.staffRoleId;

    if (!staffRoleId || !hasRole(interaction, staffRoleId)) {
      return interaction.reply({
        content: "Only the assigned staff team for this order can use order actions.",
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
            ? `This order is already claimed by <@${claimedBy}>.`
            : "This order has already been claimed.",
          ephemeral: true
        });
      }

      const claimMessage = `Hello! My name is <@${interaction.user.id}> and I’ll be assisting you with this order.`;
      await msg.reply({ content: claimMessage, allowedMentions: { parse: ["users"] } });

      try {
        await channel.setTopic(appendTopicTag(topic, claimedTopicTag(interaction.user.id)));
      } catch {}

      try {
        const claimedLog = layoutMessage(
          `## 🟡 **Order Claimed**\n` +
            `> **Order:** <#${channel.id}> (\`${channel.id}\`)\n` +
            `> **Claimed By:** <@${interaction.user.id}>\n` +
            `> **Staff Role:** <@&${staffRoleId}>`
        );
        await logOrderMessage(client, oh, claimedLog);
      } catch (e) {
        console.error("[ORDERHUB] claim log failed:", e);
      }

      return interaction.reply({ content: "Order claimed.", ephemeral: true });
    }

    // TOGGLE USER
    if (action === "toggle_user") {
      const picker = new UserSelectMenuBuilder()
        .setCustomId(IDS.ticketUserToggleSelect)
        .setPlaceholder("Select a user to add/remove…")
        .setMinValues(1)
        .setMaxValues(1);

      return interaction.reply({
        content: "Select a user to **add/remove** from this order:",
        components: [new ActionRowBuilder().addComponents(picker)],
        ephemeral: true
      });
    }

    // CLOSE
    if (action === "close") {
      await interaction.reply({ content: "Closing order… generating transcript.", ephemeral: true });

      const topic = channel.topic ?? "";
      const { openerId, orderType, payType } = getOrderInfoFromTopic(topic);
      const handlerId = getClaimedBy(topic) ?? "none";

      const orderTypeLabel = orderType === "package" ? "Package Order" : "Standard Order";
      const payTypeLabel =
        payType === "paypal" ? "PayPal" : payType === "card" ? "Credit/Debit Card" : "Robux";

      // Log closed
      try {
        const closedLog = layoutMessage(
          `## 🔴 **Order Closed**\n` +
            `> **Order:** <#${channel.id}> (\`${channel.id}\`)\n` +
            `> **User:** ${openerId ? `<@${openerId}>` : "*Unknown*"}\n` +
            `> **Type:** **${orderTypeLabel}**\n` +
            `> **Payment:** **${payTypeLabel}**\n` +
            `> **Handler:** ${handlerId !== "none" ? `\`${handlerId}\`` : "*Unclaimed*"}\n` +
            `> **Staff Role:** <@&${staffRoleId}>`
        );
        await logOrderMessage(client, oh, closedLog);
      } catch (e) {
        console.error("[ORDERHUB] closed log failed:", e);
      }

      // Transcript
      let transcriptText = "";
      try {
        transcriptText = await buildTranscriptTxt(channel);
      } catch (e) {
        console.error("[ORDERHUB] transcript build failed:", e);
        transcriptText = `Transcript failed to generate.\nChannel: #${channel.name} (${channel.id})`;
      }

      // Send transcript to logs
      try {
        await sendPlainTranscriptToChannel(client, oh.orderLogsChannelId, channel.id, transcriptText);
      } catch (e) {
        console.error("[ORDERHUB] transcript to logs failed:", e);
      }

      // DM opener
      if (openerId) {
        try {
          const dmBody = layoutMessage(
            `## ✅ **Your order has been closed**\n` +
              `> **Order ID:** \`${channel.id}\`\n` +
              `> **Type:** **${orderTypeLabel}**\n` +
              `> **Payment:** **${payTypeLabel}**\n` +
              `> **Handler:** ${handlerId !== "none" ? `\`${handlerId}\`` : "Unclaimed"}\n\n` +
              `> If you need anything else, you can open a new order from the Order Hub.`
          );
          await postRawDM(client, openerId, dmBody);
        } catch (e) {
          console.error("[ORDERHUB] DM closed failed:", e);
        }

        try {
          await sendPlainTranscriptToDM(client, openerId, channel.id, transcriptText);
        } catch (e) {
          console.error("[ORDERHUB] DM transcript failed:", e);
        }
      }

      setTimeout(() => {
        channel.delete("Order closed").catch(() => {});
      }, 2500);

      return;
    }
  }

  // -------- Add/Remove user picker --------
  if (interaction.isUserSelectMenu?.() && interaction.customId === IDS.ticketUserToggleSelect) {
    const channel = interaction.channel;
    if (!channel) return interaction.reply({ content: "No channel found.", ephemeral: true });

    const staffRoleId = getStaffRoleFromTopic(channel.topic ?? "") || oh?.staffRoleId;

    if (!staffRoleId || !hasRole(interaction, staffRoleId)) {
      return interaction.reply({
        content: "Only the assigned staff team for this order can manage order users.",
        ephemeral: true
      });
    }

    const targetId = interaction.values?.[0];
    if (!targetId) return interaction.reply({ content: "No user selected.", ephemeral: true });

    const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
    const isStaff = targetMember?.roles?.cache?.has?.(staffRoleId) ?? false;

    if (isStaff) {
      return interaction.reply({
        content: "You can’t add or remove staff members from orders.",
        ephemeral: true
      });
    }

    const existingOw = channel.permissionOverwrites.cache.get(targetId);
    const hasViewAllow = existingOw?.allow?.has(PermissionFlagsBits.ViewChannel) ?? false;

    try {
      if (existingOw && hasViewAllow) {
        await channel.permissionOverwrites.delete(targetId);
        return interaction.reply({
          content: `Removed <@${targetId}> from this order.`,
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
          content: `Added <@${targetId}> to this order.`,
          ephemeral: true
        });
      }
    } catch (e) {
      console.error("[ORDERHUB] Toggle user failed:", e);
      return interaction.reply({ content: "Failed to update order permissions.", ephemeral: true });
    }
  }
}
