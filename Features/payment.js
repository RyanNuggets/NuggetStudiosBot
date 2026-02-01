// /Features/payment.js
import fs from "fs";
import noblox from "noblox.js";
import { SlashCommandBuilder } from "discord.js";

// ---------------- CONFIG ----------------
const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));

// ---------------- STATE ----------------
let robloxLoggedIn = false;
let slashRegistered = false;

// ---------------- HELPERS ----------------
const nowUnix = () => Math.floor(Date.now() / 1000);

function clampPrice(price, maxPrice) {
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (maxPrice && n > maxPrice) return maxPrice;
  return Math.floor(n);
}

function hasRole(member, roleId) {
  if (!roleId) return false;
  const roles = member?.roles?.cache ?? member?.roles;
  return roles?.has ? roles.has(roleId) : Array.isArray(roles) ? roles.includes(roleId) : false;
}

async function ensureRobloxLogin() {
  if (robloxLoggedIn) return;

  // Hide the deprecation spam
  try {
    noblox.setOptions({ show_deprecation_warnings: false });
  } catch {}

  const cookie = process.env.ROBLOX_COOKIE;
  if (!cookie) throw new Error("Missing ROBLOX_COOKIE env var in Railway.");

  // Must await this BEFORE calling any authenticated methods
  const currentUser = await noblox.setCookie(cookie);
  robloxLoggedIn = true;

  console.log(`✅ [PAYMENT] Roblox logged in as ${currentUser?.UserName ?? "Unknown"} (${currentUser?.UserID ?? "?"})`);
}

async function safeGetProductInfo(assetId) {
  // noblox.getProductInfo returns different key casing sometimes
  const info = await noblox.getProductInfo(Number(assetId));
  const name =
    info?.Name ??
    info?.name ??
    info?.AssetName ??
    info?.assetName ??
    "Item";

  const description =
    info?.Description ??
    info?.description ??
    "";

  return { raw: info, name: String(name), description: String(description) };
}

async function configureShirtPrice({ assetId, price }) {
  // configureItem requires name + description in your noblox version
  const { name, description } = await safeGetProductInfo(assetId);

  // price <= 0 => offsale (sellForRobux=false)
  const sellForRobux = price >= 1 ? price : false;

  // configureItem(assetId, name, description, enableComments?, sellForRobux?, genreSelection?)
  await noblox.configureItem(
    Number(assetId),
    name,
    description,
    undefined,
    sellForRobux,
    undefined
  );

  return { name, description, onSale: price >= 1 };
}

async function getRecentGroupSales(groupId, limit = 3) {
  // IMPORTANT:
  // Purchases are NOT in "audit log". For group-owned clothing, the closest is group transactions ("Sale").
  // We try several shapes because noblox versions differ.
  try {
    if (!groupId) return [];

    // Some versions: getGroupTransactions(groupId, transactionType, limit)
    if (typeof noblox.getGroupTransactions === "function") {
      const res = await noblox.getGroupTransactions(Number(groupId), "Sale", limit);
      // res might be {data:[...]} or [...]
      const data = Array.isArray(res) ? res : (res?.data ?? []);
      return data.slice(0, limit);
    }

    return [];
  } catch (e) {
    console.warn("⚠️ [PAYMENT] Could not fetch group transactions:", e?.message ?? e);
    return [];
  }
}

function formatUserLinkFromTransaction(tx) {
  // Different payloads across versions. Try to find a user id and name.
  const userId =
    tx?.agent?.id ??
    tx?.agent?.userId ??
    tx?.agentUserId ??
    tx?.details?.seller?.id ??
    tx?.details?.buyer?.id ??
    tx?.user?.id ??
    tx?.userId ??
    null;

  const username =
    tx?.agent?.name ??
    tx?.agent?.username ??
    tx?.details?.seller?.name ??
    tx?.details?.buyer?.name ??
    tx?.user?.name ??
    tx?.username ??
    "User";

  if (!userId) return `**${username}**`;

  const url = `https://www.roblox.com/users/${userId}/profile`;
  return `[${username}](${url})`;
}

