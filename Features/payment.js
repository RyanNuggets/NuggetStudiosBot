// Features/payment.js
import fs from "fs";
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} from "discord.js";
import { Routes } from "discord-api-types/v10";
import noblox from "noblox.js";

// ---------------- CONFIG ----------------
const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));

/**
 * Expected config.json:
 * {
 *   "guildId": "...",
 *   "payment": {
 *     "allowedRoleId": "...",
 *     "logChannelId": "...",
 *     "groupId": 123,
 *     "shirtAssetId": 123456789
 *   }
 * }
 */

// ---------------- ROBLOX LOGIN (ONCE) ----------------
let loginPromise = null;

async function ensureRobloxLogin() {
  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    const cookie = process.env.ROBLOX_COOKIE;
    if (!cookie) throw new Error("Missing ROBLOX_COOKIE environment variable.");

    // Optional: silence deprecation warnings
    noblox.setOptions({ show_deprecation_warnings: false });

    const me = await noblox.setCookie(cookie);
    console.log(`✅ [PAYMENT] Roblox logged in as ${me.UserName} (${me.UserID})`);
    return me;
  })();

  return loginPromise;
}

// ---------------- HELPERS ----------------
const toUnix = (d) => Math.floor(new Date(d).getTime() / 1000);

function parsePrice(str) {
  const n = Number(String(str ?? "").trim());
  if (!Number.isFinite(n)) return null;
  // Roblox prices are integers
  return Math.floor(n);
}

function robloxProfileLink(userId) {
  return `https://www.roblox.com/users/${userId}/profile`;
}

function formatTxnLine(txn) {
  // TransactionItem varies a bit depending on endpoint fields;
  // we defensive-parse common shapes.
  const userId =
    txn?.agent?.id ??
    txn?.agent?.userId ??
    txn?.agent?.Id ??
    txn?.agentId ??
    txn?.userId ??
    null;

  const userName =
    txn?.agent?.name ??
    txn?.agent?.username ??
    txn?.agent?.Name ??
    txn?.agentName ??
    "User";

  const amount =
    txn?.currency?.amount ??
    txn?.amount ??
    txn?.details?.amount ??
    txn?.robux ??
    "Unknown";

  const created =
    txn?.created ??
    txn?.createdDate ??
    txn?.createdTime ??
    txn?.date ??
    null;

  const ts = created ? `<t:${toUnix(created)}:F>` : "*Unknown*";
  const link = userId ? robloxProfileLink(userId) : "https://www.roblox.com/";

  return { userId, userName, amount, ts, link };
}

async function getShirtInfo(assetId) {
  // Product info typically contains price + sale status.
  // If Roblox changes fields, this still won't crash.
  try {
    const info = await noblox.getProductInfo(assetId);
    return {
      price:
        info?.PriceInRobux ??
        info?.priceInRobux ??
        info?.price ??
        null,
      isForSale:
        info?.IsForSale ??
        info?.isForSale ??
        false
    };
  } catch {
    return { price: null, isForSale: null };
  }
}

/**
 * Sets t-shirt price:
 * - price <= 0 => offsale (sellForRobux = false)
 * - price >= 1 => set that robux price
 */
async function setShirtPrice(assetId, price) {
  // configureItem(assetId, name, description, enableComments, sellForRobux, genreSelection)
  // To avoid Roblox rejecting nulls, we pass undefined for untouched fields.
  const sellForRobux = price >= 1 ? price : false;

  return noblox.configureItem(
    Number(assetId),
    undefined,
    undefined,
    undefined,
    sellForRobux,
    undefined
  );
}

async function getRecentSalesForAsset(groupId, assetId, limit = 25) {
  // Purchases are in group transactions (Sale). Audit log is NOT purchases.
  // We pull recent sales, then filter to this assetId.
  const page = await noblox.getGroupTransactions(
    Number(groupId),
    "Sale",
    undefined,
    "Desc",
    Number(limit)
  );

  const data = Array.isArray(page) ? page : page?.data ?? page ?? [];
  const filtered = data.filter((t) => {
    const id =
      t?.details?.id ??
      t?.details?.assetId ??
      t?.details?.Id ??
      t?.assetId ??
      null;
    return Number(id) === Number(assetId);
  });

  return filtered.slice(0, 3);
}

function buildPaymentEmbed({ newPrice, onSale, updatedUnix, recent }) {
  const lines = [];

  lines.push("## Gamepass History");
  lines.push(`**Current Price:** ${newPrice === null ? "Unknown" : `${newPrice} R$`}`);
  lines.push(`**On Sale:** ${onSale === null ? "Unknown" : onSale ? "Yes" : "No"}`);
  lines.push(`**Last Updated:** <t:${updatedUnix}:F>`);
  lines.push("");
  lines.push("## Recent Transactions");

  if (!recent.length) {
    lines.push("*No recent sales found for this item.*");
  } else {
    recent.forEach((tx, i) => {
      const f = formatTxnLine(tx);
      lines.push(`**\`${i + 1}\`** [${f.userName}](${f.link})`);
      lines.push(`> - **Amount:** ${f.amount}`);
      lines.push(`> - **Purchased:** ${f.ts}`);
      lines.push("");
    });
  }

  const embed = new EmbedBuilder()
    .setDescription(lines.join("\n"))
    .setColor(null);

  return embed;
}

async function logChange(client, channelId, text, embed) {
  if (!channelId) return;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) return;
  await ch.send({ content: text ?? null, embeds: embed ? [embed] : [] }).catch(() => {});
}

