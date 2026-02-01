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

  // Hide annoying deprecation warnings
  noblox.setOptions({ show_deprecation_warnings: false });

  await noblox.setCookie(cookie);

  // Prefer authenticated user method if available
  let me = null;
  try {
    if (typeof noblox.getAuthenticatedUser === "function") {
      me = await noblox.getAuthenticatedUser();
    } else {
      // fallback (may be deprecated in some versions)
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
    console.error("[PAYMENT] getProductInfo failed:", e?.message || e);
    return null;
  }
}

// Tries to print useful info when Roblox rejects a request
function logNobloxError(prefix, err) {
  console.error(prefix, err);

  // Some noblox errors have a response body tucked inside
  const r = err?.response;
  if (r) {
    console.error("[PAYMENT] HTTP status:", r.status);
    console.error("[PAYMENT] HTTP data:", JSON.stringify(r.data).slice(0, 3000));
  }

  // Some errors include "errors" array
  if (err?.errors) {
    console.error("[PAYMENT] errors:", JSON.stringify(err.errors).slice(0, 3000));
  }
}

// ---------- AUDIT LOG (NOTE: NOT PURCHASE HISTORY) ----------
async function fetchRecentAudit(groupId, limit = 10) {
  try {
    // Action type list is limited; "ConfigureItems" exists in noblox docs screenshot
    // We’ll request ConfigureItems and just show whatever comes back.
    const page = await noblox.getAuditLog(
      Number(groupId),
      "ConfigureItems",
      null,
      "Desc",
      limit
    );

    const data = page?.data ?? page ?? [];
    if (!Array.isArray(data)) return [];

    return data.slice(0, limit);
  } catch (e) {
    console.error("[PAYMENT] getAuditLog failed:", e?.message || e);
    return [];
  }
}

function formatAuditEntry(entry) {
  // Entry shapes vary over time; handle a few common patterns.
  const actorId =
    entry?.actor?.userId ?? entry?.actor?.id ?? entry?.actorUserId ?? null;
  const actorName =
    entry?.actor?.user?.username ??
    entry?.actor?.username ??
    entry?.actor?.name ??
    entry?.actorName ??
    "Unknown";

  const created =
    entry?.created ?? entry?.createdAt ?? entry?.createdTime ?? entry?.time ?? Date.now();

  const actorProfile = actorId
    ? `[${actorName}](https://www.roblox.com/users/${actorId}/profile)`
    : actorName;

  // Best-effort summary:
  const desc =
    entry?.description ??
    entry?.actionDescription ??
    entry?.details ??
    entry?.metadata?.description ??
    "Configured an item";

  return {
    actorProfile,
    desc,
    created
  };
}

// ---------- CONFIGURE PRICE ----------
async function configureShirtPrice(assetId, newPrice) {
  const info = await safeGetProductInfo(assetId);
  if (!info) {
    throw new Error("Could not fetch product info for this assetId.");
  }

  const name = info?.Name ?? info?.name;
  const description = info?.Description ?? info?.description ?? "";

  if (!name) {
    // This is the error you hit earlier
    throw new Error('Required argument "name" is missing (product info did not return a name).');
  }

  // You MUST pass name + description to configureItem
  // sellForRobux is the price number for sellable items (shirts/pants/etc.)
  await noblox.configureItem(
    Number(assetId),
    String(name),
    String(description),
    false,          // enableComments (optional)
    Number(newPrice), // sellForRobux (optional)
    "All"           // genreSelection (optional)
  );

  return info;
}

