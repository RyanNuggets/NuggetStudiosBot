// index.js
import { Client, GatewayIntentBits, Partials } from "discord.js";
import fs from "fs";

// Existing modules (keep as-is profession)
import { sendDashboard, handleDashboardInteractions } from "./Features/dashboard.js";
import registerWelcomeModule from "./Features/welcome.js";
import { sendOrderHub, handleOrderHubInteractions } from "./Features/orderhub.js";
import registerTaxModule from "./Features/tax.js";

// ✅ Package system
import { registerPackageSystem } from "./Features/packageSystem.js";

// ✅ Purchase monitor (CommonJS module)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const purchaseMonitor = require("./Features/purchasemonitor.cjs");

// ---------------- CONFIG ----------------
const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));
const config = readConfig();

// ---------------- CLIENT ----------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// ✅ Add this so purchasemonitor.js can call client.logs.custom / error
client.logs = {
  custom: (...args) => console.log("[LOG]", ...args),
  error: (...args) => console.error("[ERROR]", ...args)
};

// Toggle these to true only when you want to post the messages once.
const POST_DASHBOARD_ON_START = true;
const POST_ORDERHUB_ON_START = true;

// ✅ IMPORTANT: register package system BEFORE ready
try {
  registerPackageSystem(client, config);
  console.log("✅ Package system loaded (waiting for ready to register commands)");
} catch (err) {
  console.error("❌ Package system failed to load:", err);
}

// ---------------- READY ----------------
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Existing modules
  registerWelcomeModule(client);
  console.log("✅ Welcome module registered");

  registerTaxModule(client, { prefix: "-" });
  console.log("✅ Tax module registered");

  if (POST_DASHBOARD_ON_START) {
    try {
      await sendDashboard(client);
      console.log("✅ Dashboard sent on start");
    } catch (err) {
      console.error("❌ Failed to send dashboard:", err);
    }
  }

  if (POST_ORDERHUB_ON_START) {
    try {
      await sendOrderHub(client);
      console.log("✅ Order Hub sent on start");
    } catch (err) {
      console.error("❌ Failed to send order hub:", err);
    }
  }

  // ✅ Start purchase logging monitor
  try {
    // purchasemonitor.js exports { name, once, execute }
    await purchaseMonitor.execute(client);
    console.log("✅ Purchase logging module started successfully.");
  } catch (error) {
    console.error("❌ Error starting purchase logging module:", error);
  }
});

// ---------------- INTERACTIONS ----------------
client.on("interactionCreate", async (interaction) => {
  try {
    await handleDashboardInteractions(client, interaction);
    await handleOrderHubInteractions(client, interaction);
    // tax handled in tax module
    // packageSystem handles its own interactions internally
  } catch (err) {
    console.error("❌ interactionCreate error:", err);

    if (interaction?.isRepliable?.()) {
      const payload = { content: "Something went wrong.", ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  }
});

// ---------- Process guards ----------
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

// ---------------- LOGIN ----------------
if (!process.env.TOKEN) {
  console.error("❌ Missing TOKEN environment variable (Railway Variables).");
  process.exit(1);
}

// Package system needs these:
if (!process.env.CLIENT_ID) console.warn("⚠️ Missing CLIENT_ID env var (slash commands will not register).");
if (!process.env.DISCORD_TOKEN) console.warn("⚠️ Missing DISCORD_TOKEN env var (set it same as TOKEN).");

client.login(process.env.TOKEN);

Secondary testing index.js
// --- NODE 18+ CRASH FIX ---
if (typeof File === 'undefined') {
    const { Blob } = require('buffer');
    global.File = class extends Blob {
        constructor(parts, filename, options = {}) {
            super(parts, options);
            this.name = filename;
            this.lastModified = options.lastModified || Date.now();
        }
    };
}

const { Client, GatewayIntentBits } = require("discord.js");
const noblox = require("noblox.js");
const { HttpsProxyAgent } = require("https-proxy-agent");
require("dotenv").config();

const config = require("./config.json");
const registerPriceModule = require("./Features/price.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
});

// Setup Proxy Agent correctly
const agent = new HttpsProxyAgent(config.proxyUrl);

async function startBot() {
    console.log("--- System Startup ---");
    
    const cookie = process.env.ROBLOX_COOKIE;
    if (!cookie) {
        console.error("❌ Missing ROBLOX_COOKIE in .env file");
        process.exit(1);
    }

    try {
        console.log(`[Roblox] 🌐 Logging in via: ${config.proxyUrl}`);
        
        // Use the agent directly inside setCookie
        const user = await noblox.setCookie(cookie, { agent });
        console.log(`[Roblox] ✅ Authenticated as ${user.UserName}`);

        // Start Price Module
        registerPriceModule(client, agent, config.payment);
        
        await client.login(process.env.DISCORD_TOKEN);
    } catch (err) {
        console.error("[Critical] Startup Error:", err.message);
        process.exit(1);
    }
}

client.once("ready", () => console.log(`[Discord] ✅ ${client.user.tag} is online`));

startBot();
