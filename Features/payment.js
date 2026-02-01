// Features/payment.js
import noblox from "noblox.js";
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs";

// ---------- CONFIG ----------
const readConfig = () => {
  console.log("[DEBUG] Reading config.json...");
  return JSON.parse(fs.readFileSync("./config.json", "utf8"));
};

// ---------- ROBLOX LOGIN ----------
let robloxLoggedIn = false;
async function robloxLogin() {
  if (robloxLoggedIn) return;
  console.log("[DEBUG] Attempting Roblox login...");
  const cookie = process.env.ROBLOX_COOKIE;
  if (!cookie) throw new Error("Missing ROBLOX_COOKIE env var.");

  noblox.setOptions({ show_deprecation_warnings: false });
  await noblox.setCookie(cookie);

  const me = await noblox.getAuthenticatedUser().catch(() => null);
  console.log(`✅ [PAYMENT] Logged in as: ${me?.UserName ?? "Unknown"} (${me?.UserID ?? "ID Not Found"})`);
  robloxLoggedIn = true;
}

// ---------- HELPERS ----------
function hasRole(member, roleId) {
  return roleId ? Boolean(member?.roles?.cache?.has(roleId)) : false;
}

function discordTs(dateLike) {
  return `<t:${Math.floor(new Date(dateLike).getTime() / 1000)}:F>`;
}

async function safeGetProductInfo(assetId) {
  console.log(`[DEBUG] Fetching product info for AssetID: ${assetId}`);
  try {
    const info = await noblox.getProductInfo(Number(assetId));
    console.log(`[DEBUG] Successfully fetched info for: "${info.Name}"`);
    return info;
  } catch (e) {
    if (e.message.includes("429")) return "RATE_LIMITED";
    console.error(`[DEBUG] Error fetching info: ${e.message}`);
    return null;
  }
}

// ---------- THE FIX: CONFIGURE PRICE ----------
async function configurePrice(assetId, newPrice, info) {
  const assetType = info.AssetTypeId; 
  // AssetType 34 = Gamepass, 11 = Shirt, 12 = Pants
  console.log(`[DEBUG] Asset Type detected: ${assetType} (Name: ${info.Name})`);

  try {
    if (assetType === 34) {
      console.log(`[DEBUG] Detected GAMEPASS. Using setGamepassPrice...`);
      // Gamepasses need a different function
      await noblox.setGamepassPrice(Number(assetId), Number(newPrice));
    } else {
      console.log(`[DEBUG] Detected CLOTHING/ITEM. Using configureItem...`);
      console.log(`[DEBUG] Params: Name="${info.Name}", Desc="${info.Description || ""}", Price=${newPrice}`);
      
      await noblox.configureItem(
        Number(assetId),
        String(info.Name),
        String(info.Description || ""),
        null,
        Number(newPrice),
        null
      );
    }
    console.log(`[DEBUG] Roblox update successful for Asset ${assetId}`);
  } catch (err) {
    console.error(`[DEBUG] CRITICAL ERROR during update:`, err);
    
    if (err.message.includes("[0]")) {
      throw new Error("Roblox Error [0]: Permission Denied. Ensure the bot has 'Configure Group Items' and the asset is a Group asset.");
    }
    throw err;
  }
}

// ---------- RUN CHANGE ----------
async function runPaymentChange(messageOrInteraction, priceRaw, isInteraction = false) {
  console.log(`[DEBUG] Starting runPaymentChange. Raw Price Input: ${priceRaw}`);
  
  const cfg = readConfig();
  const pay = cfg.payment;
  const { assetId, groupId, allowedRoleId, logChannelId } = pay;

  // 1. Permission Check
  const member = messageOrInteraction.member;
  if (!hasRole(member, allowedRoleId)) {
    console.log(`[DEBUG] User ${member.user.tag} denied access (Missing Role).`);
    const content = "❌ You do not have permission.";
    return isInteraction ? messageOrInteraction.reply({ content, ephemeral: true }) : messageOrInteraction.reply(content);
  }

  // 2. Login
  try {
    await robloxLogin();
  } catch (e) {
    console.error(`[DEBUG] Login step failed: ${e.message}`);
    return messageOrInteraction.reply("❌ Roblox Login Failed.");
  }

  // 3. Asset Data Fetch
  const info = await safeGetProductInfo(assetId);
  if (info === "RATE_LIMITED") return messageOrInteraction.reply("❌ Rate limited by Roblox. Wait 5 mins.");
  if (!info) return messageOrInteraction.reply(`❌ Could not find asset \`${assetId}\`.`);

  // 4. Update
  try {
    const newPrice = Math.floor(Number(priceRaw));
    console.log(`[DEBUG] Validated Price: ${newPrice}. Sending to Roblox...`);
    
    await configurePrice(assetId, newPrice, info);

    // 5. Success UI
    console.log(`[DEBUG] Building success embed...`);
    const embed = new EmbedBuilder()
      .setTitle("✅ Price Updated")
      .setDescription(`Successfully set **${info.Name}** to **${newPrice} Robux**.`)
      .addFields(
        { name: "Asset ID", value: `\`${assetId}\``, inline: true },
        { name: "Type", value: info.AssetTypeId === 34 ? "Gamepass" : "Clothing", inline: true }
      )
      .setTimestamp();

    await messageOrInteraction.reply({ embeds: [embed] });

    // 6. Logging to Discord Channel
    if (logChannelId) {
      const logCh = messageOrInteraction.client.channels.cache.get(logChannelId);
      if (logCh) {
        const actor = isInteraction ? messageOrInteraction.user.tag : messageOrInteraction.author.tag;
        await logCh.send({ content: `🛠️ **Price Change:** \`${info.Name}\` set to \`${newPrice}\` by ${actor}` });
      }
    }

  } catch (err) {
    console.error(`[DEBUG] runPaymentChange caught error:`, err);
    const content = `❌ **Update Failed**\nReason: \`${err.message}\``;
    if (isInteraction) {
        await messageOrInteraction.reply({ content, ephemeral: true }).catch(() => {});
    } else {
        await messageOrInteraction.reply(content).catch(() => {});
    }
  }
}

// ---------- MODULE REGISTRATION ----------
export default function registerPaymentModule(client) {
  const cfg = readConfig();
  const prefix = cfg.payment?.prefix ?? "-";

  client.once("ready", async () => {
    const cmd = new SlashCommandBuilder()
      .setName("payment")
      .setDescription("Change product price")
      .addIntegerOption(o => o.setName("price").setDescription("New price").setRequired(true));
    
    await client.application.commands.create(cmd).catch(console.error);
    console.log("✅ [PAYMENT] System Ready & Slash Command Registered");
  });

  client.on("interactionCreate", async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== "payment") return;
    await runPaymentChange(i, i.options.getInteger("price"), true);
  });

  client.on("messageCreate", async (m) => {
    if (m.author.bot || !m.content.startsWith(prefix + "payment")) return;
    const price = m.content.split(" ")[1];
    await runPaymentChange(m, price, false);
  });
}
