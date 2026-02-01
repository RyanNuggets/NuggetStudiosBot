// Features/payment.js
import noblox from "noblox.js";
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs";

// ---------- CONFIG ----------
const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));

// ---------- ROBLOX LOGIN ----------
let robloxLoggedIn = false;
async function robloxLogin() {
  if (robloxLoggedIn) return;
  const cookie = process.env.ROBLOX_COOKIE;
  if (!cookie) throw new Error("Missing ROBLOX_COOKIE env var.");

  noblox.setOptions({ show_deprecation_warnings: false });
  try {
    const me = await noblox.setCookie(cookie);
    console.log(`✅ [PAYMENT] Authenticated: ${me.UserName} (${me.UserID})`);
    robloxLoggedIn = true;
  } catch (e) {
    throw new Error("Roblox login failed. Check your cookie.");
  }
}

// ---------- THE ULTIMATE UPDATE FUNCTION ----------
async function updateRobloxPrice(assetId, newPrice) {
  console.log(`[DEBUG] Target ID: ${assetId} | New Price: ${newPrice}`);

  // 1. Get Product Info to find the internal ProductID
  const info = await noblox.getProductInfo(Number(assetId)).catch(e => {
    console.error("[DEBUG] Failed to fetch info:", e.message);
    return null;
  });

  if (!info) throw new Error("Could not find item info on Roblox.");

  // For long IDs, we MUST use ProductId for economy changes
  const targetId = info.ProductId || assetId;
  const isGamepass = info.AssetTypeId === 34;

  console.log(`[DEBUG] Name: ${info.Name} | ProductID: ${targetId} | Type: ${info.AssetTypeId}`);

  try {
    if (isGamepass) {
      console.log("[DEBUG] Updating as Gamepass...");
      await noblox.setGamepassPrice(Number(assetId), Number(newPrice));
    } else {
      console.log("[DEBUG] Updating as Clothing Item...");
      // Using the more reliable update method
      await noblox.configureItem(
        Number(assetId),
        String(info.Name),
        String(info.Description || ""),
        false, // enableComments
        Number(newPrice)
      );
    }
    return info;
  } catch (err) {
    console.error(`[DEBUG] Internal Roblox Rejection:`, err);
    
    // Final fallback: If configureItem fails with [0], it's a Permission/API sync issue
    if (err.message.includes("[0]")) {
      throw new Error("Roblox rejected the update (Error 0). Even if you have perms, Roblox often blocks automated price changes on 'New' Asset IDs via this API. Try using a Gamepass instead of a Shirt for the payment.");
    }
    throw err;
  }
}

// ---------- RUN CHANGE ----------
async function runPaymentChange(messageOrInteraction, priceRaw, isInteraction = false) {
  const cfg = readConfig();
  const pay = cfg.payment;

  // Use BigInt conversion for safety, then back to Number for noblox
  const assetId = String(pay.assetId).replace(/['"]/g, ''); 
  const allowedRole = pay.allowedRoleId;

  // Permission Check
  if (allowedRole && !messageOrInteraction.member.roles.cache.has(allowedRole)) {
    const msg = "❌ You don't have the required role.";
    return isInteraction ? messageOrInteraction.reply({ content: msg, ephemeral: true }) : messageOrInteraction.reply(msg);
  }

  const price = parseInt(priceRaw);
  if (isNaN(price) || price < 0) {
    return isInteraction ? messageOrInteraction.reply("❌ Invalid price.") : messageOrInteraction.reply("❌ Invalid price.");
  }

  await robloxLogin();

  try {
    const info = await updateRobloxPrice(assetId, price);

    const embed = new EmbedBuilder()
      .setTitle("✅ Price Updated")
      .setColor(0x00FF00)
      .setDescription(`Successfully updated **${info.Name}**`)
      .addFields(
        { name: "New Price", value: `${price} Robux`, inline: true },
        { name: "Asset ID", value: `\`${assetId}\``, inline: true }
      )
      .setTimestamp();

    await (isInteraction ? messageOrInteraction.reply({ embeds: [embed] }) : messageOrInteraction.reply({ embeds: [embed] }));

    // Log Channel
    if (pay.logChannelId) {
      const channel = messageOrInteraction.client.channels.cache.get(pay.logChannelId);
      if (channel) {
        const user = isInteraction ? messageOrInteraction.user.tag : messageOrInteraction.author.tag;
        channel.send(`🛠️ **Price Log:** ${user} changed price to ${price} for \`${info.Name}\`.`);
      }
    }

  } catch (err) {
    const reason = err.message;
    const content = `❌ **Failed to update price.**\nReason: \`${reason}\``;
    if (isInteraction) {
      if (messageOrInteraction.replied) await messageOrInteraction.followUp({ content, ephemeral: true });
      else await messageOrInteraction.reply({ content, ephemeral: true });
    } else {
      await messageOrInteraction.reply(content);
    }
  }
}

// ---------- REGISTER ----------
export default function registerPaymentModule(client) {
  const cfg = readConfig();
  const prefix = cfg.payment?.prefix || "-";

  client.once("ready", async () => {
    const cmd = new SlashCommandBuilder()
      .setName("payment")
      .setDescription("Change the price of the payment item.")
      .addIntegerOption(o => o.setName("price").setDescription("Robux amount").setRequired(true));
    await client.application.commands.create(cmd).catch(() => {});
    console.log("✅ Payment Module Loaded");
  });

  client.on("interactionCreate", async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== "payment") return;
    await runPaymentChange(i, i.options.getInteger("price"), true);
  });

  client.on("messageCreate", async (m) => {
    if (m.author.bot || !m.content.startsWith(prefix + "payment")) return;
    const args = m.content.split(" ");
    await runPaymentChange(m, args[1], false);
  });
}