function getAmountFromTransaction(tx) {
  // Group transactions usually have "amount" or "currency" fields.
  return (
    tx?.amount ??
    tx?.details?.amount ??
    tx?.details?.robux ??
    tx?.robux ??
    tx?.currency?.amount ??
    "?"
  );
}

function getUnixFromTransaction(tx) {
  // Might be ISO string or unix ms
  const raw =
    tx?.created ??
    tx?.createdAt ??
    tx?.created_at ??
    tx?.date ??
    tx?.timestamp ??
    null;

  if (!raw) return null;

  if (typeof raw === "number") {
    // could be ms
    return raw > 10_000_000_000 ? Math.floor(raw / 1000) : raw;
  }

  const t = Date.parse(raw);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function buildPaymentResultEmbed({ assetName, newPrice, onSale, transactions }) {
  const updatedTs = nowUnix();

  const lines = [];
  lines.push("## Gamepass History"); // keeping your header style
  lines.push(`**Current Price:** ${onSale ? `**${newPrice}**` : "**Offsale**"}`);
  lines.push(`**On Sale:** ${onSale ? "**Yes**" : "**No**"}`);
  lines.push(`**Last Updated:** <t:${updatedTs}:F>`);
  lines.push("");
  lines.push("## Recent Transactions");

  if (!transactions || transactions.length === 0) {
    lines.push("> No recent transactions found (or Roblox blocked access).");
  } else {
    const top = transactions.slice(0, 3);
    top.forEach((tx, idx) => {
      const userLink = formatUserLinkFromTransaction(tx);
      const amount = getAmountFromTransaction(tx);
      const unix = getUnixFromTransaction(tx);
      const ts = unix ? `<t:${unix}:F>` : "`Unknown time`";

      lines.push(`**\`${idx + 1}\`** ${userLink}`);
      lines.push(`> - **Amount:** ${amount}`);
      lines.push(`> - **Purchased:** ${ts}`);
      lines.push("");
    });
  }

  return {
    embeds: [
      {
        description: `**${assetName}**\n\n${lines.join("\n")}`
      }
    ]
  };
}

function buildLogEmbed({ staffId, assetId, assetName, newPrice, onSale }) {
  return {
    embeds: [
      {
        title: "✅ Payment Price Updated",
        description:
          `**Staff:** <@${staffId}>\n` +
          `**Asset:** **${assetName}** (\`${assetId}\`)\n` +
          `**New Price:** ${onSale ? `**${newPrice}**` : "**Offsale**"}\n` +
          `**Time:** <t:${nowUnix()}:F>`
      }
    ]
  };
}

async function sendToChannel(client, channelId, payload) {
  if (!channelId) return;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) return;
  await ch.send(payload).catch(() => {});
}

