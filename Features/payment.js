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
  return roles?.has ? roles.has(roleId) : false;
}

function fmtCreator(pi) {
  const creatorName =
    pi?.Creator?.Name ?? pi?.creator?.name ?? "UnknownCreator";
  const creatorType =
    pi?.Creator?.CreatorType ?? pi?.creator?.type ?? "UnknownType";
  const creatorId =
    pi?.Creator?.CreatorTargetId ?? pi?.creator?.id ?? "?";
  return `${creatorName} (${creatorType}:${creatorId})`;
}

// ---------------- ROBLOX LOGIN ----------------
async function ensureRobloxLogin() {
  if (robloxLoggedIn) return;

  // stop deprecation spam
  try {
    noblox.setOptions({ show_deprecation_warnings: false });
  } catch {}

  const cookie = process.env.ROBLOX_COOKIE;
  if (!cookie) throw new Error("Missing ROBLOX_COOKIE env var in Railway.");

  await noblox.setCookie(cookie);

  // ✅ REAL verification (this matters)
  let me = null;
  try {
    if (typeof noblox.getAuthenticatedUser === "function") {
      me = await noblox.getAuthenticatedUser();
    }
  } catch {}

  if (!me || (!me.name && !me.UserName)) {
    console.log("⚠️ [PAYMENT] Logged in, but could not verify user via getAuthenticatedUser().");
  } else {
    const uname = me.name ?? me.UserName;
    const uid = me.id ?? me.UserID;
    console.log(`✅ [PAYMENT] Roblox logged in as ${uname} (${uid})`);
  }

  robloxLoggedIn = true;
}

// ---------------- PRODUCT INFO ----------------
async function getProductInfoSafe(assetId) {
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

  return { info, name: String(name), description: String(description) };
}

// ---------------- GROUP SALES (BEST EFFORT) ----------------
async function getRecentGroupSales(groupId, limit = 3) {
  try {
    if (!groupId) return [];
    if (typeof noblox.getGroupTransactions !== "function") return [];

    const res = await noblox.getGroupTransactions(Number(groupId), "Sale", limit);
    const data = Array.isArray(res) ? res : (res?.data ?? []);
    return data.slice(0, limit);
  } catch (e) {
    console.warn("⚠️ [PAYMENT] Could not fetch group transactions:", e?.message ?? e);
    return [];
  }
}

function userLinkFromTx(tx) {
  const userId =
    tx?.agent?.id ??
    tx?.agent?.userId ??
    tx?.userId ??
    tx?.details?.buyer?.id ??
    null;

  const username =
    tx?.agent?.name ??
    tx?.agent?.username ??
    tx?.username ??
    tx?.details?.buyer?.name ??
    "User";

  if (!userId) return `**${username}**`;
  return `[${username}](https://www.roblox.com/users/${userId}/profile)`;
}

function txAmount(tx) {
  return (
    tx?.amount ??
    tx?.details?.amount ??
    tx?.robux ??
    tx?.currency?.amount ??
    "?"
  );
}

