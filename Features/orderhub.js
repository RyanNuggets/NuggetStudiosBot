// /Features/orderhub.js
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
export const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));
export const writeConfig = (conf) => fs.writeFileSync("./config.json", JSON.stringify(conf, null, 2));

// ---------------- IDS ----------------
const IDS = {
  // public order hub buttons
  orderLiveriesBtn: "orderhub_liveries",
  orderGraphicsBtn: "orderhub_graphics",

  // payment buttons (encoded with order type)
  payUsd: "orderhub_usd",
  payRobux: "orderhub_robux",

  // order ticket controls (inside ticket)
  ticketActionsSelect: "orderhub_ticket_actions_select",
  ticketUserToggleSelect: "orderhub_ticket_user_toggle_select",

  // close -> review prompt buttons
  reviewLeaveBtn: "orderhub_review_leave",
  reviewSkipBtn: "orderhub_review_skip",

  // review flow components
  reviewDesignerSelect: "orderhub_review_designer_select",
  reviewRatingSelect: "orderhub_review_rating_select",
  reviewProductSelect: "orderhub_review_product_select",
  reviewModal: "orderhub_review_modal",
  reviewModalInput: "orderhub_review_message"
};

// review state: key = `${channelId}:${userId}`
const REVIEW_STATE = new Map();

// Your custom emoji (NOTE: requires Use External Emojis if not from this server)
const STAR_EMOJI = "<:star:1467246556649623694>";
const STAR_EMOJI_OBJ = { id: "1467246556649623694", name: "star" };

// ---------------- ORDER HUB (PUBLIC MESSAGE) ----------------
const ORDER_HUB_LAYOUT = {
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
                url: "https://media.discordapp.net/attachments/1467051814733222043/1528161313589821540/Nugget_Studios_Banner_9.png?ex=6a5d4aa1&is=6a5bf921&hm=09aeaa561ae1cd270361f0f89cfbbf7ac5a3037d8b05d7615e0cf7a79d3513bb&=&format=webp&quality=lossless"
              }
            }
          ]
        },
        { type: 14, spacing: 1 },
        {
          type: 10,
          content:
            "## **Order Here**\n" +
            "Bring your vision to life with **Nugget Studios**. We specialize in **custom liveries, graphics, and brand identity**, delivering ***high-quality, affordable*** designs with **precision, consistency, and fast turnaround times**. Every order is carefully managed by our **trusted creative team** from **concept to completion**.\n\n" +
            "**Start an order** and our team will review your request shortly. **Choose one of the options below to continue.**\n\n" +
            "-# <:shield:1528162879524704407> All orders are subject to our Terms of Service: https://nuggetstudios.xyz/tos.\n\n" +
            "<:shoppingcart:1528163263861231847> **Select an Order Type:**\n" +
            "<:dot:1528163225806307519> **Liveries**  **`-`**  Order a custom vehicle livery\n" +
            "<:dot:1528163225806307519> **Graphics**  **`-`**  Order logos, banners, branding, and other custom graphics"
        },
        { type: 14, spacing: 2 },
        {
          type: 1,
          components: [
            { type: 2, style: 2, label: "Liveries", custom_id: IDS.orderLiveriesBtn },
            { type: 2, style: 2, label: "Graphics", custom_id: IDS.orderGraphicsBtn }
          ]
        }
      ]
    }
  ]
};

