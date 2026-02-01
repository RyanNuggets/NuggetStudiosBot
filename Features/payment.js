// Features/payment.js
import noblox from "noblox.js";
import {
  SlashCommandBuilder,
  EmbedBuilder
} from "discord.js";
import fs from "fs";

// ---------- CONFIG ----------
const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));

// ---------- ROBLOX LOGIN (cached) ----------
let robloxLoggedIn = false;

async function robloxLogin() {
  if (robloxLoggedIn) return;

  const cookie = process.env.ROBLOX_COOKIE;
  if (!cookie) {
    throw new Error("Missing ROBLOX_COOKIE env var in Railway.");
  }

  noblox.setOptions({ show_deprecation_warnings: false });
  await noblox.setCookie(cookie);

  let me = null;
  try {
    if (typeof noblox.getAuthenticatedUser === "function") {
      me = await noblox.getAuthenticatedUser();
    } else {
      me = await noblox.getCurrentUser();
    }
  } catch {
    // ignore
  }

  console.log(
    `✅ [PAYMENT] Roblox logged in as ${me?.UserName ?? me?.name ?? "Unknown"} (${me?.UserID ?? me?.id ?? "?"})`
  );

  robloxLoggedIn = true;
}

// ---------- HELPERS ----------
function hasRole(member, roleId) {
  if (!roleId) return false;
  return Boolean(member?.roles?.cache?.has(roleId));
}

function discordTs(dateLike) {
  const ms = dateLike ? new Date(dateLike).getTime() : Date.now();
  const unix = Math.floor(ms / 1000);
  return `<t:${unix}:F>`;
}

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  const i = Math.floor(x);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

async function safeGetProductInfo(assetId) {
  try {
    return await noblox.getProductInfo(Number(assetId));
  } catch (e) {
    // Specifically check for rate limits
    if (e?.message?.includes("429") || e?.content?.includes("429")) {
        console.error("[PAYMENT] Rate limited by Roblox (429).");
        return "RATE_LIMITED";
    }
    console.error("[PAYMENT] getProductInfo failed:", e?.message || e);
    return null;
  }
}

function logNobloxError(prefix, err) {
  console.error(prefix, err);
  const r = err?.response;
  if (r) {
    console.error("[PAYMENT] HTTP status:", r.status);
    console.error("[PAYMENT] HTTP data:", JSON.stringify(r.data).slice(0, 3000));
  }
  if (err?.errors) {
    console.error("[PAYMENT] errors:", JSON.stringify(err.errors).slice(0, 3000));
  }
}

// ---------- AUDIT LOG ----------
async function fetchRecentAudit(groupId, limit = 10) {
  try {
    const page = await noblox.getAuditLog(
      Number(groupId),
      "ConfigureItems",
      null,
      "Desc",
      limit
    );
    const data = page?.data ?? page ?? [];
    return Array.isArray(data) ? data.slice(0, limit) : [];
  } catch (e) {
    console.error("[PAYMENT] getAuditLog failed:", e?.message || e);
    return [];
  }
}

function formatAuditEntry(entry) {
  const actorId = entry?.actor?.userId ?? entry?.actor?.id ?? entry?.actorUserId ?? null;
  const actorName = entry?.actor?.user?.username ?? entry?.actor?.username ?? entry?.actor?.name ?? entry?.actorName ?? "Unknown";
  const created = entry?.created ?? entry?.createdAt ?? entry?.createdTime ?? entry?.time ?? Date.now();
  const actorProfile = actorId ? `[${actorName}](https://www.roblox.com/users/${actorId}/profile)` : actorName;
  const desc = entry?.description ?? entry?.actionDescription ?? entry?.details ?? entry?.metadata?.description ?? "Configured an item";

  return { actorProfile, desc, created };
}

// ---------- CONFIGURE PRICE ----------
async function configureShirtPrice(assetId, newPrice, cachedInfo) {
  // Use the info we already fetched to save an API call
  const info = cachedInfo;
  
  const name = info?.Name ?? info?.name;
  const description = info?.Description ?? info?.description ?? "";

  if (!name) {
    throw new Error('Required argument "name" is missing from product info.');
  }

  await noblox.configureItem(
    Number(assetId),
    String(name),
    String(description),
    false,
    Number(newPrice),
    "All"
  );

  return info;
}

// ---------- EMBED ----------
function buildPaymentEmbed({ assetName, newPrice, onSale, updatedAt, recentActivity }) {
  const lines = [
    "## Gamepass History",
    `**Current Price:** ${newPrice}`,
    `**On Sale:** ${onSale ? "Yes" : "No"}`,
    `**Last Updated:** ${discordTs(updatedAt)}`,
    "",
    "## Recent Transactions"
  ];

  if (!recentActivity.length) {
    lines.push("> - No recent activity found in group audit log.");
  } else {
    recentActivity.slice(0, 3).forEach((x, idx) => {
      lines.push(`**\`${idx + 1}\`** ${x.actorProfile}`);
      lines.push(`> - **Amount:** ${x.desc}`);
      lines.push(`> - **Purchased:** ${discordTs(x.created)}`);
      lines.push("");
    });
  }

  return new EmbedBuilder().setDescription(lines.join("\n"));
}

