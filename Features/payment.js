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

// ---------------- ROBLOX LOGIN (ONCE) ----------------
let loginPromise = null;

async function ensureRobloxLogin() {
  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    const cookie = process.env.ROBLOX_COOKIE;
    if (!cookie) throw new Error("Missing ROBLOX_COOKIE environment variable.");

    // Silence noblox deprecation warning spam
    noblox.setOptions({ show_deprecation_warnings: false });

    const me = await noblox.setCookie(cookie);
    console.log(`✅ [PAYMENT] Roblox logged in as ${me.UserName} (${me.UserID})`);
    return me;
  })();

  return loginPromise;
}

// ---------------- HELPERS ----------------
function parsePrice(input) {
  const n = Number(String(input ?? "").trim());
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function toUnix(d) {
  return Math.floor(new Date(d).getTime() / 1000);
}

function robloxProfileLink(userId) {
  return `https://www.roblox.com/users/${userId}/profile`;
}

async function safeFetchChannel(client, id) {
  if (!id) return null;
  return client.channels.fetch(id).catch(() => null);
}

async function getAssetInfo(assetId) {
  // Best-effort current info (price + sale status)
  try {
    const info = await noblox.getProductInfo(Number(assetId));
    const price =
      info?.PriceInRobux ??
      info?.priceInRobux ??
      info?.price ??
      null;

    const isForSale =
      info?.IsForSale ??
      info?.isForSale ??
      null;

    return { price, isForSale };
  } catch {
    return { price: null, isForSale: null };
  }
}

/**
 * Sets t-shirt price using configureItem():
 * - price >= 1 => sets that robux price
 * - price <= 0 => offsale (sellForRobux: false)
 */
async function setShirtPrice(assetId, price) {
  const sellForRobux = price >= 1 ? price : false;

  // configureItem(assetId, name, description, enableComments, sellForRobux, genreSelection)
  return noblox.configureItem(
    Number(assetId),
    undefined,
    undefined,
    undefined,
    sellForRobux,
    undefined
  );
}

async function getRecentSalesForAsset(groupId, assetId, limit = 50) {
  // Purchases are NOT in audit log. They're in group transactions: "Sale"
  const page = await noblox.getGroupTransactions(
    Number(groupId),
    "Sale",
    undefined,
    "Desc",
    Number(limit)
  );

  const data = Array.isArray(page) ? page : (page?.data ?? []);
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

function formatTxn(txn) {
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

function buildEmbed({ currentPrice, onSale, updatedUnix, recent }) {
  const lines = [];

  lines.push("## Gamepass History");
  lines.push(`**Current Price:** ${currentPrice === null ? "Unknown" : `${currentPrice} R$`}`);
  lines.push(`**On Sale:** ${onSale === null ? "Unknown" : (onSale ? "Yes" : "No")}`);
  lines.push(`**Last Updated:** <t:${updatedUnix}:F>`);
  lines.push("");
  lines.push("## Recent Transactions");

  if (!recent.length) {
    lines.push("*No recent sales found for this item.*");
  } else {
    recent.forEach((tx, i) => {
      const f = formatTxn(tx);
      lines.push(`**\`${i + 1}\`** [${f.userName}](${f.link})`);
      lines.push(`> - **Amount:** ${f.amount}`);
      lines.push(`> - **Purchased:** ${f.ts}`);
      lines.push("");
    });
  }

  return new EmbedBuilder()
    .setColor(null)
    .setDescription(lines.join("\n"));
}

// ---------------- CORE RUNNER ----------------
async function runPayment(client, ctx, priceRaw) {
  const config = readConfig();
  const p = config.payment;

  if (!p) {
    const msg = "❌ Missing `payment` section in config.json.";
    if (ctx.reply) return ctx.reply(msg).catch(() => {});
    return;
  }

  const assetId = String(p.assetId ?? "").trim();
  const groupId = String(p.groupId ?? "").trim();
  const allowedRoleId = String(p.allowedRoleId ?? "").trim();
  const logChannelId = String(p.logChannelId ?? "").trim();
  const maxPrice = Number(p.maxPrice ?? 100000);

  if (!assetId || !groupId || !allowedRoleId || !logChannelId) {
    const msg =
      "❌ payment config missing one of: assetId, groupId, allowedRoleId, logChannelId";
    if (ctx.isChatInputCommand?.()) {
      return ctx.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
    return ctx.reply(msg).catch(() => {});
  }

  // Role check
  const member = ctx.member;
  const hasRole = member?.roles?.cache?.has?.(allowedRoleId) ?? false;
  if (!hasRole) {
    const msg = "❌ You do not have permission to use this command.";
    if (ctx.isChatInputCommand?.()) {
      return ctx.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
    return ctx.reply(msg).catch(() => {});
  }

  const price = parsePrice(priceRaw);
  if (price === null) {
    const msg = `❌ Invalid price. Example: \`${p.prefix ?? "-"}payment 100\` or \`/payment price:100\``;
    if (ctx.isChatInputCommand?.()) {
      return ctx.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
    return ctx.reply(msg).catch(() => {});
  }

  if (price < 0 || price > maxPrice) {
    const msg = `❌ Price must be between 0 and ${maxPrice}.`;
    if (ctx.isChatInputCommand?.()) {
      return ctx.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
    return ctx.reply(msg).catch(() => {});
  }

  // You said PUBLIC, not ephemeral
  if (ctx.isChatInputCommand?.()) {
    await ctx.deferReply({ ephemeral: false }).catch(() => {});
  }

  try {
    await ensureRobloxLogin();

    const before = await getAssetInfo(assetId);

    // Change price (0 => offsale)
    await setShirtPrice(assetId, price);

    const updatedUnix = Math.floor(Date.now() / 1000);

    const after = await getAssetInfo(assetId);

    // If Roblox doesn't return quickly, we still show the intended result:
    const currentPrice = after?.price ?? (price >= 1 ? price : 0);
    const onSale = after?.isForSale ?? (price >= 1);

    const recent = await getRecentSalesForAsset(groupId, assetId, 75);

    const embed = buildEmbed({
      currentPrice,
      onSale,
      updatedUnix,
      recent
    });

    // Send response
    if (ctx.isChatInputCommand?.()) {
      await ctx.editReply({ embeds: [embed] }).catch(() => {});
    } else {
      await ctx.reply({ embeds: [embed] }).catch(() => {});
    }

    // Log to payment log channel
    const actor =
      ctx.user?.tag ??
      ctx.author?.tag ??
      "Unknown";

    const logCh = await safeFetchChannel(client, logChannelId);
    if (logCh) {
      const logText =
        `🧾 **Payment price updated**\n` +
        `> **By:** ${actor}\n` +
        `> **Asset:** \`${assetId}\`\n` +
        `> **Price:** ${before?.price ?? "?"} → ${currentPrice}`;

      await logCh.send({ content: logText, embeds: [embed] }).catch(() => {});
    }
  } catch (err) {
    console.error("❌ [PAYMENT] error:", err);

    const msg =
      `❌ Failed to update shirt price.\n` +
      `Reason: \`${err?.message ?? String(err)}\`\n\n` +
      `Common causes:\n` +
      `- The logged-in Roblox account does not own the shirt / lacks permission\n` +
      `- Wrong assetId (not the t-shirt)\n` +
      `- Roblox request rejected / rate-limited`;

    if (ctx.isChatInputCommand?.()) {
      if (ctx.deferred || ctx.replied) {
        await ctx.editReply({ content: msg }).catch(() => {});
      } else {
        await ctx.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    } else {
      await ctx.reply(msg).catch(() => {});
    }
  }
}

// ---------------- REGISTER MODULE ----------------
export default function registerPaymentModule(client) {
  const config = readConfig();
  const p = config.payment ?? {};
  const prefix = String(p.prefix ?? "-").trim() || "-";

  // Register guild slash command (instant)
  client.once("ready", async () => {
    try {
      const guildId = config.guildId;
      if (!guildId) {
        console.error("❌ [PAYMENT] Missing guildId in config.json");
        return;
      }

      const cmd = new SlashCommandBuilder()
        .setName("payment")
        .setDescription("Change the t-shirt price (Roblox) and show sales summary.")
        .addIntegerOption((opt) =>
          opt
            .setName("price")
            .setDescription("New price in Robux (0 = offsale)")
            .setRequired(true)
        )
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
    await runPayment(client, interaction, price);
  });

  // Prefix handler: -payment 100 (uses config.payment.prefix)
  client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot) return;

    const raw = message.content.trim();
    const lower = raw.toLowerCase();

    // supports: "-payment 100" where prefix is "-"
    const cmd = `${prefix}payment`;
    if (!lower.startsWith(cmd)) return;

    const parts = raw.split(/\s+/);
    const price = parts[1];

    await runPayment(client, message, price);
  });

  console.log("✅ Payment module registered");
}
