// Features/payment.js
import noblox from "noblox.js";
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs";

const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));

let robloxLoggedIn = false;

async function robloxLogin(force = false) {
  if (robloxLoggedIn && !force) return;
  
  console.log(`[DEBUG] ${force ? 'RE-LOGGING' : 'Logging'} into Roblox...`);
  const cookie = process.env.ROBLOX_COOKIE;
  if (!cookie) throw new Error("Missing ROBLOX_COOKIE env var.");

  noblox.setOptions({ show_deprecation_warnings: false });

  try {
    // We clear the session if forcing a re-login
    const currentUser = await noblox.setCookie(cookie);
    console.log(`✅ [PAYMENT] Authenticated as: ${currentUser.UserName} (${currentUser.UserID})`);
    robloxLoggedIn = true;
  } catch (e) {
    console.error(`[DEBUG] Login Failed: ${e.message}`);
    throw new Error("Invalid Cookie or Session Expired.");
  }
}

async function safeGetProductInfo(assetId) {
  try {
    return await noblox.getProductInfo(Number(assetId));
  } catch (e) {
    console.error(`[DEBUG] Info Fetch Error: ${e.message}`);
    return null;
  }
}

async function configurePrice(assetId, newPrice, info) {
  const assetType = info.AssetTypeId;
  console.log(`[DEBUG] Attempting update for ${info.Name} (Type: ${assetType})`);

  try {
    if (assetType === 34) {
      await noblox.setGamepassPrice(Number(assetId), Number(newPrice));
    } else {
      // THE FIX: We use a more "raw" call logic by ensuring name/desc are strings
      // and checking the sale status.
      await noblox.configureItem(
        Number(assetId),
        String(info.Name),
        String(info.Description || "Updated by Bot"),
        false, // enableComments
        Number(newPrice),
        "All" // genre
      );
    }
  } catch (err) {
    // If it fails with [0], we try to refresh the session once
    if (err.message.includes("[0]") || err.message.includes("403")) {
        console.log("[DEBUG] Hit Error [0]. Attempting session refresh and retry...");
        await robloxLogin(true); // Force re-log to get fresh CSRF
        
        // Final attempt
        return await noblox.configureItem(
            Number(assetId),
            String(info.Name),
            String(info.Description || "Updated by Bot"),
            false,
            Number(newPrice)
        );
    }
    throw err;
  }
}

export default function registerPaymentModule(client) {
  const cfg = readConfig();
  const pay = cfg.payment;

  client.once("ready", async () => {
    const cmd = new SlashCommandBuilder()
      .setName("payment")
      .setDescription("Change the price of the payment shirt")
      .addIntegerOption(o => o.setName("price").setDescription("Robux amount").setRequired(true));
    await client.application.commands.create(cmd).catch(() => {});
  });

  async function runChange(context, priceRaw, isInteraction) {
    console.log(`[DEBUG] Command triggered by ${isInteraction ? context.user.tag : context.author.tag}`);
    
    try {
      await robloxLogin();
      
      const info = await safeGetProductInfo(pay.assetId);
      if (!info) throw new Error("Could not find asset info.");

      await configurePrice(pay.assetId, priceRaw, info);

      const embed = new EmbedBuilder()
        .setTitle("✅ Price Updated Successfully")
        .setColor(0x00FF00)
        .addFields(
          { name: "Item", value: info.Name, inline: true },
          { name: "New Price", value: `${priceRaw} Robux`, inline: true }
        )
        .setTimestamp();

      return isInteraction ? context.reply({ embeds: [embed] }) : context.reply({ embeds: [embed] });

    } catch (err) {
      console.error(`[FINAL ERROR]`, err);
      const msg = `❌ **Error:** ${err.message.includes("[0]") ? "Roblox rejected the request. Try logging into the bot on a browser once to solve the captcha/challenge, then restart the bot." : err.message}`;
      
      if (isInteraction) {
        if (context.replied) await context.followUp({ content: msg, ephemeral: true });
        else await context.reply({ content: msg, ephemeral: true });
      } else {
        await context.reply(msg);
      }
    }
  }

  client.on("interactionCreate", async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== "payment") return;
    await runChange(i, i.options.getInteger("price"), true);
  });

  client.on("messageCreate", async (m) => {
    const prefix = pay.prefix || "-";
    if (m.author.bot || !m.content.startsWith(prefix + "payment")) return;
    const price = parseInt(m.content.split(" ")[1]);
    if (isNaN(price)) return m.reply("Usage: -payment <number>");
    await runChange(m, price, false);
  });
}
