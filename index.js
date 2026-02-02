// index.js
import { Client, GatewayIntentBits, Partials } from "discord.js";
import fs from "fs";

// Existing modules (keep as-is)
import { sendDashboard, handleDashboardInteractions } from "./Features/dashboard.js";
import registerWelcomeModule from "./Features/welcome.js";
import { sendOrderHub, handleOrderHubInteractions } from "./Features/orderhub.js";
import registerTaxModule from "./Features/tax.js";

// ✅ Package system (registration handled inside packageSystem.js)
import { registerPackageSystem } from "./Features/packageSystem.js";

// ---------------- CONFIG ----------------
const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));
const config = readConfig();

// ---------------- CLIENT ----------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // required for -tax and some flows
    GatewayIntentBits.GuildMembers,   // welcome + role checks
    GatewayIntentBits.DirectMessages  // ✅ package system DM wizard
  ],
  partials: [Partials.Channel] // ✅ required for DMs
});

// Toggle these to true only when you want to post the messages once.
// After they post, set back to false so they don't repost on every restart.
const POST_DASHBOARD_ON_START = true;
const POST_ORDERHUB_ON_START = true;

// ---------------- READY ----------------
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // ✅ Register feature modules (listeners + commands)
  registerWelcomeModule(client);
  registerTaxModule(client, { prefix: "-" });

  // ✅ Register package system (includes slash command registration internally)
  // We retry a few times so it 100% shows up even if Discord is slow on boot.
  const MAX_RETRIES = 5;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`🔄 Starting package system (attempt ${attempt}/${MAX_RETRIES})...`);
      registerPackageSystem(client, config);
      console.log("✅ Package system enabled (and commands registering inside it).");
      break;
    } catch (err) {
      console.error(`❌ Package system failed to start (attempt ${attempt}):`, err);
      if (attempt === MAX_RETRIES) {
        console.error("❌ Package system could not be started after retries.");
      } else {
        // small delay before retry
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  }

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
    // Each handler ignores interactions it doesn't care about
    await handleDashboardInteractions(client, interaction);
    await handleOrderHubInteractions(client, interaction);
    // tax commands handled in tax module
    // package system handles its own interactions internally
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

// ---------- Process guards (Railway-safe) ----------
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

// ✅ IMPORTANT: packageSystem.js currently reads DISCORD_TOKEN + CLIENT_ID.
// To guarantee commands register:
// - TOKEN = bot token (used here)
// - DISCORD_TOKEN = SAME bot token (used in packageSystem.js)
// - CLIENT_ID = your application id
if (!process.env.DISCORD_TOKEN) {
  console.warn("⚠️ Missing DISCORD_TOKEN env var. Set it equal to TOKEN so package commands register.");
}
if (!process.env.CLIENT_ID) {
  console.warn("⚠️ Missing CLIENT_ID env var. Slash commands will NOT register without it.");
}

client.login(process.env.TOKEN);
