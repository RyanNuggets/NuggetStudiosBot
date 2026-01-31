import { Client, GatewayIntentBits, Partials } from "discord.js";
import { sendDashboard, handleDashboardInteractions } from "./Features/dashboard.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// Toggle this to true only when you want to post the dashboard message.
// After it posts, set back to false so it doesn't repost on every restart.
const POST_DASHBOARD_ON_START = false;

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  if (POST_DASHBOARD_ON_START) {
    try {
      await sendDashboard(client);
    } catch (err) {
      console.error("❌ Failed to send dashboard:", err);
    }
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    await handleDashboardInteractions(client, interaction);
  } catch (err) {
    console.error("❌ interactionCreate error:", err);

    // Don't crash the bot; try to respond if possible
    if (interaction.isRepliable()) {
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
