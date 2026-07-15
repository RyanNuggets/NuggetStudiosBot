// index.js
import { Client, GatewayIntentBits, Partials } from "discord.js";
import fs from "fs";

// Existing modules (keep as-is profession)
import { sendDashboard, handleDashboardInteractions } from "./Features/dashboard.js";
import registerWelcomeModule from "./Features/welcome.js";
import { sendOrderHub, handleOrderHubInteractions } from "./Features/orderhub.js";
import registerTaxModule from "./Features/tax.js";

// ✅ Package system (JSON file store + Docksys verified claims)
import { registerPackageSystem } from "./Features/packageSystem/index.js";

// --- NODE 18+ CRASH FIX (kept from your secondary test) ---
if (typeof globalThis.File === "undefined") {
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  const { Blob } = require("buffer");
  globalThis.File = class extends Blob {
    constructor(parts, filename, options = {}) {
      super(parts, options);
      this.name = filename;
      this.lastModified = options.lastModified || Date.now();
    }
  };
}

// ---------------- CONFIG ----------------
const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));
const config = readConfig();

// ---------------- DATA STORAGE ----------------
// The package system stores its data as JSON on disk
// (Features/Shared/jsonStore.js), not in an external database.
//
// On Railway: attach a Volume to this service and set DATA_DIR to its mount
// path (e.g. DATA_DIR=/data). Without a volume, DATA_DIR defaults to ./data,
// which works locally but is wiped on every Railway redeploy.
import { DATA_DIR } from "./Features/Shared/jsonStore.js";

fs.mkdirSync(DATA_DIR, { recursive: true });
console.log(`✅ Using data directory: ${DATA_DIR}${process.env.DATA_DIR ? "" : " (set DATA_DIR to a Railway volume mount in production)"}`);

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

// ✅ Add this so other modules can call client.logs.custom / error
client.logs = {
  custom: (...args) => console.log("[LOG]", ...args),
  error: (...args) => console.error("[ERROR]", ...args)
};

// Toggle these to true only when you want to post the messages once.
const POST_DASHBOARD_ON_START = true;
const POST_ORDERHUB_ON_START = true;

// ✅ IMPORTANT: register these BEFORE ready so their command registration
// on "ready" fires correctly.
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
if (!process.env.DOCKSYS_API_KEY) console.warn("⚠️ Missing DOCKSYS_API_KEY env var (Roblox account linking will fail).");

client.login(process.env.TOKEN);