// ---------------- PAYMENT PROMPT (EPHEMERAL) ----------------
// IMPORTANT: raw JSON components only here (no ActionRowBuilder) to avoid toJSON builder mixing bugs
function buildPaymentPrompt(orderTypeLabel, encodedOrderType) {
  return {
    ephemeral: true,
    allowedMentions: { parse: [] },
    flags: 32768,
    components: [
      {
        type: 17,
        components: [
          // ---- Section 1 (was Embed 1: banner only) ----
          // No text for this section — just a bottom image slot. Paste your image link below.
          { type: 14, spacing: 2 },
          {
            type: 12,
            items: [
              {
                media: {
                  url: "https://media.discordapp.net/attachments/1467051814733222043/1528163718041571380/Nugget_Studios_Banner_10.png?ex=6a5d4cde&is=6a5bfb5e&hm=67de8ed6964cf3af35ee4a2d21bf5677e926629bbdf7c25de8ac6e2b018d566f&=&format=webp&quality=lossless"
                }
              }
            ]
          },
          { type: 14, spacing: 2 },

          // ---- Section 2 (was Embed 2: text + banner) ----
          {
            type: 10,
            content:
              "To proceed with your order, please select your **preferred payment method** below. Once payment is confirmed, your order will be officially queued.\n\n" +
              "<:wallet:1528165051859468348> **Available Payment Options:**\n" +
              "<:creditcard:1528164289192525996> **USD** <:dot:1528163225806307519> PayPal / Credit/Debit Card\n" +
              "<:robux:1528164258251018281> Robux <:dot:1528163225806307519> Robux payments are accepted for eligible orders\n\n" +
              `**Order Type:** **${orderTypeLabel}**`
          },
          { type: 14, spacing: 2 },
          // Bottom image slot for this section — paste your image link below.
          {
            type: 12,
            items: [
              {
                media: {
                  url: "https://media.discordapp.net/attachments/1486296464350249040/1527106449740791887/Dubai_Roleplay_Banner_Footer_1.png?ex=6a5cbff5&is=6a5b6e75&hm=abcf9e37cf46be3774576d9c1aa3e77e3042c3f0ce179eb4c485acb916cc5996&=&format=webp&quality=lossless&width=1872&height=97"
                }
              }
            ]
          },
          { type: 14, spacing: 2 },
          {
            type: 1,
            components: [
              { type: 2, style: 2, label: "USD", custom_id: `${IDS.payUsd}:${encodedOrderType}` },
              { type: 2, style: 2, label: "Robux", custom_id: `${IDS.payRobux}:${encodedOrderType}` }
            ]
          }
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

// tags (ONE open order per user, regardless of options)
const orderUserTag = (userId) => `ns_order_user:${userId}`;
const orderMetaTag = (orderType, payType) => `ns_order_meta:${orderType}:${payType}`;
const staffRoleTopicTag = (roleId) => `ns_staffrole:${roleId}`;
const claimedTopicTag = (staffId) => `ns_claimed:${staffId}`;

const hasClaimTag = (topic = "") => topic.includes("ns_claimed:");
const getClaimedBy = (topic = "") => {
  const m = topic.match(/ns_claimed:(\d{5,})/);
  return m ? m[1] : null;
};

const getStaffRoleFromTopic = (topic = "") => {
  const m = topic.match(/ns_staffrole:(\d{5,})/);
  return m ? m[1] : null;
};

const getOrderUserFromTopic = (topic = "") => {
  const m = topic.match(/ns_order_user:(\d{5,})/);
  return m ? m[1] : null;
};

const getOrderMetaFromTopic = (topic = "") => {
  const m = topic.match(/ns_order_meta:([a-z0-9_-]+):([a-z0-9_-]+)/i);
  if (!m) return { orderType: null, payType: null };
  return { orderType: m[1], payType: m[2] };
};

const appendTopicTag = (topic = "", tag = "") => (topic ? `${topic} | ${tag}` : tag).slice(0, 1024);

// ---------------- COOLDOWN (ANTI SPAM CLICK) ----------------
const clickCooldown = new Map(); // userId -> timestamp
const COOLDOWN_MS = 2500;

function cooldownHit(userId) {
  const now = Date.now();
  const last = clickCooldown.get(userId) ?? 0;
  if (now - last < COOLDOWN_MS) return true;
  clickCooldown.set(userId, now);
  return false;
}

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

async function logOrderMessage(client, ohConf, body) {
  const logId = ohConf.orderLogsChannelId;
  if (!logId) return;
  return postRaw(client, logId, body);
}

// ---------------- COMPONENT-BASED LAYOUT HELPERS (logs/DM) ----------------
function layoutMessage(contentMarkdown, { pingLine = null } = {}) {
  const components = [];
  if (pingLine) components.push({ type: 10, content: pingLine });

  components.push({
    type: 17,
    components: [
      {
        type: 12,
        items: [
          {
            media: {
              url: "https://media.discordapp.net/attachments/1467051814733222043/1528165504936575106/Nugget_Studios_Banner_11.png?ex=6a5d4e88&is=6a5bfd08&hm=418a2a4686331cd354bf19d03662e57296671e2439dff63953c095440e149de0&=&format=webp&quality=lossless"
            }
          }
        ]
      },
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

// ---------------- ORDER OPEN MESSAGE ----------------
function buildOrderOpenPayload({ userId, staffRoleId, orderTypeLabel, payTypeLabel }) {
  return {
    flags: 32768,
    allowed_mentions: { parse: ["users", "roles"] },
    components: [
      { type: 10, content: `-# <@${userId}> | <@&${staffRoleId}>` },
      {
        type: 17,
        components: [
          {
            type: 12,
            items: [
              {
                media: {
                  url: "https://media.discordapp.net/attachments/1467051814733222043/1528166118399672371/Nugget_Studios_Banner_13.png?ex=6a5d4f1a&is=6a5bfd9a&hm=d9182920f57f8bb526f0aa82d873d01fe192b6e0aac4102abb9ea1fc6d1458c7&=&format=webp&quality=lossless"
                }
              }
            ]
          },
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

// ---------------- FIND EXISTING OPEN ORDER (ANY OPTION) ----------------
async function findExistingOrderChannel(guild, oh, userId) {
  await guild.channels.fetch().catch(() => {});
  const tag = orderUserTag(userId);
  const cats = [oh?.categoryLiveriesId, oh?.categoryGraphicsId].filter(Boolean);

  return (
    guild.channels.cache.find(
      (ch) =>
        ch?.type === ChannelType.GuildText &&
        cats.includes(ch.parentId) &&
        typeof ch.topic === "string" &&
        ch.topic.includes(tag)
    ) ?? null
  );
}

// ---------------- CLOSE PROMPT (COMPLETED -> REVIEW OR SKIP) ----------------
function buildClosePromptPayload(openerId) {
  return {
    flags: 32768,
    allowed_mentions: { parse: ["users"] },
    components: [
      { type: 10, content: `-# <@${openerId}>` },
      {
        type: 17,
        components: [
          {
            type: 12,
            items: [
              {
                media: {
                  url: "https://media.discordapp.net/attachments/1467051814733222043/1528165504936575106/Nugget_Studios_Banner_11.png?ex=6a5d4e88&is=6a5bfd08&hm=418a2a4686331cd354bf19d03662e57296671e2439dff63953c095440e149de0&=&format=webp&quality=lossless"
                }
              }
            ]
          },
          { type: 14, spacing: 1 },
          {
            type: 10,
            content:
              "## Your order has now been completed!\n" +
              "If you’re happy with the final result, we’d appreciate you leaving a review — it helps us improve and supports Nugget Studios. If you’d prefer not to leave a review, select **Close without Review**."
          },
          { type: 14, spacing: 2 },
          {
            type: 1,
            components: [
              { type: 2, style: 2, label: "Leave a Review", custom_id: IDS.reviewLeaveBtn },
              { type: 2, style: 2, label: "Close Without Review", custom_id: IDS.reviewSkipBtn }
            ]
          }
        ]
      }
    ]
  };
}

// ---------------- REVIEW FLOW UI ----------------
function buildDesignerPickerEphemeral() {
  return {
    content:
      "Select the **designer** you’re reviewing.\n" +
      "> Only staff members can be reviewed. If you pick a non-staff user, it will be rejected.",
    components: [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(IDS.reviewDesignerSelect)
          .setPlaceholder("Choose a designer…")
          .setMinValues(1)
          .setMaxValues(1)
      )
    ],
    ephemeral: true
  };
}

function buildRatingSelectEphemeral() {
  return {
    content: "Select a **rating**:",
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(IDS.reviewRatingSelect)
          .setPlaceholder("Choose 1–5…")
          .addOptions([
            { label: "1", value: "1", emoji: STAR_EMOJI_OBJ },
            { label: "2", value: "2", emoji: STAR_EMOJI_OBJ },
            { label: "3", value: "3", emoji: STAR_EMOJI_OBJ },
            { label: "4", value: "4", emoji: STAR_EMOJI_OBJ },
            { label: "5", value: "5", emoji: STAR_EMOJI_OBJ }
          ])
      )
    ],
    ephemeral: true
  };
}

function buildProductSelectEphemeral() {
  return {
    content: "Select the **product** you ordered:",
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(IDS.reviewProductSelect)
          .setPlaceholder("Select a product…")
          .addOptions([
            { label: "Banner", value: "Banner" },
            { label: "Bundle", value: "Bundle" }
          ])
      )
    ],
    ephemeral: true
  };
}

// CLEAN review embed (normal embeds w/ fields like your example)
function buildCleanReviewEmbed({ userId, designerId, rating, product, message, orderChannelId }) {
  const count = Math.max(0, Math.min(5, parseInt(rating, 10) || 0));
  const stars = STAR_EMOJI.repeat(count);

  const safeMsg = String(message ?? "").trim() || "No message provided.";
  const clipped = safeMsg.length > 900 ? safeMsg.slice(0, 900) + "…" : safeMsg;

  return {
    flags: 32768,
    allowed_mentions: { parse: ["users"] },
    components: [
      {
        type: 17,
        components: [
          // ---- Section 1 (was Embed 1: banner only) ----
          // No text for this section — just a bottom image slot. Paste your image link below.
          { type: 14, spacing: 2 },
          {
            type: 12,
            items: [
              {
                media: {
                  url: "https://media.discordapp.net/attachments/1467051814733222043/1528166816273272912/Nugget_Studios_Banner_15.png?ex=6a5d4fc0&is=6a5bfe40&hm=3c360dd1ac9152fe99c6ec17bd01fa92e4a1b97b04bf33a12ddc314c56e20e7b&=&format=webp&quality=lossless"
                }
              }
            ]
          },
          { type: 14, spacing: 2 },

          // ---- Section 2 (was Embed 2: text + fields + banner) ----
          {
            type: 10,
            content:
              `## New Order Review\n` +
              `> Review left by <@${userId}>.\n\n` +
              `**Designer:** <@${designerId}>\n` +
              `**Rating:** ${stars || "—"}\n` +
              `**Product:** **${product}**\n` +
              `**Feedback:** ${clipped}`
          },
          { type: 14, spacing: 2 },
          // Bottom image slot for this section — paste your image link below.
          {
            type: 12,
            items: [
              {
                media: {
                  url: "https://media.discordapp.net/attachments/1486296464350249040/1527106449740791887/Dubai_Roleplay_Banner_Footer_1.png?ex=6a5cbff5&is=6a5b6e75&hm=abcf9e37cf46be3774576d9c1aa3e77e3042c3f0ce179eb4c485acb916cc5996&=&format=webp&quality=lossless&width=1872&height=97"
                }
              }
            ]
          }
        ]
      }
    ]
  };
}

// ---------------- CLOSE FLOW (TRANSCRIPT + LOG + DM + DELETE) ----------------
async function closeOrderNow(client, interaction, channel, oh) {
  const topic = channel.topic ?? "";
  const openerId = getOrderUserFromTopic(topic);
  const { orderType, payType } = getOrderMetaFromTopic(topic);
  const handlerId = getClaimedBy(topic) ?? "none";

  const staffRoleId = getStaffRoleFromTopic(topic) || oh?.staffRoleId;

  const orderTypeLabel = orderType === "graphics" ? "Graphics" : "Liveries";
  const payTypeLabel = payType === "usd" ? "USD" : payType === "robux" ? "Robux" : "Unknown";

  // Log: closed
  try {
    const closedLog = layoutMessage(
      `## 🔴 **Order Closed**\n` +
        `> **Order:** <#${channel.id}> (\`${channel.id}\`)\n` +
        `> **User:** ${openerId ? `<@${openerId}>` : "*Unknown*"}\n` +
        `> **Type:** **${orderTypeLabel}**\n` +
        `> **Payment:** **${payTypeLabel}**\n` +
        `> **Handler:** ${handlerId !== "none" ? `\`${handlerId}\`` : "*Unclaimed*"}`
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

  // Transcript to logs
  try {
    await sendPlainTranscriptToChannel(client, oh.orderLogsChannelId, channel.id, transcriptText);
  } catch (e) {
    console.error("[ORDERHUB] transcript to logs failed:", e);
  }

  // DM opener: closed + transcript
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

  // Delete
  setTimeout(() => {
    channel.delete("Order closed").catch(() => {});
  }, 2500);

  // Try to acknowledge interaction (best effort)
  try {
    if (interaction?.isRepliable?.()) {
      const payload = { content: "✅ Order closed.", ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  } catch {}
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

  if (!oh) return;

  // only run in main server (if you set guildId)
  if (globalGuildId && interaction.guild?.id && interaction.guild.id !== globalGuildId) return;

  // ---------------- BUTTONS ----------------
  if (interaction.isButton?.()) {
    // anti-spam
    if (cooldownHit(interaction.user.id)) {
      return interaction.reply({ content: "Slow down 😭", ephemeral: true }).catch(() => {});
    }

    const channel = interaction.channel;

    // ORDER TYPE -> PAYMENT PROMPT
    if (interaction.customId === IDS.orderLiveriesBtn || interaction.customId === IDS.orderGraphicsBtn) {
      // SERVICE OPEN/CLOSE GATE (set via /servicechange)
      const serviceKey = interaction.customId === IDS.orderLiveriesBtn ? "liveries" : "graphics";
      const serviceLabel = serviceKey === "liveries" ? "Liveries" : "Graphics";
      const serviceStatus = oh?.serviceStatus?.[serviceKey] ?? "open";

      if (serviceStatus === "closed") {
        return interaction.reply({
          content: `🔒 **${serviceLabel} orders are currently closed.** Please wait until it's announced open again.`,
          ephemeral: true
        });
      }

      // ONE open order total
      const existing = await findExistingOrderChannel(interaction.guild, oh, interaction.user.id);
      if (existing) {
        return interaction.reply({ content: `You already have an open order: <#${existing.id}>`, ephemeral: true });
      }

      if (interaction.customId === IDS.orderLiveriesBtn) {
        return interaction.reply(buildPaymentPrompt("Liveries", "liveries"));
      }
      return interaction.reply(buildPaymentPrompt("Graphics", "graphics"));
    }

    // PAYMENT -> CREATE ORDER TICKET
    if (
      interaction.customId.startsWith(IDS.payUsd + ":") ||
      interaction.customId.startsWith(IDS.payRobux + ":")
    ) {
      // ONE open order total
      const existing = await findExistingOrderChannel(interaction.guild, oh, interaction.user.id);
      if (existing) {
        return interaction.reply({ content: `You already have an open order: <#${existing.id}>`, ephemeral: true });
      }

      const [base, orderType] = interaction.customId.split(":");
      const payType = base === IDS.payUsd ? "usd" : "robux";

      const guild = interaction.guild;
      if (!guild) return interaction.reply({ content: "Server only.", ephemeral: true });

      if (!oh?.staffRoleId) {
        return interaction.reply({ content: "Missing orderhub.staffRoleId in config.json", ephemeral: true });
      }
      if (!oh?.categoryLiveriesId || !oh?.categoryGraphicsId) {
        return interaction.reply({
          content: "Missing orderhub.categoryLiveriesId / orderhub.categoryGraphicsId in config.json",
          ephemeral: true
        });
      }

      // Category is determined by order type (Liveries/Graphics); the
      // channel name is differentiated by payment method (usd/robux).
      const parentId = orderType === "graphics" ? oh.categoryGraphicsId : oh.categoryLiveriesId;

      const channelName = safeChannelName(`${payType}-${interaction.user.username}`);

      const topic =
        appendTopicTag(
          appendTopicTag(orderUserTag(interaction.user.id), orderMetaTag(orderType, payType)),
          staffRoleTopicTag(oh.staffRoleId)
        );

      const created = await guild.channels.create({
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

      const orderTypeLabel = orderType === "graphics" ? "Graphics" : "Liveries";
      const payTypeLabel = payType === "usd" ? "USD" : "Robux";

      await postRaw(
        client,
        created.id,
        buildOrderOpenPayload({
          userId: interaction.user.id,
          staffRoleId: oh.staffRoleId,
          orderTypeLabel,
          payTypeLabel
        })
      );

      // log opened
      try {
        const openedLog = layoutMessage(
          `## 🟢 **Order Opened**\n` +
            `> **Order:** <#${created.id}> (\`${created.id}\`)\n` +
            `> **User:** <@${interaction.user.id}>\n` +
            `> **Type:** **${orderTypeLabel}**\n` +
            `> **Payment:** **${payTypeLabel}**`
        );
        await logOrderMessage(client, oh, openedLog);
      } catch (e) {
        console.error("[ORDERHUB] open log failed:", e);
      }

      return interaction.reply({ content: `✅ Your order has been created: <#${created.id}>`, ephemeral: true });
    }

    // REVIEW BUTTONS (posted inside the order channel)
    if (interaction.customId === IDS.reviewLeaveBtn || interaction.customId === IDS.reviewSkipBtn) {
      if (!channel) return interaction.reply({ content: "No channel found.", ephemeral: true });

      const openerId = getOrderUserFromTopic(channel.topic ?? "");
      if (!openerId) return interaction.reply({ content: "Could not find the order owner.", ephemeral: true });

      // Leave a Review -> ONLY opener
      if (interaction.customId === IDS.reviewLeaveBtn) {
        if (interaction.user.id !== openerId) {
          return interaction.reply({ content: "Only the customer can use these buttons.", ephemeral: true });
        }

        REVIEW_STATE.set(`${channel.id}:${interaction.user.id}`, {
          userId: interaction.user.id,
          orderChannelId: channel.id
        });

        return interaction.reply(buildDesignerPickerEphemeral());
      }

      // Close Without Review -> allow anyone (staff can close inactive tickets)
      await interaction.reply({ content: "Closing without review…", ephemeral: true }).catch(() => {});
      return closeOrderNow(client, interaction, channel, oh);
    }
  }

  // ---------------- SELECT MENUS ----------------

  // Ticket actions dropdown (inside order ticket)
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
            `> **Claimed By:** <@${interaction.user.id}>`
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

    // CLOSE -> post completed prompt (review/skip)
    if (action === "close") {
      const topic = channel.topic ?? "";
      const openerId = getOrderUserFromTopic(topic);

      await interaction.reply({ content: "Sent close options.", ephemeral: true }).catch(() => {});
      if (!openerId) return;

      await postRaw(client, channel.id, buildClosePromptPayload(openerId)).catch((e) => {
        console.error("[ORDERHUB] failed to send close prompt:", e);
      });

      return;
    }
  }

  // Add/Remove user picker
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
      return interaction.reply({ content: "You can’t add or remove staff members from orders.", ephemeral: true });
    }

    const existingOw = channel.permissionOverwrites.cache.get(targetId);
    const hasViewAllow = existingOw?.allow?.has(PermissionFlagsBits.ViewChannel) ?? false;

    try {
      if (existingOw && hasViewAllow) {
        await channel.permissionOverwrites.delete(targetId);
        return interaction.reply({ content: `Removed <@${targetId}> from this order.`, ephemeral: true });
      } else {
        await channel.permissionOverwrites.edit(targetId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
          EmbedLinks: true
        });
        return interaction.reply({ content: `Added <@${targetId}> to this order.`, ephemeral: true });
      }
    } catch (e) {
      console.error("[ORDERHUB] Toggle user failed:", e);
      return interaction.reply({ content: "Failed to update order permissions.", ephemeral: true });
    }
  }

  // ---------------- REVIEW FLOW SELECTS ----------------
  // designer select -> validate staff role -> rating select
  if (interaction.isUserSelectMenu?.() && interaction.customId === IDS.reviewDesignerSelect) {
    const channel = interaction.channel;
    if (!channel) return interaction.reply({ content: "No channel found.", ephemeral: true });

    const key = `${channel.id}:${interaction.user.id}`;
    const state = REVIEW_STATE.get(key);
    if (!state) {
      return interaction.reply({
        content: "Review session expired. Click **Leave a Review** again.",
        ephemeral: true
      });
    }

    const designerId = interaction.values?.[0];
    if (!designerId) return interaction.reply({ content: "No user selected.", ephemeral: true });

    const staffRoleId = oh?.staffRoleId;
    if (!staffRoleId) {
      return interaction.reply({ content: "Missing orderhub.staffRoleId in config.json", ephemeral: true });
    }

    const member = await interaction.guild?.members.fetch(designerId).catch(() => null);
    const isStaff = member?.roles?.cache?.has(staffRoleId) ?? false;

    if (!isStaff) {
      return interaction.reply({
        content: "That user isn’t a staff/designer. Please select a valid **staff member**.",
        ephemeral: true
      });
    }

    state.designerId = designerId;
    REVIEW_STATE.set(key, state);

    return interaction.reply(buildRatingSelectEphemeral());
  }

  // rating select -> product select
  if (interaction.isStringSelectMenu?.() && interaction.customId === IDS.reviewRatingSelect) {
    const channel = interaction.channel;
    if (!channel) return interaction.reply({ content: "No channel found.", ephemeral: true });

    const key = `${channel.id}:${interaction.user.id}`;
    const state = REVIEW_STATE.get(key);
    if (!state) {
      return interaction.reply({
        content: "Review session expired. Click **Leave a Review** again.",
        ephemeral: true
      });
    }

    state.rating = interaction.values?.[0];
    REVIEW_STATE.set(key, state);

    return interaction.reply(buildProductSelectEphemeral());
  }

  // product select -> modal
  if (interaction.isStringSelectMenu?.() && interaction.customId === IDS.reviewProductSelect) {
    const channel = interaction.channel;
    if (!channel) return interaction.reply({ content: "No channel found.", ephemeral: true });

    const key = `${channel.id}:${interaction.user.id}`;
    const state = REVIEW_STATE.get(key);
    if (!state) {
      return interaction.reply({
        content: "Review session expired. Click **Leave a Review** again.",
        ephemeral: true
      });
    }

    state.product = interaction.values?.[0];
    REVIEW_STATE.set(key, state);

    const modal = new ModalBuilder().setCustomId(IDS.reviewModal).setTitle("Leave a Review");

    const input = new TextInputBuilder()
      .setCustomId(IDS.reviewModalInput)
      .setLabel("Your feedback")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(5)
      .setMaxLength(900);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // modal submit -> post review -> close order
  if (interaction.isModalSubmit?.() && interaction.customId === IDS.reviewModal) {
    const channel = interaction.channel;
    if (!channel) return interaction.reply({ content: "No channel found.", ephemeral: true });

    const key = `${channel.id}:${interaction.user.id}`;
    const state = REVIEW_STATE.get(key);

    if (!state?.designerId || !state?.rating || !state?.product) {
      return interaction.reply({
        content: "Review session expired. Click **Leave a Review** again.",
        ephemeral: true
      });
    }

    if (!oh?.reviewChannelId) {
      return interaction.reply({ content: "Missing **orderhub.reviewChannelId** in config.json", ephemeral: true });
    }

    const feedback = interaction.fields.getTextInputValue(IDS.reviewModalInput);

    await postRaw(
      client,
      oh.reviewChannelId,
      buildCleanReviewEmbed({
        userId: interaction.user.id,
        designerId: state.designerId,
        rating: state.rating,
        product: state.product,
        message: feedback,
        orderChannelId: channel.id
      })
    ).catch((e) => console.error("[ORDERHUB] review post failed:", e));

    REVIEW_STATE.delete(key);

    await interaction
      .reply({ content: "✅ Review submitted. Closing the order…", ephemeral: true })
      .catch(() => {});

    return closeOrderNow(client, interaction, channel, oh);
  }
}
