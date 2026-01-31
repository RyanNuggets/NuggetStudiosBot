// /Features/payment.js
import { Routes } from "discord-api-types/v10";
import { ApplicationCommandOptionType } from "discord.js";
import noblox from "noblox.js";
import fs from "fs";

const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));
const PREFIX_DEFAULT = "-";

// --------- Roblox login (cached) ----------
let loginPromise = null;

async function ensureRobloxLogin() {
  if (loginPromise) return loginPromise;

  let cookie = process.env.ROBLOX_COOKIE;

  // ---- SAFE DEBUG (does NOT leak the cookie) ----
  const previewStart = (cookie ?? "").slice(0, 18);
  const previewEnd = (cookie ?? "").slice(-18);
  console.log("[PAYMENT] cookie type:", typeof cookie);
  console.log("[PAYMENT] cookie length:", cookie?.length ?? 0);
  console.log("[PAYMENT] cookie starts:", JSON.stringify(previewStart));
  console.log("[PAYMENT] cookie ends:", JSON.stringify(previewEnd));
  console.log("[PAYMENT] contains WARNING:", (cookie ?? "").includes("WARNING"));
  console.log("[PAYMENT] contains newline:", /[\r\n]/.test(cookie ?? ""));
  console.log("[PAYMENT] contains quotes at ends:", /^["']|["']$/.test(cookie ?? ""));
  // -----------------------------------------------

  if (!cookie) throw new Error("Missing ROBLOX_COOKIE env var.");

  // If user accidentally stored ".ROBLOSECURITY=<value>", strip the prefix.
  cookie = cookie.replace(/^\.ROBLOSECURITY=/i, "").trim();

  // If quotes were included in Railway, strip them safely.
  cookie = cookie.replace(/^["']|["']$/g, "").trim();

  // Prevent newline issues (Railway paste sometimes adds them)
  cookie = cookie.replace(/[\r\n]+/g, "");

  // Quick sanity check on format
  if (!cookie.includes("WARNING")) {
    throw new Error(
      "ROBLOX_COOKIE does not include WARNING text. Make sure you copied the full .ROBLOSECURITY value."
    );
  }

  loginPromise = (async () => {
    const currentUser = await noblox.setCookie(cookie);
    // Login-only confirmation (safe)
    try {
      const me = await noblox.getCurrentUser();
      console.log("[PAYMENT] Logged in as:", me?.UserName, me?.UserID);
    } catch (e) {
      console.warn("[PAYMENT] Logged in but getCurrentUser failed:", e?.message ?? e);
    }
    return currentUser;
  })();

  return loginPromise;
}

// --------- Helpers ----------
function hasRole(member, roleId) {
  if (!roleId) return false;
  const roles = member?.roles?.cache ?? member?.roles;
  return roles?.has ? roles.has(roleId) : Array.isArray(roles) ? roles.includes(roleId) : false;
}

function parsePrice(input) {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const price = Math.floor(n);
  if (price < 0) return null;
  return price;
}

function fmt(n) {
  if (n === null || n === undefined) return "N/A";
  return Number(n).toLocaleString("en-US");
}

// Upsert ONE global slash command safely (doesn't overwrite other commands)
async function upsertGlobalCommand(client, command) {
  const appId = client.application?.id;
  if (!appId) throw new Error("Missing application id.");

  const existing = await client.rest.get(Routes.applicationCommands(appId));
  const found = Array.isArray(existing) ? existing.find((c) => c?.name === command.name) : null;

  if (found?.id) {
    await client.rest.patch(Routes.applicationCommand(appId, found.id), { body: command });
    return "updated";
  } else {
    await client.rest.post(Routes.applicationCommands(appId), { body: command });
    return "created";
  }
}

// --------- Slash command registration ----------
async function registerPaymentSlash(client) {
  const cmd = {
    name: "payment",
    description: "Change the price of the configured shirt asset (Robux).",
    options: [
      {
        name: "price",
        description: "New price in Robux",
        type: ApplicationCommandOptionType.Integer,
        required: true,
        min_value: 0
      }
    ]
  };

  const result = await upsertGlobalCommand(client, cmd);
  console.log(`✅ [PAYMENT] Global slash command ${result}: /payment`);
}

// --------- Core action ----------
async function changeShirtPrice({ newPrice }) {
  const conf = readConfig();
  const payment = conf.payment;

  if (!payment?.assetId) throw new Error("Missing config.payment.assetId");
  const assetId = Number(payment.assetId);

  // Ensure logged in
  await ensureRobloxLogin();

  // Grab current info (name/desc required for configureItem)
  const infoBefore = await noblox.getProductInfo(assetId);
  const name = infoBefore?.Name ?? infoBefore?.name ?? "Untitled";
  const description = infoBefore?.Description ?? infoBefore?.description ?? "";

  // Update price
  await noblox.configureItem(assetId, name, description, undefined, newPrice, undefined);

  // Fetch after to confirm
  const infoAfter = await noblox.getProductInfo(assetId);

  return {
    assetId,
    name,
    before: infoBefore?.PriceInRobux ?? null,
    after: infoAfter?.PriceInRobux ?? null
  };
}

// --------- Logging ----------
async function logChange(client, { userId, assetId, name, before, after }) {
  const conf = readConfig();
  const chId = conf?.payment?.logChannelId;
  if (!chId) return;

  const payload = {
    embeds: [
      {
        title: "✅ Shirt Price Updated",
        description:
          `**Asset:** ${name}\n` +
          `**Asset ID:** \`${assetId}\`\n` +
          `**Changed by:** <@${userId}>`,
        fields: [
          { name: "Old Price", value: `> ${fmt(before)}`, inline: true },
          { name: "New Price", value: `> ${fmt(after)}`, inline: true }
        ]
      }
    ]
  };

  await client.rest.post(Routes.channelMessages(chId), { body: payload }).catch(() => {});
}

// --------- Slash handler ----------
async function handlePaymentSlash(client, interaction) {
  if (!interaction.isChatInputCommand?.()) return false;
  if (interaction.commandName !== "payment") return false;

  const conf = readConfig();
  const payment = conf.payment;

  if (!payment?.allowedRoleId) {
    return interaction.reply({
      content: "Payment command not configured (missing allowedRoleId).",
      ephemeral: true
    });
  }

  if (!hasRole(interaction.member, payment.allowedRoleId)) {
    return interaction.reply({ content: "You don’t have permission to use this command.", ephemeral: true });
  }

  const priceRaw = interaction.options.getInteger("price", true);
  const newPrice = parsePrice(priceRaw);
  if (newPrice === null) {
    return interaction.reply({ content: "Invalid price.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true }).catch(() => {});

  try {
    const res = await changeShirtPrice({ newPrice });

    await logChange(client, {
      userId: interaction.user.id,
      assetId: res.assetId,
      name: res.name,
      before: res.before,
      after: res.after
    });

    return interaction.editReply({
      embeds: [
        {
          description:
            `✅ **Price Updated**\n\n` +
            `**Asset:** ${res.name}\n` +
            `**Old:** ${fmt(res.before)}\n` +
            `**New:** ${fmt(res.after)}`
        }
      ]
    });
  } catch (e) {
    console.error("❌ [PAYMENT] slash error:", e);
    return interaction.editReply({ content: `Failed to update price. (${e?.message ?? "Unknown error"})` });
  }
}

// --------- Prefix handler ----------
async function handlePaymentPrefix(client, message, prefix = PREFIX_DEFAULT) {
  if (!message || message.author?.bot) return false;

  const content = String(message.content ?? "").trim();
  if (!content.toLowerCase().startsWith(`${prefix}payment`)) return false;

  const conf = readConfig();
  const payment = conf.payment;

  if (!payment?.allowedRoleId) {
    await message.reply("Payment command not configured (missing allowedRoleId).").catch(() => {});
    return true;
  }

  if (!hasRole(message.member, payment.allowedRoleId)) {
    await message.reply("You don’t have permission to use this command.").catch(() => {});
    return true;
  }

  const parts = content.split(/\s+/);
  const newPrice = parsePrice(parts[1]);

  if (newPrice === null) {
    await message.reply(`Usage: \`${prefix}payment 100\``).catch(() => {});
    return true;
  }

  const thinking = await message.reply("Updating price…").catch(() => null);

  try {
    const res = await changeShirtPrice({ newPrice });

    await logChange(client, {
      userId: message.author.id,
      assetId: res.assetId,
      name: res.name,
      before: res.before,
      after: res.after
    });

    const donePayload = {
      embeds: [
        {
          description:
            `✅ **Price Updated**\n\n` +
            `**Asset:** ${res.name}\n` +
            `**Old:** ${fmt(res.before)}\n` +
            `**New:** ${fmt(res.after)}`
        }
      ]
    };

    if (thinking) await thinking.edit(donePayload).catch(() => {});
    else await message.reply(donePayload).catch(() => {});
  } catch (e) {
    console.error("❌ [PAYMENT] prefix error:", e);
    const msg = `Failed to update price. (${e?.message ?? "Unknown error"})`;
    if (thinking) await thinking.edit(msg).catch(() => {});
    else await message.reply(msg).catch(() => {});
  }

  return true;
}

// --------- Export registrar ----------
export default function registerPaymentModule(client, { prefix = PREFIX_DEFAULT } = {}) {
  client.once("ready", async () => {
    try {
      await registerPaymentSlash(client);
      console.log("✅ Payment module registered");
    } catch (e) {
      console.error("❌ [PAYMENT] register error:", e);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      await handlePaymentSlash(client, interaction);
    } catch (e) {
      console.error("❌ [PAYMENT] interactionCreate error:", e);
    }
  });

  client.on("messageCreate", async (message) => {
    try {
      await handlePaymentPrefix(client, message, prefix);
    } catch (e) {
      console.error("❌ [PAYMENT] messageCreate error:", e);
    }
  });
}