function txUnix(tx) {
  const raw = tx?.created ?? tx?.createdAt ?? tx?.date ?? tx?.timestamp ?? null;
  if (!raw) return null;

  if (typeof raw === "number") {
    return raw > 10_000_000_000 ? Math.floor(raw / 1000) : raw;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

// ---------------- EMBEDS ----------------
function buildResultEmbed({ assetName, newPrice, onSale, transactions }) {
  const updatedTs = nowUnix();

  const lines = [];
  lines.push("## Gamepass History"); // keeping your header text
  lines.push(`**Current Price:** ${onSale ? `**${newPrice}**` : "**Offsale**"}`);
  lines.push(`**On Sale:** ${onSale ? "**Yes**" : "**No**"}`);
  lines.push(`**Last Updated:** <t:${updatedTs}:F>`);
  lines.push("");
  lines.push("## Recent Transactions");

  if (!transactions || transactions.length === 0) {
    lines.push("> No recent transactions found (or Roblox blocked access).");
  } else {
    transactions.slice(0, 3).forEach((tx, i) => {
      const u = userLinkFromTx(tx);
      const amt = txAmount(tx);
      const ts = txUnix(tx);
      lines.push(`**\`${i + 1}\`** ${u}`);
      lines.push(`> - **Amount:** ${amt}`);
      lines.push(`> - **Purchased:** ${ts ? `<t:${ts}:F>` : "`Unknown time`"}`);
      lines.push("");
    });
  }

  return {
    embeds: [{ description: `**${assetName}**\n\n${lines.join("\n")}` }],
    components: []
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

// ---------------- CORE: CONFIGURE PRICE ----------------
async function configureShirtPrice({ assetId, price }) {
  const { info, name, description } = await getProductInfoSafe(assetId);

  console.log("[PAYMENT] assetId:", String(assetId));
  console.log("[PAYMENT] product:", name);
  console.log("[PAYMENT] creator:", fmtCreator(info));
  console.log("[PAYMENT] assetTypeId:", info?.AssetTypeId ?? info?.assetTypeId ?? "?");

  const sellForRobux = price >= 1 ? price : false;

  // IMPORTANT: pass explicit enableComments + genreSelection
  // Some Roblox endpoints are picky about undefineds.
  await noblox.configureItem(
    Number(assetId),
    name,
    description,
    false,          // enableComments
    sellForRobux,   // sellForRobux (number or false)
    "All"           // genreSelection
  );

  return { assetName: name, onSale: price >= 1 };
}

// ---------------- RUN PAYMENT CHANGE ----------------
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

  const member = interactionOrMessage?.member;
  if (!hasRole(member, allowedRoleId)) {
    const deny = { content: "❌ You do not have permission to use this command." };
    if (interactionOrMessage?.reply) return interactionOrMessage.reply(deny).catch(() => {});
    if (interactionOrMessage?.channel?.send) return interactionOrMessage.channel.send(deny).catch(() => {});
    return;
  }

  const newPrice = clampPrice(priceInput, maxPrice);
  if (newPrice === null) {
    const prefix = conf?.prefix ?? "-";
    const bad = { content: `❌ Invalid price. Example: \`${prefix}payment 250\` or \`/payment price:250\`` };
    if (interactionOrMessage?.reply) return interactionOrMessage.reply(bad).catch(() => {});
    if (interactionOrMessage?.channel?.send) return interactionOrMessage.channel.send(bad).catch(() => {});
    return;
  }

  await ensureRobloxLogin();

  // Try configure
  let result;
  try {
    result = await configureShirtPrice({ assetId, price: newPrice });
  } catch (e) {
    // Add a VERY specific hint if Roblox gave blank [0]
    const msg = String(e?.message ?? e);
    if (msg.includes("[0]")) {
      throw new Error(
        'An unknown error occurred: [0] (Roblox rejected the configure request). ' +
        "This is usually: wrong asset type, not owned by the logged-in account/group, " +
        "or missing permission to configure group items."
      );
    }
    throw e;
  }

  const transactions = await getRecentGroupSales(groupId, 3);

  const payload = buildResultEmbed({
    assetName: result.assetName,
    newPrice,
    onSale: result.onSale,
    transactions
  });

  // You said: public (not ephemeral)
  if (interactionOrMessage?.isChatInputCommand?.()) {
    await interactionOrMessage.reply(payload).catch(() => {});
  } else if (interactionOrMessage?.channel?.send) {
    await interactionOrMessage.channel.send(payload).catch(() => {});
  }

  const staffId = interactionOrMessage?.user?.id ?? interactionOrMessage?.author?.id ?? "unknown";
  await sendToChannel(client, logChannelId, buildLogEmbed({
    staffId,
    assetId: String(assetId),
    assetName: result.assetName,
    newPrice,
    onSale: result.onSale
  }));
}

// ---------------- REGISTER MODULE ----------------
export default function registerPaymentModule(client) {
  // Prefix
  client.on("messageCreate", async (msg) => {
    try {
      if (!msg.guild || msg.author.bot) return;

      const conf = readConfig().payment;
      const prefix = conf?.prefix ?? "-";
      const raw = msg.content?.trim() ?? "";
      if (!raw.toLowerCase().startsWith(`${prefix}payment`)) return;

      const parts = raw.split(/\s+/);
      const price = parts[1];
      if (!price) return msg.channel.send({ content: `Usage: \`${prefix}payment 250\`` }).catch(() => {});

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

  // Slash register
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
          opt.setName("price").setDescription("New price (0 = offsale)").setRequired(true)
        );

      if (client.application?.commands && guildId) {
        await client.application.commands.create(cmd, guildId);
      } else if (client.application?.commands) {
        await client.application.commands.create(cmd);
      }

      console.log("✅ Payment module registered");
    } catch (e) {
      console.error("❌ [PAYMENT] slash register failed:", e);
    }
  });

  // Slash handler
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
