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

  const cookie = process.env.ROBLOX_COOKIE;
  if (!cookie) throw new Error("Missing ROBLOX_COOKIE env var.");

  loginPromise = (async () => {
    // Noblox expects the .ROBLOSECURITY cookie string
    const currentUser = await noblox.setCookie(cookie);
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

// Upsert ONE global slash command safely (no overwriting other commands)
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
  const infoBefore = await noblox.getProductInfo(assetId); // has Name, Description, PriceInRobux, etc.
  const name = infoBefore?.Name ?? infoBefore?.name ?? "Untitled";
  const description = infoBefore?.Description ?? infoBefore?.description ?? "";

  // Update price using configureItem
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

// --------- Handlers ----------
async function handlePaymentSlash(client, interaction) {
  if (!interaction.isChatInputCommand?.()) return false;
  if (interaction.commandName !== "payment") return false;

  const conf = readConfig();
  const payment = conf.payment;

  if (!payment?.allowedRoleId) {
    return interaction.reply({ content: "Payment command not configured (missing allowedRoleId).", ephemeral: true });
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
    if (thinking) await thinking.edit(`Failed to update price. (${e?.message ?? "Unknown error"})`).catch(() => {});
    else await message.reply(`Failed to update price. (${e?.message ?? "Unknown error"})`).catch(() => {});
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
