// index.js
import { Client, GatewayIntentBits, Partials } from "discord.js";

import { sendDashboard, handleDashboardInteractions } from "./Features/dashboard.js";
import registerWelcomeModule from "./Features/welcome.js";
import { sendOrderHub, handleOrderHubInteractions } from "./Features/orderhub.js";
import registerTaxModule from "./Features/tax.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // required for "-tax 100"
    GatewayIntentBits.GuildMembers // required for welcome
  ],
  partials: [Partials.Channel]
});

// Toggle these to true only when you want to post the messages once.
// After they post, set back to false so they don't repost on every restart.
const POST_DASHBOARD_ON_START = false;
const POST_ORDERHUB_ON_START = true;

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // ✅ Register feature modules (event listeners + slash upserts)
  registerWelcomeModule(client);
  registerTaxModule(client);

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
    // Run both handlers (each one ignores interactions it doesn't care about)
    await handleDashboardInteractions(client, interaction);
    await handleOrderHubInteractions(client, interaction);
    // /tax is handled inside registerTaxModule via its own interactionCreate listener
  } catch (err) {
    console.error("❌ interactionCreate error:", err);

    // Don't crash the bot; try to respond if possible
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

// Basic process guards so Railway logs show what killed it (if anything)
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

client.login(process.env.TOKEN);