// ---------------- COMMAND CORE ----------------
async function runPaymentChange(client, interactionOrMessage, priceInput) {
  const conf = readConfig().payment;

  const assetId = conf?.assetId;
  const groupId = conf?.groupId;
  const allowedRoleId = conf?.allowedRoleId;
  const logChannelId = conf?.logChannelId;
  const maxPrice = conf?.maxPrice ?? 100000;

  if (!assetId) throw new Error("Missing payment.assetId in config.json");
  if (!allowedRoleId) throw new Error("Missing payment.allowedRoleId in config.json");
  if (!logChannelId) throw new Error("Missing payment.logChannelId in config.json");

  // Permission check
  const member = interactionOrMessage?.member;
  if (!hasRole(member, allowedRoleId)) {
    const deny = { content: "❌ You do not have permission to use this command." };
    if (interactionOrMessage?.reply) return interactionOrMessage.reply(deny).catch(() => {});
    if (interactionOrMessage?.channel?.send) return interactionOrMessage.channel.send(deny).catch(() => {});
    return;
  }

  const clamped = clampPrice(priceInput, maxPrice);
  if (clamped === null) {
    const bad = { content: `❌ Invalid price. Example: \`${conf?.prefix ?? "-"}payment 250\` or \`/payment price:250\`` };
    if (interactionOrMessage?.reply) return interactionOrMessage.reply(bad).catch(() => {});
    if (interactionOrMessage?.channel?.send) return interactionOrMessage.channel.send(bad).catch(() => {});
    return;
  }

  await ensureRobloxLogin();

  // Update item
  const { name, onSale } = await configureShirtPrice({
    assetId: Number(assetId),
    price: clamped
  });

  // Pull recent group sales (best-effort)
  const transactions = await getRecentGroupSales(groupId, 3);

  const resultEmbed = buildPaymentResultEmbed({
    assetName: name,
    newPrice: clamped,
    onSale,
    transactions
  });

  // Respond publicly (you requested public)
  if (interactionOrMessage?.isChatInputCommand?.()) {
    await interactionOrMessage.reply(resultEmbed).catch(() => {});
  } else if (interactionOrMessage?.channel?.send) {
    await interactionOrMessage.channel.send(resultEmbed).catch(() => {});
  }

  // Log
  const staffId = interactionOrMessage?.user?.id ?? interactionOrMessage?.author?.id ?? "unknown";
  await sendToChannel(
    client,
    logChannelId,
    buildLogEmbed({
      staffId,
      assetId: String(assetId),
      assetName: name,
      newPrice: clamped,
      onSale
    })
  );
}

// ---------------- REGISTER MODULE ----------------
export default function registerPaymentModule(client) {
  const conf = readConfig().payment;

  // 1) Prefix: -payment 250
  client.on("messageCreate", async (msg) => {
    try {
      if (!msg.guild || msg.author.bot) return;

      const prefix = conf?.prefix ?? "-";
      const raw = msg.content?.trim() ?? "";
      if (!raw.toLowerCase().startsWith(`${prefix}payment`)) return;

      const parts = raw.split(/\s+/);
      const price = parts[1];
      if (!price) {
        return msg.channel.send({ content: `Usage: \`${prefix}payment 250\`` }).catch(() => {});
      }

      await runPaymentChange(client, msg, price);
    } catch (e) {
      console.error("❌ [PAYMENT] prefix error:", e);
      await msg.channel
        .send({
          content:
            "❌ Failed to update shirt price.\n" +
            `Reason: \`${e?.message ?? "Unknown error"}\``
        })
        .catch(() => {});
    }
  });

  // 2) Slash: /payment price: 250
  client.once("ready", async () => {
    try {
      if (slashRegistered) return;
      slashRegistered = true;

      const root = readConfig();
      const guildId = root.guildId;

      const cmd = new SlashCommandBuilder()
        .setName("payment")
        .setDescription("Update the Roblox shirt price (staff only).")
        .addIntegerOption((opt) =>
          opt
            .setName("price")
            .setDescription("New price (0 = offsale)")
            .setRequired(true)
        );

      // Guild command = instant updates
      if (client.application?.commands && guildId) {
        await client.application.commands.create(cmd, guildId);
      } else if (client.application?.commands) {
        // fallback global
        await client.application.commands.create(cmd);
      }

      console.log("✅ Payment module registered");
    } catch (e) {
      console.error("❌ [PAYMENT] slash register failed:", e);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (!interaction.isChatInputCommand?.()) return;
      if (interaction.commandName !== "payment") return;

      const price = interaction.options.getInteger("price", true);
      await runPaymentChange(client, interaction, price);
    } catch (e) {
      console.error("❌ [PAYMENT] slash error:", e);
      await interaction
        .reply({
          content:
            "❌ Failed to update shirt price.\n" +
            `Reason: \`${e?.message ?? "Unknown error"}\``
        })
        .catch(() => {});
    }
  });
}