// ---------- EMBED ----------
function buildPaymentEmbed({
  assetName,
  newPrice,
  onSale,
  updatedAt,
  recentActivity
}) {
  const lines = [];

  lines.push("## Gamepass History"); // you asked for this header text; keeping it
  lines.push(`**Current Price:** ${newPrice}`);
  lines.push(`**On Sale:** ${onSale ? "Yes" : "No"}`);
  lines.push(`**Last Updated:** ${discordTs(updatedAt)}`);
  lines.push("");
  lines.push("## Recent Transactions");

  // NOTE: Roblox group audit log does NOT contain purchase transactions.
  // We show recent “ConfigureItems” activity instead (best available via noblox).
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

// ---------- RUN CHANGE (shared) ----------
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

  // Permission check
  const member = isInteraction
    ? messageOrInteraction.member
    : messageOrInteraction.member;

  if (!hasRole(member, allowedRoleId)) {
    const content = "❌ You do not have permission to use this command.";
    if (isInteraction) {
      return messageOrInteraction.reply({ content, ephemeral: true });
    }
    return messageOrInteraction.reply({ content });
  }

  const maxPrice = Number(pay?.maxPrice ?? 100000);
  const newPrice = clampInt(priceRaw, 0, maxPrice);
  if (newPrice === null) {
    const content = `❌ Invalid price. Use a number from 0 to ${maxPrice}.`;
    if (isInteraction) return messageOrInteraction.reply({ content, ephemeral: true });
    return messageOrInteraction.reply({ content });
  }

  await robloxLogin();

  // Optional: fetch product info before for nicer logs
  const infoBefore = await safeGetProductInfo(assetId);

  // Try configure
  try {
    const info = await configureShirtPrice(assetId, newPrice);

    // Determine onSale best-effort:
    // Some product info includes PriceInRobux / IsForSale; varies by endpoint/version.
    const onSale =
      info?.IsForSale ??
      info?.isForSale ??
      (typeof info?.PriceInRobux === "number" ? info.PriceInRobux > 0 : true);

    const activityRaw = await fetchRecentAudit(groupId, 10);
    const recentActivity = activityRaw.map(formatAuditEntry);

    const embed = buildPaymentEmbed({
      assetName: info?.Name ?? info?.name ?? "Payment Item",
      newPrice,
      onSale,
      updatedAt: Date.now(),
      recentActivity
    });

    // Reply (you said: public, not DM; but you’ll use in private channel)
    if (isInteraction) {
      await messageOrInteraction.reply({ embeds: [embed], ephemeral: false });
    } else {
      await messageOrInteraction.reply({ embeds: [embed] });
    }

    // Log channel
    if (logChannelId) {
      const logCh = messageOrInteraction.client.channels.cache.get(logChannelId);
      if (logCh) {
        const actorTag = isInteraction
          ? messageOrInteraction.user?.tag
          : messageOrInteraction.author?.tag;

        const logEmbed = new EmbedBuilder()
          .setTitle("Payment Price Updated")
          .setDescription(
            [
              `**Asset:** ${info?.Name ?? info?.name ?? "Unknown"} (\`${assetId}\`)`,
              `**New Price:** ${newPrice}`,
              `**Changed By:** ${actorTag ?? "Unknown"}`,
              infoBefore?.PriceInRobux != null
                ? `**Previous Price:** ${infoBefore.PriceInRobux}`
                : null
            ]
              .filter(Boolean)
              .join("\n")
          )
          .setTimestamp();

        await logCh.send({ embeds: [logEmbed] }).catch(() => {});
      }
    }
  } catch (err) {
    logNobloxError("❌ [PAYMENT] update failed:", err);

    const reason =
      err?.message ||
      "Roblox rejected the request (unknown error). Usually perms/ownership/account security.";

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

  // Slash command upsert on ready
  client.once("ready", async () => {
    try {
      const cmd = new SlashCommandBuilder()
        .setName("payment")
        .setDescription("Change the Roblox payment shirt price (admins only).")
        .addIntegerOption((opt) =>
          opt
            .setName("price")
            .setDescription("New price in Robux")
            .setRequired(true)
        );

      await client.application.commands.create(cmd);
      console.log("✅ [PAYMENT] /payment registered");
    } catch (e) {
      console.error("❌ [PAYMENT] Failed to register /payment:", e?.message || e);
    }
  });

  // Slash handler
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "payment") return;

    const price = interaction.options.getInteger("price", true);
    await runPaymentChange(interaction, price, true);
  });

  // Prefix handler: -payment 100
  client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot) return;

    const content = message.content.trim();
    const cmd = `${prefix}payment`;

    if (!content.toLowerCase().startsWith(cmd)) return;

    const parts = content.split(/\s+/);
    const price = parts[1];

    if (price == null) {
      return message.reply(`❌ Usage: \`${cmd} <price>\``);
    }

    await runPaymentChange(message, price, false);
  });

  console.log("✅ Payment module registered");
}
