const noblox = require("noblox.js"); // install this
const { EmbedBuilder } = require("discord.js"); // should already be installed
const fetch = require("node-fetch"); // install this
const { HttpsProxyAgent } = require("https-proxy-agent"); // install this
require("dotenv").config(); // install this

const config = require("./config.json");

// ---------------- CONFIG SOURCES ----------------
// ✅ groupId now comes from config.packages.groupId (matches your packageSystem watcher)
const group = Number(config?.packages?.groupId);

// ✅ guild/server id now comes from config.guildId
const discordServerId = String(config?.guildId);

// ✅ default channel id moved into config.purchaseMonitor.channelId
const defaultChannel = String(config?.purchaseMonitor?.channelId);

// ✅ proxy moved into config.purchaseMonitor.proxyUrl (optional)
const proxyUrl = config?.purchaseMonitor?.proxyUrl || null;
const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

// ✅ env names aligned with your Railway variables
const bloxlinkApiKey = process.env.BLOXLINK_API_KEY;
const robloxCookie = process.env.ROBLOX_COOKIE; // (your Railway env)

// ---------------- VALIDATION (helps debugging) ----------------
if (!group || Number.isNaN(group)) {
  console.error("❌ purchasemonitor: Missing/invalid config.packages.groupId");
}
if (!discordServerId) {
  console.error("❌ purchasemonitor: Missing config.guildId");
}
if (!defaultChannel) {
  console.error("❌ purchasemonitor: Missing config.purchaseMonitor.channelId");
}
if (!bloxlinkApiKey) {
  console.error("❌ purchasemonitor: Missing env BLOXLINK_API_KEY");
}
if (!robloxCookie) {
  console.error("❌ purchasemonitor: Missing env ROBLOX_COOKIE");
}

// ---------------- QUEUE ----------------
const queue = [];
let isProcessing = false;

async function getDiscordIdFromBloxlink(robloxID) {
  const url = `https://api.blox.link/v4/public/guilds/${discordServerId}/roblox-to-discord/${robloxID}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: bloxlinkApiKey }
    });
    const data = await response.json();

    return data.discordIDs?.[0] ?? null;
  } catch (error) {
    console.error("Error fetching Discord ID from Bloxlink:", error);
    return null;
  }
}

async function listenForPurchases(client) {
  let latestTransactionDate = new Date();

  setInterval(() => {
    queue.push(async () => {
      try {
        // ✅ keep logic same, just pass agent only if proxyUrl provided
        const transactions = await noblox.getGroupTransactions(group, "Sale", agent ? { agent } : undefined);

        for (const transaction of transactions) {
          if (new Date(transaction.created) > latestTransactionDate) {
            latestTransactionDate = new Date(transaction.created);
            await sendPurchaseEmbed(client, transaction);
          }
        }
      } catch (err) {
        if (err.message && err.message.includes("429")) {
          console.log("Rate limited. Waiting...");
          await new Promise((res) => setTimeout(res, 60000));
        } else {
          console.error("Error fetching transactions:", err);
        }
      }
    });

    if (!isProcessing) processQueue();
  }, 20000);
}

async function processQueue() {
  isProcessing = true;

  while (queue.length > 0) {
    const task = queue.shift();
    await task();
    await new Promise((res) => setTimeout(res, 5000));
  }

  isProcessing = false;
}

async function sendPurchaseEmbed(client, transaction) {
  const itemName = transaction.details?.name || "Unknown Item";
  const buyerId = transaction.agent?.id || "Unknown";
  const buyerName = transaction.agent?.name || "Unknown";
  const price = transaction.currency?.amount || 0;
  const itemId = transaction.details?.id;
  const purchasedLink = itemId ? `https://www.roblox.com/catalog/${itemId}` : null;

  const buyerMention = `[${buyerName}](https://www.roblox.com/users/${buyerId}/profile)`;

  const datePurchased = transaction.created;
  const unixTimestamp = Math.floor(new Date(datePurchased).getTime() / 1000);

  const embed = new EmbedBuilder()
    .setTitle("Purchase Log")
    .setDescription(
      `**Username:** ${buyerMention}\n` +
        `**Purchased:** [${itemName}](${purchasedLink})\n` +
        `**Amount After Tax:** R$${price}\n` +
        `**Date Purchased:** <t:${unixTimestamp}:R>`
    )
    .setColor("#2d2d31");

  try {
    const channel = await client.channels.fetch(defaultChannel);
    if (!channel) return console.error("Default channel not found");

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Error sending embed:", err);
  }
}

module.exports = {
  name: "ready",
  once: true,
  execute: async (client) => {
    try {
      await noblox.setCookie(robloxCookie);
      client.logs.custom("Starting purchase logging");
      listenForPurchases(client);
    } catch (err) {
      client.logs.error("Failed to start purchase logging:", err);
    }
  }
};
