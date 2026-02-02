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
client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // ✅ Register feature modules (listeners + commands)
  registerWelcomeModule(client);
  registerTaxModule(client, { prefix: "-" });

  // ✅ Register package system (includes slash command registration internally)
  try {
    registerPackageSystem(client, config);
    console.log("✅ Package system enabled");
  } catch (err) {
    console.error("❌ Package system failed to start:", err);
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

// Package system also needs CLIENT_ID + DISCORD_TOKEN (it currently reads DISCORD_TOKEN)
// ✅ easiest fix: set BOTH env vars to the same token in Railway:
// - TOKEN = your bot token (used here)
// - DISCORD_TOKEN = your bot token (used in packageSystem.js)
// - CLIENT_ID = your application client id
client.login(process.env.TOKEN);