// ---------------- COMMAND CORE ----------------
async function runPaymentCommand(client, interactionOrMessage, priceRaw) {
  const conf = readConfig();
  const payment = conf.payment;

  if (!payment?.allowedRoleId || !payment?.logChannelId || !payment?.groupId || !payment?.shirtAssetId) {
    const msg = "❌ Missing `payment` config (allowedRoleId, logChannelId, groupId, shirtAssetId).";
    if (interactionOrMessage?.reply) return interactionOrMessage.reply(msg).catch(() => {});
    return;
  }

  // Role check
  const member = interactionOrMessage?.member;
  const hasRole =
    member?.roles?.cache?.has?.(payment.allowedRoleId) ??
    member?.roles?.cache?.has(payment.allowedRoleId) ??
    false;

  if (!hasRole) {
    const msg = "❌ You do not have permission to use this command.";
    if (interactionOrMessage.isChatInputCommand?.()) {
      return interactionOrMessage.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
    return interactionOrMessage.reply(msg).catch(() => {});
  }

  const price = parsePrice(priceRaw);
  if (price === null) {
    const msg = "❌ Invalid price. Example: `-payment 100` or `/payment price:100`";
    if (interactionOrMessage.isChatInputCommand?.()) {
      return interactionOrMessage.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
    return interactionOrMessage.reply(msg).catch(() => {});
  }

  // PUBLIC response (you said use in private channel prevent leaks)
  const EPHEMERAL = false;

  // Slash command: we should defer because Roblox calls can take time.
  if (interactionOrMessage.isChatInputCommand?.()) {
    await interactionOrMessage.deferReply({ ephemeral: EPHEMERAL }).catch(() => {});
  }

  try {
    await ensureRobloxLogin();

    // Old info (best-effort)
    const before = await getShirtInfo(payment.shirtAssetId);

    // Set price (0 => offsale)
    await setShirtPrice(payment.shirtAssetId, price);

    const updatedUnix = Math.floor(Date.now() / 1000);

    // New info (best-effort)
    const after = await getShirtInfo(payment.shirtAssetId);

    const onSale =
      price >= 1 ? true : false;

    const newPrice =
      after?.price ?? (price >= 1 ? price : 0);

    // Recent sales
    const recent = await getRecentSalesForAsset(payment.groupId, payment.shirtAssetId, 50);

    const embed = buildPaymentEmbed({
      newPrice,
      onSale: after?.isForSale ?? onSale,
      updatedUnix,
      recent
    });

    const actorTag =
      interactionOrMessage.user?.tag ??
      interactionOrMessage.author?.tag ??
      "Unknown";

    // Reply
    if (interactionOrMessage.isChatInputCommand?.()) {
      await interactionOrMessage.editReply({ embeds: [embed] }).catch(() => {});
    } else {
      await interactionOrMessage.reply({ embeds: [embed] }).catch(() => {});
    }

    // Log to channel
    const logText =
      `🧾 **Payment price updated**\n` +
      `> **By:** ${actorTag}\n` +
      `> **Asset:** \`${payment.shirtAssetId}\`\n` +
      `> **Price:** ${before?.price ?? "?"} → ${newPrice}`;

    await logChange(client, payment.logChannelId, logText, embed);
  } catch (err) {
    const msg =
      `❌ Failed to update shirt price.\n` +
      `Reason: \`${err?.message ?? String(err)}\`\n\n` +
      `Common causes:\n` +
      `- The logged-in Roblox account does **not own** the shirt / lacks permission\n` +
      `- The asset ID is wrong (not a t-shirt)\n` +
      `- Roblox temporarily rate-limited/blocked the request`;

    if (interactionOrMessage.isChatInputCommand?.()) {
      if (interactionOrMessage.deferred || interactionOrMessage.replied) {
        await interactionOrMessage.editReply({ content: msg }).catch(() => {});
      } else {
        await interactionOrMessage.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    } else {
      await interactionOrMessage.reply(msg).catch(() => {});
    }

    console.error("❌ [PAYMENT] error:", err);
  }
}

// ---------------- REGISTER MODULE ----------------
export default function registerPaymentModule(client) {
  const conf = readConfig();

  // Register slash command to the guild (instant), not global (can take ~1 hour)
  client.once("ready", async () => {
    try {
      const guildId = conf.guildId;
      if (!guildId) {
        console.error("❌ [PAYMENT] Missing guildId in config.json (needed for instant slash upsert).");
        return;
      }

      const cmd = new SlashCommandBuilder()
        .setName("payment")
        .setDescription("Change the t-shirt price (Roblox) and show sales summary.")
        .addIntegerOption((opt) =>
          opt.setName("price").setDescription("New price in Robux (0 = offsale)").setRequired(true)
        )
        // optional: only admins see it in UI (role check still happens server-side)
        .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

      await client.rest.put(
        Routes.applicationGuildCommands(client.user.id, guildId),
        { body: [cmd.toJSON()] }
      );

      console.log("✅ Payment slash command registered to guild");
    } catch (e) {
      console.error("❌ [PAYMENT] Failed to register slash command:", e);
    }
  });

  // Slash handler
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand?.()) return;
    if (interaction.commandName !== "payment") return;

    const price = interaction.options.getInteger("price", true);
    return runPaymentCommand(client, interaction, price);
  });

  // Prefix handler: -payment 100
  client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot) return;

    const raw = message.content.trim();
    if (!raw.toLowerCase().startsWith("-payment")) return;

    const parts = raw.split(/\s+/);
    const price = parts[1];

    return runPaymentCommand(client, message, price);
  });

  console.log("✅ Payment module registered");
}
