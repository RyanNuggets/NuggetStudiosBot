// /Features/tax.js
import { Routes } from "discord-api-types/v10";
import { ApplicationCommandOptionType } from "discord.js";
import fs from "fs";

// ---------------- CONFIG ----------------
const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));

const PREFIX_DEFAULT = "-";

// ---------------- HELPERS ----------------
function parseAmount(input) {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (!s) return null;

  // allow "100", "100.5" (we'll round)
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;

  // robux should be integer
  return Math.round(n);
}

function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

function buildTaxEmbed(amount) {
  const beforeTax = Math.round(amount * 0.7); // amount - 30%
  const afterTax = Math.round(amount * 1.3);  // amount + 30%

  return {
    embeds: [
      {
        fields: [
          {
            name: "Amount:",
            value: `> ${fmt(amount)}`,
            inline: true
          },
          {
            name: "Robux Before Tax:",
            value: `> ${fmt(beforeTax)}`,
            inline: true
          },
          {
            name: "Robux After Tax",
            value: `> ${fmt(afterTax)}`,
            inline: true
          },
          {
            name: "",
            value: ""
          }
        ]
      }
    ],
    components: []
  };
}

// ---------------- SLASH COMMAND REGISTRATION ----------------
async function registerSlashTax(client) {
  const conf = readConfig();

  // needs guildId in config.json (top-level)
  const guildId = conf.guildId;
  if (!guildId) {
    console.warn("⚠️ [TAX] Missing `guildId` in config.json (top-level). Slash command not registered.");
    return;
  }

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
    // Upsert as a single guild command (fast to appear)
    await client.rest.put(Routes.applicationGuildCommands(appId, guildId), {
      body: [command]
    });

    console.log("✅ [TAX] Slash command registered: /tax");
  } catch (err) {
    console.error("❌ [TAX] Failed to register slash command:", err);
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

async function handleTaxPrefix(message) {
  if (!message || message.author?.bot) return false;

  const conf = readConfig();
  const prefix = conf?.commands?.prefix ?? PREFIX_DEFAULT;

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

// ---------------- EXPORT (REGISTER MODULE) ----------------
export default function registerTaxModule(client) {
  // register slash on ready
  client.once("ready", async () => {
    try {
      await registerSlashTax(client);
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
      await handleTaxPrefix(message);
    } catch (e) {
      console.error("❌ [TAX] message error:", e);
    }
  });

  console.log("✅ Tax module registered");
}
