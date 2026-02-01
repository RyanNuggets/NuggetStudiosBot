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

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Enhanced Fetcher with Retry Logic for 429s
async function safeGetProductInfo(assetId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await noblox.getProductInfo(Number(assetId));
    } catch (e) {
      const isRateLimit = e?.message?.includes("429") || JSON.stringify(e).includes("Too many requests");
      
      if (isRateLimit && i < retries - 1) {
        console.warn(`[PAYMENT] Rate limited. Retrying in ${2 * (i + 1)}s...`);
        await sleep(2000 * (i + 1)); // Wait longer each time
        continue;
      }
      
      console.error("[PAYMENT] getProductInfo failed:", e?.message || e);
      return null;
    }
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
  const actorName = entry?.actor?.user?.username ?? entry?.actor?.username ?? entry?.actor?.name ?? "Unknown";
  const created = entry?.created ?? entry?.createdAt ?? entry?.createdTime ?? entry?.time ?? Date.now();
  const actorProfile = actorId ? `[${actorName}](https://www.roblox.com/users/${actorId}/profile)` : actorName;
  const desc = entry?.description ?? entry?.actionDescription ?? entry?.details ?? "Configured an item";

  return { actorProfile, desc, created };
}

// ---------- CONFIGURE PRICE ----------
async function configureShirtPrice(assetId, newPrice, cachedInfo) {
  // Use cachedInfo if provided to save an API call
  const info = cachedInfo || (await safeGetProductInfo(assetId));
  
  if (!info) {
    throw new Error("Roblox API is not responding (429 Rate Limit). Please wait a few minutes.");
  }

  const name = info?.Name ?? info?.name;
  const description = info?.Description ?? info?.description ?? "";

  if (!name) {
    throw new Error("Product info returned no name. Cannot update.");
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

  return new EmbedBuilder().setDescription(lines.join("\n")).setColor("Blue");
}

// ---------- RUN CHANGE ----------
async function runPaymentChange(messageOrInteraction, priceRaw, isInteraction = false) {
  const cfg = readConfig();
  const pay = cfg.payment;

  const assetId = pay?.assetId;
  const groupId = pay?.groupId;
  const allowedRoleId = pay?.allowedRoleId;
  const logChannelId = pay?.logChannelId;

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

  // Defer if it's an interaction because Roblox API can take a few seconds
  if (isInteraction) await messageOrInteraction.deferReply();

  try {
    await robloxLogin();

    // 1. Fetch info ONCE
    const infoBefore = await safeGetProductInfo(assetId);
    if (!infoBefore) {
        throw new Error("Could not fetch product info. Roblox is rate-limiting the bot.");
    }

    // 2. Update using that info
    await configureShirtPrice(assetId, newPrice, infoBefore);

    const onSale = infoBefore?.IsForSale ?? infoBefore?.isForSale ?? true;
    const activityRaw = await fetchRecentAudit(groupId, 10);
    const recentActivity = activityRaw.map(formatAuditEntry);

    const embed = buildPaymentEmbed({
      assetName: infoBefore?.Name ?? infoBefore?.name ?? "Payment Item",
      newPrice,
      onSale,
      updatedAt: Date.now(),
      recentActivity
    });

    if (isInteraction) {
      await messageOrInteraction.editReply({ embeds: [embed] });
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
          .setDescription(`**Asset:** ${infoBefore.Name} (\`${assetId}\`)\n**New Price:** ${newPrice}\n**Changed By:** ${actorTag}`)
          .setTimestamp();
        await logCh.send({ embeds: [logEmbed] }).catch(() => {});
      }
    }
  } catch (err) {
    logNobloxError("❌ [PAYMENT] update failed:", err);
    const content = `❌ Failed to update price.\nReason: \`${err.message}\``;
    
    if (isInteraction) {
      await messageOrInteraction.editReply({ content }).catch(() => {});
    } else {
      await messageOrInteraction.reply({ content }).catch(() => {});
    }
  }
}

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
    } catch (e) {
      console.error("❌ [PAYMENT] Failed to register command:", e.message);
    }
  });

  client.on("interactionCreate", async (i) => {
    if (i.isChatInputCommand() && i.commandName === "payment") await runPaymentChange(i, i.options.getInteger("price"), true);
  });

  client.on("messageCreate", async (m) => {
    if (!m.guild || m.author.bot) return;
    if (m.content.startsWith(`${prefix}payment`)) {
      const price = m.content.split(/\s+/)[1];
      await runPaymentChange(m, price, false);
    }
  });

  console.log("✅ Payment module registered");
}
