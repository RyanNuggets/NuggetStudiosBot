// index.js
import { Client, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
import fs from "fs";

import { sendDashboard, handleDashboardInteractions } from "./Features/dashboard.js";
import registerWelcomeModule from "./Features/welcome.js";
import { sendOrderHub, handleOrderHubInteractions } from "./Features/orderhub.js";
import registerTaxModule from "./Features/tax.js";

// ✅ merged in from testing index.js (package system)
import registerPackageSystem, { packageCommands } from "./Features/packageSystem.js";

// ---------------- CONFIG (package system uses this) ----------------
const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));
const config = readConfig();

// ---------------- CLIENT ----------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // required for -tax + DM wizard replies
    GatewayIntentBits.GuildMembers,   // required for welcome module + role checks
    GatewayIntentBits.DirectMessages  // required for package DM wizard
  ],
  partials: [Partials.Channel]
});

// Toggle these to true only when you want to post the messages once.
// After they post, set back to false so they don't repost on every restart.
const POST_DASHBOARD_ON_START = true;
const POST_ORDERHUB_ON_START = true;

// ---------------- PACKAGE COMMAND REGISTRATION ----------------
async function registerCommands() {
  const token =
    process.env.DISCORD_TOKEN ||
    process.env.TOKEN ||
    config.token;

  const clientId =
    process.env.CLIENT_ID ||
    config.clientId;

  // ✅ guildId is inside config.packages.guildId in your config.json
  const guildId =
    process.env.GUILD_ID ||
    config.packages?.guildId;

  if (!token) throw new Error("Missing DISCORD_TOKEN/TOKEN (env) or token (config.json)");
  if (!clientId) throw new Error("Missing CLIENT_ID (env) or clientId (config.json)");
  if (!guildId) throw new Error("Missing GUILD_ID (env) or packages.guildId (config.json)");

  const rest = new REST({ version: "10" }).setToken(token);

  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: packageCommands }
  );

  console.log("✅ Slash commands registered to guild:", guildId);
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // ✅ Register feature modules (listeners + commands)
  registerWelcomeModule(client);
  registerTaxModule(client, { prefix: "-" });

  // ✅ merged: register package slash commands + listeners
  await registerCommands().catch((e) => {
    console.error("❌ Command registration failed:", e);
  });
  registerPackageSystem(client);

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

client.on("interactionCreate", async (interaction) => {
  try {
    // Each handler ignores interactions it doesn't care about
    await handleDashboardInteractions(client, interaction);
    await handleOrderHubInteractions(client, interaction);
    // tax commands are handled inside the tax module
    // package system handles its own listeners inside Features/packageSystem.js
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

if (!process.env.TOKEN && !process.env.DISCORD_TOKEN && !config.token) {
  console.error("❌ Missing TOKEN or DISCORD_TOKEN environment variable (Railway Variables).");
  process.exit(1);
}

client.login(process.env.TOKEN || process.env.DISCORD_TOKEN || config.token);
