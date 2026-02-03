// ./Features/price.cjs
const noblox = require("noblox.js");
const axios = require("axios");
const { EmbedBuilder } = require("discord.js");

// We register /price (guild command for instant updates)
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");

/**
 * registerPriceModule(client, agent, paymentConfig, config)
 * - client: discord.js Client
 * - agent: HttpsProxyAgent instance
 * - paymentConfig: config.price.payment
 * - config: full config.json (needed for guildId)
 */
function registerPriceModule(client, agent, paymentConfig, config) {
// ---------- Slash command registration (guild) ----------
client.once("ready", async () => {
  try {
    const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID;
    const guildId = config?.guildId;

    if (!token) {
      console.warn("⚠️ /price not registered: missing TOKEN (or DISCORD_TOKEN).");
      return;
    }
    if (!clientId) {
      console.warn("⚠️ /price not registered: missing CLIENT_ID.");
      return;
    }
    if (!guildId) {
      console.warn("⚠️ /price not registered: missing config.guildId.");
      return;
    }

    const rest = new REST({ version: "10" }).setToken(token);

    const priceCommand = {
      name: "price",
      description: "Update a Roblox collectible price (keeps item on sale)",
      options: [
        {
          name: "amount",
          description: "New price in Robux",
          type: 4, // INTEGER
          required: true
        },
        {
          name: "assetid",
          description: "Optional asset ID (defaults to config)",
          type: 3, // STRING
          required: false
        }
      ]
    };

    // ✅ Get current guild commands (so we don't overwrite package commands)
    const existing = await rest.get(Routes.applicationGuildCommands(clientId, guildId));

    const existingCmd = Array.isArray(existing)
      ? existing.find((c) => (c.name || "").toLowerCase() === "price")
      : null;

    if (existingCmd?.id) {
      // ✅ Update existing /price
      await rest.patch(Routes.applicationGuildCommand(clientId, guildId, existingCmd.id), {
        body: priceCommand
      });
      console.log("✅ /price slash command updated (guild) without overwriting other commands.");
    } else {
      // ✅ Create /price
      await rest.post(Routes.applicationGuildCommands(clientId, guildId), {
        body: priceCommand
      });
      console.log("✅ /price slash command created (guild) without overwriting other commands.");
    }
  } catch (err) {
    console.error("❌ Failed to upsert /price command:", err?.message || err);
  }
});

  // ---------- Interaction handler (same logic as your message command) ----------
  client.on("interactionCreate", async (interaction) => {
    try {
      if (!interaction.isChatInputCommand?.()) return;
      if ((interaction.commandName || "").toLowerCase() !== "price") return;

      // Permission Check
      if (!interaction.member?.roles?.cache?.has(paymentConfig.allowedRoleId)) {
        return interaction.reply({
          content: "❌ You do not have permission to change prices.",
          ephemeral: true
        });
      }

      // Defaults from config
      let assetId = paymentConfig.assetId;

      // Slash options
      const optAssetId = interaction.options.getString("assetid");
      const optAmount = interaction.options.getInteger("amount");

      if (optAssetId) assetId = optAssetId;

      let newPrice = parseInt(optAmount, 10);

      if (!assetId || isNaN(parseInt(assetId, 10)) || isNaN(newPrice)) {
        return interaction.reply({
          content: "❌ **Usage:** `/price amount:<Amount>` or `/price assetid:<AssetID> amount:<Amount>`",
          ephemeral: true
        });
      }

      await interaction.reply("⏳ Routing through Proxy & Fetching CSRF...");

      try {
        const cookie = process.env.ROBLOX_COOKIE;
        if (!cookie) throw new Error("Missing ROBLOX_COOKIE env var.");

        const baseHeaders = {
          Cookie: `.ROBLOSECURITY=${cookie}`,
          "Content-Type": "application/json",
          Origin: "https://create.roblox.com",
          Referer: "https://create.roblox.com/"
        };

        // 1) GET CSRF TOKEN (Roblox returns 403 + token header)
        let csrfToken;
        try {
          await axios.post("https://auth.roblox.com/v2/logout", {}, { headers: baseHeaders, httpsAgent: agent });
        } catch (err) {
          csrfToken =
            err.response?.headers?.["x-csrf-token"] ||
            err.response?.headers?.["X-CSRF-TOKEN"] ||
            err.response?.headers?.["x-csrf-token".toLowerCase()];
        }

        if (!csrfToken) throw new Error("Roblox rejected the Proxy/Cookie combo. No CSRF token returned.");

        await interaction.editReply("⏳ Fetching item details & collectible UUID...");

        // 2) FETCH COLLECTIBLE UUID + NAME
        const itemDetails = await axios.post(
          "https://catalog.roblox.com/v1/catalog/items/details",
          { items: [{ itemType: "Asset", id: parseInt(assetId, 10) }] },
          {
            headers: { ...baseHeaders, "X-CSRF-TOKEN": csrfToken },
            httpsAgent: agent
          }
        );

        const item = itemDetails.data?.data?.[0];
        const collectibleId = item?.collectibleItemId;
        const itemName = item?.name || "Collectible Item";

        if (!collectibleId) throw new Error("This Asset ID is not a Collectible item.");

        await interaction.editReply("⏳ Updating price (forcing On Sale)...");

        // 3) UPDATE THE PRICE (PATCH collectible config)
        const updateUrl = `https://itemconfiguration.roblox.com/v1/collectibles/${collectibleId}`;

        await axios.patch(
          updateUrl,
          {
            isFree: false,
            priceInRobux: newPrice,
            priceOffset: 0,

            // Keep expected defaults to prevent Roblox from "resetting" fields
            quantityLimitPerUser: 0,
            resaleRestriction: 2,
            saleLocationConfiguration: {
              places: [],
              saleLocationType: 1
            },

            // IMPORTANT: 0 = OnSale, 1 = OffSale
            saleStatus: 0
          },
          {
            headers: { ...baseHeaders, "X-CSRF-TOKEN": csrfToken },
            httpsAgent: agent
          }
        );

        // 4) SUCCESS EMBED
        const embed = new EmbedBuilder()
          .setTitle("✅ Price Updated Successfully")
          .setDescription(`**${itemName}** has been updated and kept **On Sale**.`)
          .addFields(
            { name: "New Price", value: `${newPrice} Robux`, inline: true },
            { name: "Asset ID", value: `${assetId}`, inline: true }
          )
          .setColor("#00FF00")
          .setTimestamp();

        await interaction.editReply({ content: null, embeds: [embed] });
      } catch (err) {
        console.error("Price Update Error:", err.response?.data || err.message);

        const robloxError =
          err.response?.data?.errors?.[0]?.message ||
          err.response?.data?.message ||
          err.message;

        await interaction.editReply(`❌ **Update Failed:** ${robloxError}`);
      }
    } catch (err) {
      console.error("❌ /price interaction error:", err);
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
}

module.exports = registerPriceModule;
