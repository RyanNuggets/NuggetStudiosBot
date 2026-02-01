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
    console.log(`✅ [PAYMENT] Logged in as: ${me.UserName} (${me.UserID})`);
    robloxLoggedIn = true;
  } catch (e) {
    throw new Error("Roblox session expired. Please update your cookie.");
  }
}

// ---------- GAMEPASS UPDATE FUNCTION ----------
async function updateGamepassPrice(gamepassId, newPrice) {
  console.log(`[DEBUG] Attempting to set Gamepass ${gamepassId} to ${newPrice} Robux...`);

  try {
    // Gamepasses use a direct economy endpoint that handles long IDs better
    await noblox.setGamepassPrice(Number(gamepassId), Number(newPrice));
    
    // Fetch info just for the embed/confirmation
    const info = await noblox.getGeneralToken(); // Getting a token to ensure session is fresh
    const productInfo = await noblox.getProductInfo(Number(gamepassId));
    
    console.log(`[DEBUG] Success! Gamepass "${productInfo.Name}" updated.`);
    return productInfo;
  } catch (err) {
    console.error(`[DEBUG] Gamepass Update Failed:`, err.message);
    
    if (err.message.includes("403")) {
      throw new Error("Permission Denied (403). Ensure the bot account owns the gamepass or has 'Manage Permissions' in the game.");
    }
    throw err;
  }
}

// ---------- RUN CHANGE ----------
async function runPaymentChange(messageOrInteraction, priceRaw, isInteraction = false) {
  const cfg = readConfig();
  const pay = cfg.payment;

  // Cleanup ID (Remove quotes/whitespace)
  const gamepassId = String(pay.assetId).replace(/[^0-9]/g, '');
  const allowedRole = pay.allowedRoleId;

  // 1. Permission Check
  if (allowedRole && !messageOrInteraction.member.roles.cache.has(allowedRole)) {
    const msg = "❌ You don't have the required role to change the price.";
    return isInteraction ? messageOrInteraction.reply({ content: msg, ephemeral: true }) : messageOrInteraction.reply(msg);
  }

  // 2. Price Validation
  const price = Math.floor(Number(priceRaw));
  if (isNaN(price) || price < 0) {
    const msg = "❌ Please provide a valid positive number for the price.";
    return isInteraction ? messageOrInteraction.reply({ content: msg, ephemeral: true }) : messageOrInteraction.reply(msg);
  }

  await robloxLogin();

  try {
    const info = await updateGamepassPrice(gamepassId, price);

    const embed = new EmbedBuilder()
      .setTitle("💎 Gamepass Price Updated")
      .setColor(0x00A2FF) // Gamepass Blue
      .setDescription(`The payment gamepass has been updated.`)
      .addFields(
        { name: "Gamepass Name", value: `**${info.Name}**`, inline: false },
        { name: "New Price", value: `🪙 ${price} Robux`, inline: true },
        { name: "Gamepass ID", value: `\`${gamepassId}\``, inline: true }
      )
      .setThumbnail(`https://www.roblox.com/asset-thumbnail/image?assetId=${gamepassId}&width=420&height=420&format=png`)
      .setTimestamp();

    await (isInteraction ? messageOrInteraction.reply({ embeds: [embed] }) : messageOrInteraction.reply({ embeds: [embed] }));

    // 3. Log Channel
    if (pay.logChannelId) {
      const channel = messageOrInteraction.client.channels.cache.get(pay.logChannelId);
      if (channel) {
        const user = isInteraction ? messageOrInteraction.user.tag : messageOrInteraction.author.tag;
        channel.send(`📑 **Price Audit:** ${user} set Gamepass \`${gamepassId}\` price to \`${price}\`.`);
      }
    }

  } catch (err) {
    const content = `❌ **Gamepass Update Failed**\nReason: \`${err.message}\``;
    if (isInteraction) {
      if (messageOrInteraction.replied) await messageOrInteraction.followUp({ content, ephemeral: true });
      else await messageOrInteraction.reply({ content, ephemeral: true });
    } else {
      await messageOrInteraction.reply(content);
    }
  }
}

// ---------- REGISTER MODULE ----------
export default function registerPaymentModule(client) {
  const cfg = readConfig();
  const prefix = cfg.payment?.prefix || "-";

  client.once("ready", async () => {
    const cmd = new SlashCommandBuilder()
      .setName("payment")
      .setDescription("Change the price of the payment gamepass.")
      .addIntegerOption(o => o.setName("price").setDescription("Robux amount").setRequired(true));
    
    await client.application.commands.create(cmd).catch(() => {});
    console.log("✅ Gamepass Payment Module Registered");
  });

  client.on("interactionCreate", async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== "payment") return;
    await runPaymentChange(i, i.options.getInteger("price"), true);
  });

  client.on("messageCreate", async (m) => {
    if (m.author.bot || !m.content.startsWith(prefix + "payment")) return;
    const args = m.content.split(/\s+/);
    await runPaymentChange(m, args[1], false);
  });
}
