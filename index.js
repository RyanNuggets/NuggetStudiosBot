// index.js
import { Client, GatewayIntentBits, Partials } from "discord.js";
import fs from "fs";

// Existing modules (keep as-is)
import { sendDashboard, handleDashboardInteractions } from "./Features/dashboard.js";
import registerWelcomeModule from "./Features/welcome.js";
import { sendOrderHub, handleOrderHubInteractions } from "./Features/orderhub.js";
import registerTaxModule from "./Features/tax.js";

// ✅ Package system
import { registerPackageSystem } from "./Features/packageSystem.js";

// ✅ Purchase monitor + /payment command (CommonJS modules)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const purchaseMonitor = require("./purchasemonitor.js");
const paymentCommand = require("./payment.js"); // make sure you created payment.js

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

  // ---------------- Purchasemonitor index logic (ADDED) ----------------
  // ✅ Register /payment command (guild-only for fast updates)
  try {
    const { REST, Routes } = await import("discord.js");

    if (!process.env.CLIENT_ID || !config.guildId) {
      console.log("[WARN] CLIENT_ID or config.guildId missing. Skipping /payment registration.");
    } else {
      const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, config.guildId), {
        body: [paymentCommand.data.toJSON()]
      });

      console.log("✅ /payment command registered.");
    }
  } catch (err) {
    console.error("❌ Failed to register /payment command:", err);
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
    // ✅ Handle /payment command (from purchasemonitor index)
    if (interaction.isChatInputCommand() && interaction.commandName === "payment") {
      try {
        await paymentCommand.execute(interaction);
      } catch (err) {
        console.error("❌ /payment command error:", err);
        if (!interaction.replied && interaction.isRepliable()) {
          await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true }).catch(() => {});
        }
      }
      return;
    }

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
