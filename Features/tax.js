// /Features/tax.js
import { Routes } from "discord-api-types/v10";
import { ApplicationCommandOptionType } from "discord.js";

// ---------------- HELPERS ----------------
function parseAmount(input) {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (!s) return null;

  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;

  // Robux should be an integer
  return Math.round(n);
}

function buildTaxEmbed(amount) {
  // amount = how much you want to RECEIVE (payout)
  const payoutWanted = amount;

  // Roblox takes 30%, so you keep 70%
  const priceToSet = Math.ceil(payoutWanted / 0.7);

  // What you'll actually receive after rounding
  const actualPayout = Math.floor(priceToSet * 0.7);

  return {
    embeds: [
      {
        description:
          `**Desired Payout (You Receive):**\n` +
          `> ${payoutWanted.toLocaleString("en-US")}\n\n` +
          `**Price To Set (So You Receive That):**\n` +
          `> ${priceToSet.toLocaleString("en-US")}\n\n` +
          `**Actual Payout At That Price:**\n` +
          `> ${actualPayout.toLocaleString("en-US")}\n`
      }
    ],
    components: []
  };
}

// ---------------- SLASH COMMAND REGISTRATION (OPTION A: GLOBAL) ----------------
async function registerSlashTaxGlobal(client) {
  const appId = client.application?.id;
  if (!appId) {
    console.warn("⚠️ [TAX] Missing application id. Slash command not registered.");
    return;
  }

  const command = {
    name: "tax",
    description: "Calculate robux tax (+30% / -30%)",
    options: [
      {
        name: "amount",
        description: "Robux amount",
        type: ApplicationCommandOptionType.Integer,
        required: true,
        min_value: 1
      }
    ]
  };

  try {
    // ✅ Global commands (won't get overwritten by other modules)
    // NOTE: Global commands can take a bit to appear in Discord.
    await client.rest.post(Routes.applicationCommands(appId), { body: command });
    console.log("✅ [TAX] Global slash command upserted: /tax");
  } catch (err) {
    console.error("❌ [TAX] Failed to register global slash command:", err);
  }
}

// ---------------- HANDLERS ----------------
async function handleTaxSlash(interaction) {
  if (!interaction.isChatInputCommand?.()) return false;
  if (interaction.commandName !== "tax") return false;

  const amountRaw = interaction.options.getInteger("amount", true);
  const amount = parseAmount(amountRaw);

  if (!amount) {
    await interaction.reply({ content: "Invalid amount.", ephemeral: true }).catch(() => {});
    return true;
  }

  await interaction.reply(buildTaxEmbed(amount)).catch(() => {});
  return true;
}

async function handleTaxPrefix(message, prefix = "-") {
  if (!message || message.author?.bot) return false;

  const content = String(message.content ?? "").trim();
  if (!content.toLowerCase().startsWith(`${prefix}tax`)) return false;

  const parts = content.split(/\s+/);
  const amount = parseAmount(parts[1]);

  if (!amount) {
    await message.reply(`Usage: \`${prefix}tax 100\``).catch(() => {});
    return true;
  }

  await message.reply(buildTaxEmbed(amount)).catch(() => {});
  return true;
}

// ---------------- EXPORT ----------------
export default function registerTaxModule(client, { prefix = "-" } = {}) {
  // register slash on ready
  client.once("ready", async () => {
    try {
      await registerSlashTaxGlobal(client);
    } catch (e) {
      console.error("❌ [TAX] register error:", e);
    }
  });

  // listen for slash interactions
  client.on("interactionCreate", async (interaction) => {
    try {
      await handleTaxSlash(interaction);
    } catch (e) {
      console.error("❌ [TAX] interaction error:", e);
      if (interaction?.isRepliable?.()) {
        const payload = { content: "Something went wrong.", ephemeral: true };
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
      }
    }
  });

  // listen for prefix commands
  client.on("messageCreate", async (message) => {
    try {
      await handleTaxPrefix(message, prefix);
    } catch (e) {
      console.error("❌ [TAX] message error:", e);
    }
  });

  console.log("✅ Tax module registered");
}