// ---------- RUN CHANGE ----------
async function runPaymentChange(messageOrInteraction, priceRaw, isInteraction = false) {
  const cfg = readConfig();
  const pay = cfg.payment;
  const { assetId, groupId, allowedRoleId, logChannelId } = pay;

  if (!assetId || !groupId) {
    throw new Error("config.json payment.assetId and payment.groupId are required.");
  }

  const member = messageOrInteraction.member;
  if (!hasRole(member, allowedRoleId)) {
    const content = "❌ You do not have permission to use this command.";
    return isInteraction ? messageOrInteraction.reply({ content, ephemeral: true }) : messageOrInteraction.reply({ content });
  }

  const maxPrice = Number(pay?.maxPrice ?? 100000);
  const newPrice = clampInt(priceRaw, 0, maxPrice);
  if (newPrice === null) {
    const content = `❌ Invalid price. Use a number from 0 to ${maxPrice}.`;
    return isInteraction ? messageOrInteraction.reply({ content, ephemeral: true }) : messageOrInteraction.reply({ content });
  }

  await robloxLogin();

  try {
    // 1. Fetch info ONCE
    const info = await safeGetProductInfo(assetId);

    if (info === "RATE_LIMITED") {
        throw new Error("Roblox is rate-limiting the bot (Too Many Requests). Please try again in 5-10 minutes.");
    }
    if (!info) {
        throw new Error("Could not fetch product info. Check if the Asset ID is correct and public.");
    }

    const previousPrice = info?.PriceInRobux ?? info?.price ?? "Unknown";

    // 2. Perform the update using the info we just fetched
    await configureShirtPrice(assetId, newPrice, info);

    const onSale = info?.IsForSale ?? info?.isForSale ?? true;
    const activityRaw = await fetchRecentAudit(groupId, 5);
    const recentActivity = activityRaw.map(formatAuditEntry);

    const embed = buildPaymentEmbed({
      assetName: info?.Name ?? info?.name ?? "Payment Item",
      newPrice,
      onSale,
      updatedAt: Date.now(),
      recentActivity
    });

    if (isInteraction) {
      await messageOrInteraction.reply({ embeds: [embed] });
    } else {
      await messageOrInteraction.reply({ embeds: [embed] });
    }

    // Log channel
    if (logChannelId) {
      const logCh = messageOrInteraction.client.channels.cache.get(logChannelId);
      if (logCh) {
        const actorTag = isInteraction ? messageOrInteraction.user?.tag : messageOrInteraction.author?.tag;
        const logEmbed = new EmbedBuilder()
          .setTitle("Payment Price Updated")
          .setDescription([
              `**Asset:** ${info?.Name ?? info?.name} (\`${assetId}\`)`,
              `**New Price:** ${newPrice}`,
              `**Previous Price:** ${previousPrice}`,
              `**Changed By:** ${actorTag}`
            ].join("\n"))
          .setTimestamp();
        await logCh.send({ embeds: [logEmbed] }).catch(() => {});
      }
    }
  } catch (err) {
    logNobloxError("❌ [PAYMENT] update failed:", err);
    const reason = err?.message || "Internal Roblox Error";
    const content = `❌ Failed to update shirt price.\nReason: \`${reason}\``;
    
    if (isInteraction) {
      await messageOrInteraction.reply({ content, ephemeral: true }).catch(() => {});
    } else {
      await messageOrInteraction.reply({ content }).catch(() => {});
    }
  }
}

// ---------- REGISTER MODULE ----------
export default function registerPaymentModule(client) {
  const cfg = readConfig();
  const pay = cfg.payment;
  const prefix = String(pay?.prefix ?? "-");

  client.once("ready", async () => {
    try {
      const cmd = new SlashCommandBuilder()
        .setName("payment")
        .setDescription("Change the Roblox payment shirt price.")
        .addIntegerOption((opt) => opt.setName("price").setDescription("New price").setRequired(true));
      await client.application.commands.create(cmd);
      console.log("✅ [PAYMENT] /payment registered");
    } catch (e) {
      console.error("❌ [PAYMENT] Failed to register /payment:", e?.message || e);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "payment") return;
    await runPaymentChange(interaction, interaction.options.getInteger("price"), true);
  });

  client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot) return;
    const content = message.content.trim();
    const cmd = `${prefix}payment`;
    if (!content.toLowerCase().startsWith(cmd)) return;
    const parts = content.split(/\s+/);
    if (parts[1] == null) return message.reply(`❌ Usage: \`${cmd} <price>\``);
    await runPaymentChange(message, parts[1], false);
  });

  console.log("✅ Payment module registered");
}
