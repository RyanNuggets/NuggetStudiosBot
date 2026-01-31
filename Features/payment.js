// /Features/payment.js  (T-SHIRT / CATALOG ITEM VERSION)
import fs from "fs";
import noblox from "noblox.js";
import { Routes } from "discord-api-types/v10";
import { ApplicationCommandOptionType } from "discord.js";

const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));

let loginPromise = null;

function normalizeCookie(raw) {
  if (!raw) return null;
  let c = String(raw);
  c = c.replace(/^\.ROBLOSECURITY=/i, "");
  c = c.trim().replace(/^["']|["']$/g, "").trim();
  c = c.replace(/[\r\n]+/g, "");
  return c;
}

async function ensureRobloxLogin() {
  if (loginPromise) return loginPromise;

  const cookie = normalizeCookie(process.env.ROBLOX_COOKIE);
  if (!cookie) throw new Error("Missing ROBLOX_COOKIE env var.");
  if (!cookie.includes("WARNING")) {
    throw new Error("ROBLOX_COOKIE missing WARNING text. Copy full .ROBLOSECURITY value.");
  }

  loginPromise = (async () => {
    await noblox.setCookie(cookie);
    const me = await noblox.getCurrentUser();
    console.log(`✅ [PAYMENT] Roblox logged in as ${me?.UserName ?? "Unknown"} (${me?.UserID ?? "?"})`);
    return me;
  })();

  return loginPromise;
}

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

function discordTs(unixOrDate) {
  const unix =
    typeof unixOrDate === "number"
      ? unixOrDate
      : Math.floor(new Date(unixOrDate).getTime() / 1000);
  if (!Number.isFinite(unix)) return "N/A";
  return `<t:${unix}:R>`;
}

function nowTs() {
  return `<t:${Math.floor(Date.now() / 1000)}:R>`;
}

async function postRaw(client, channelId, body) {
  return client.rest.post(Routes.channelMessages(channelId), { body });
}

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

async function logPaymentChange(client, conf, { userId, assetId, name, before, after, method }) {
  const logChannelId = conf.payment?.logChannelId;
  if (!logChannelId) return;

  const payload = {
    embeds: [
      {
        title: "✅ Shirt Price Updated",
        description:
          `**Asset:** ${name}\n` +
          `**Asset ID:** \`${assetId}\`\n` +
          `**Changed by:** <@${userId}>\n` +
          `**Method:** ${method}`,
        fields: [
          { name: "Old Price", value: `> ${fmt(before)}`, inline: true },
          { name: "New Price", value: `> ${fmt(after)}`, inline: true }
        ]
      }
    ]
  };

  await postRaw(client, logChannelId, payload).catch(() => {});
}

/**
 * Change catalog item price (shirt) for group-owned asset.
 * configureItem(assetId, name, description, enableComments, sellForRobux, genreSelection)
 */
async function changeShirtPrice(assetId, newPrice) {
  await ensureRobloxLogin();

  const infoBefore = await noblox.getProductInfo(Number(assetId));
  const name = infoBefore?.Name ?? "Shirt";
  const description = infoBefore?.Description ?? "";
  const before = infoBefore?.PriceInRobux ?? null;
  const onSaleBefore = Boolean(infoBefore?.IsForSale);

  await noblox.configureItem(Number(assetId), name, description, undefined, Number(newPrice), undefined);

  const infoAfter = await noblox.getProductInfo(Number(assetId));
  return {
    name,
    beforePrice: before,
    afterPrice: infoAfter?.PriceInRobux ?? null,
    onSale: Boolean(infoAfter?.IsForSale ?? onSaleBefore)
  };
}

/**
 * Recent transactions for GROUP sales:
 * We pull sales transactions, filter by assetId, take 3 latest.
 * NOTE: transaction shapes can vary slightly; we defensively read fields.
 */
async function getRecentAssetSales(groupId, assetId, limit = 50) {
  await ensureRobloxLogin();

  // noblox has group transactions helpers; function names differ by version.
  // We'll try a couple patterns to stay compatible.
  let tx = null;

  // Pattern A: getGroupTransactions(groupId, transactionType, limit, cursor)
  try {
    tx = await noblox.getGroupTransactions(Number(groupId), "Sale", { limit });
  } catch {}

  // Pattern B: getGroupTransactions(groupId, transactionType, limit)
  if (!tx) {
    try {
      tx = await noblox.getGroupTransactions(Number(groupId), "Sale", limit);
    } catch {}
  }

  // Normalize array
  const data = Array.isArray(tx) ? tx : tx?.data ?? tx?.Data ?? tx?.transactions ?? [];

  // Filter by assetId
  const filtered = data.filter((t) => {
    const details = t.details ?? t.Details ?? {};
    const aId =
      details?.assetId ??
      details?.AssetId ??
      details?.asset?.id ??
      t.assetId ??
      t.AssetId ??
      null;
    return String(aId) === String(assetId);
  });

  // Sort newest first (best-effort)
  filtered.sort((a, b) => {
    const ad = new Date(a.created ?? a.Created ?? a.createdAt ?? a.date ?? 0).getTime();
    const bd = new Date(b.created ?? b.Created ?? b.createdAt ?? b.date ?? 0).getTime();
    return bd - ad;
  });

  const top = filtered.slice(0, 3);

  // Map into a consistent shape
  const out = [];
  for (const t of top) {
    const details = t.details ?? t.Details ?? {};
    const buyerId =
      t.agent?.id ??
      t.agentId ??
      t.AgentId ??
      details?.buyerId ??
      details?.BuyerId ??
      details?.agentId ??
      null;

    const amount =
      details?.price ??
      details?.Price ??
      details?.robux ??
      details?.Robux ??
      t.amount ??
      t.Amount ??
      null;

    const created =
      t.created ?? t.Created ?? t.createdAt ?? t.date ?? details?.created ?? details?.Created ?? null;

    let username = t.agent?.name ?? t.agentName ?? null;
    if (!username && buyerId) {
      try {
        username = await noblox.getUsernameFromId(Number(buyerId));
      } catch {
        username = "User";
      }
    }

    out.push({
      userId: buyerId ? Number(buyerId) : null,
      username: username ?? "User",
      amount: amount ? Number(amount) : null,
      purchased: created ? discordTs(created) : "N/A"
    });
  }

  // Pad to 3 entries
  while (out.length < 3) out.push(null);
  return out;
}

function buildPaymentEmbed({ currentPrice, onSale, lastUpdated, transactions }) {
  const lines = [];

  lines.push(`## Gamepass History`);
  lines.push(`**Current Price:** ${fmt(currentPrice)}`);
  lines.push(`**On Sale:** ${onSale ? "Yes" : "No"}`);
  lines.push(`**Last Updated:** ${lastUpdated}`);
  lines.push(``);
  lines.push(`## Recent Transactions`);

  for (let i = 0; i < 3; i++) {
    const t = transactions?.[i] ?? null;
    if (!t) {
      lines.push(`**\`${i + 1}\`** *(No data)*`);
      lines.push(`> - **Amount:** N/A`);
      lines.push(`> - **Purchased:** N/A`);
      lines.push(``);
      continue;
    }

    const userLine = t.userId
      ? `[${t.username}](https://www.roblox.com/users/${t.userId}/profile)`
      : `${t.username}`;

    lines.push(`**\`${i + 1}\`** ${userLine}`);
    lines.push(`> - **Amount:** ${fmt(t.amount)}`);
    lines.push(`> - **Purchased:** ${t.purchased}`);
    lines.push(``);
  }

  return {
    embeds: [{ description: lines.join("\n") }],
    components: []
  };
}

// --- Slash ---
async function handlePaymentSlash(client, interaction) {
  if (!interaction.isChatInputCommand?.()) return false;
  if (interaction.commandName !== "payment") return false;

  const conf = readConfig();
  const pay = conf.payment ?? {};

  if (!pay.allowedRoleId) {
    return interaction.reply({ content: "Payment not configured (missing allowedRoleId).", ephemeral: true });
  }
  if (!hasRole(interaction.member, pay.allowedRoleId)) {
    return interaction.reply({ content: "❌ You don’t have permission to use this.", ephemeral: true });
  }

  const assetId = pay.assetId;
  const groupId = pay.groupId;

  if (!assetId || !groupId) {
    return interaction.reply({
      content: "Payment not configured (missing assetId or groupId).",
      ephemeral: true
    });
  }

  const maxPrice = Number(pay.maxPrice ?? 100000);
  const newPrice = parsePrice(interaction.options.getInteger("price", true));

  if (newPrice === null || newPrice > maxPrice) {
    return interaction.reply({ content: `Invalid price. Max is ${fmt(maxPrice)}.`, ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true }).catch(() => {});

  try {
    const res = await changeShirtPrice(assetId, newPrice);

    // Pull recent transactions AFTER updating
    const tx = await getRecentAssetSales(groupId, assetId, 50);

    await logPaymentChange(client, conf, {
      userId: interaction.user.id,
      assetId,
      name: res.name,
      before: res.beforePrice,
      after: res.afterPrice,
      method: "slash (/payment)"
    });

    return interaction.editReply(
      buildPaymentEmbed({
        currentPrice: res.afterPrice,
        onSale: res.onSale,
        lastUpdated: nowTs(),
        transactions: tx
      })
    );
  } catch (e) {
    console.error("❌ [PAYMENT] slash error:", e);
    return interaction.editReply({ content: `Failed. (${e?.message ?? "Unknown error"})` });
  }
}

// --- Prefix (-payment 100) ---
async function handlePaymentPrefix(client, message) {
  const conf = readConfig();
  const pay = conf.payment ?? {};
  const prefix = String(pay.prefix ?? "-");

  if (!message.guild || message.author.bot) return false;

  const content = String(message.content ?? "").trim();
  if (!content.toLowerCase().startsWith(`${prefix}payment`)) return false;

  if (!pay.allowedRoleId) {
    await message.reply("Payment not configured (missing allowedRoleId).").catch(() => {});
    return true;
  }
  if (!hasRole(message.member, pay.allowedRoleId)) {
    await message.reply("❌ You don’t have permission to use this.").catch(() => {});
    return true;
  }

  const assetId = pay.assetId;
  const groupId = pay.groupId;
  if (!assetId || !groupId) {
    await message.reply("Payment not configured (missing assetId or groupId).").catch(() => {});
    return true;
  }

  const parts = content.split(/\s+/);
  const newPrice = parsePrice(parts[1]);
  const maxPrice = Number(pay.maxPrice ?? 100000);

  if (newPrice === null || newPrice > maxPrice) {
    await message.reply(`Usage: \`${prefix}payment 100\` (max ${fmt(maxPrice)})`).catch(() => {});
    return true;
  }

  // prefix can't be ephemeral; delete + DM
  await message.delete().catch(() => {});

  try {
    const res = await changeShirtPrice(assetId, newPrice);
    const tx = await getRecentAssetSales(groupId, assetId, 50);

    await logPaymentChange(client, conf, {
      userId: message.author.id,
      assetId,
      name: res.name,
      before: res.beforePrice,
      after: res.afterPrice,
      method: `prefix (${prefix}payment)`
    });

    const payload = buildPaymentEmbed({
      currentPrice: res.afterPrice,
      onSale: res.onSale,
      lastUpdated: nowTs(),
      transactions: tx
    });

    await message.author.send(payload).catch(async () => {
      const warn = await message.channel
        .send({ content: `<@${message.author.id}> I couldn’t DM you. Enable DMs from this server.` })
        .catch(() => null);
      if (warn) setTimeout(() => warn.delete().catch(() => {}), 6000);
    });
  } catch (e) {
    console.error("❌ [PAYMENT] prefix error:", e);
    await message.author.send(`Failed. (${e?.message ?? "Unknown error"})`).catch(() => {});
  }

  return true;
}

export default function registerPaymentModule(client) {
  client.once("ready", async () => {
    try {
      const cmd = {
        name: "payment",
        description: "Change the configured shirt price (Robux).",
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
      await handlePaymentPrefix(client, message);
    } catch (e) {
      console.error("❌ [PAYMENT] messageCreate error:", e);
    }
  });
}
