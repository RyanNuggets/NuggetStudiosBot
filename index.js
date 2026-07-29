// index.js
import { Client, GatewayIntentBits, Partials } from "discord.js";
import fs from "fs";

// Existing modules (keep as-is profession)
import { sendDashboard, handleDashboardInteractions } from "./Features/dashboard.js";
import registerWelcomeModule from "./Features/welcome.js";
import { sendOrderHub, handleOrderHubInteractions } from "./Features/orderhub.js";
import registerTaxModule from "./Features/tax.js";

// ✅ /servicechange slash command
import { data as serviceChangeData, execute as serviceChangeExecute } from "./Features/servicechange.js";

// ✅ Package system (JSON file store + Bloxlink verified claims)
import { registerPackageSystem } from "./Features/packageSystem/index.js";

// ✅ Payment system (Robux Gamepass/T-Shirt, Apple/Google Pay via Ziina, Card via PayPal)
import registerPaymentModule from "./Features/Payment/index.js";

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

client.logs = {
  custom: (...args) => console.log("[LOG]", ...args),
  error: (...args) => console.error("[ERROR]", ...args)
};

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

try {
  registerPaymentModule(client);
  console.log("✅ Payment module loaded (waiting for ready to register commands)");
} catch (err) {
  console.error("❌ Payment module failed to load:", err);
}

// ---------------- READY ----------------
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

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

  try {
    if (config.guildId) {
      const guild = await client.guilds.fetch(config.guildId);
      await guild.commands.create(serviceChangeData.toJSON());
      console.log("✅ /servicechange registered (guild-scoped)");
    } else {
      console.warn("⚠️ Missing config.guildId — skipped registering /servicechange. Add guildId or switch to global registration.");
    }
  } catch (err) {
    console.error("❌ Failed to register /servicechange:", err);
  }
});

// ---------------- INTERACTIONS ----------------
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand?.() && interaction.commandName === "servicechange") {
      return await serviceChangeExecute(interaction);
    }

    await handleDashboardInteractions(client, interaction);
    await handleOrderHubInteractions(client, interaction);
    // tax handled in tax module
    // packageSystem handles its own interactions internally
    // payment feature handles its own interactions internally (scoped to "pay:*" customIds)
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

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

if (!process.env.TOKEN) {
  console.error("❌ Missing TOKEN environment variable (Railway Variables).");
  process.exit(1);
}

if (!process.env.CLIENT_ID) console.warn("⚠️ Missing CLIENT_ID env var (slash commands will not register).");
if (!process.env.BLOXLINK_API_KEY) console.warn("⚠️ Missing BLOXLINK_API_KEY env var (Roblox account linking will fail).");

client.login(process.env.TOKEN);
