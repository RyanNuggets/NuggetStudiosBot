// Features/packageSystem/index.js
//
// File-store-backed, Bloxlink-verified package system.
//
// Requires:
//   - env DATA_DIR               (path to a Railway volume mount - see Features/Shared/jsonStore.js)
//   - env BLOXLINK_API_KEY       (Roblox <-> Discord linking via Bloxlink's Server API)
//   - config.json -> packages.staffRoleId
//   - config.json -> packages.forums.{clothing,liveries,graphics}  (three Forum channels)
//
import { Routes } from "discord-api-types/v10";
import { MessageFlags } from "discord.js";

import buildPackageCommand from "./Commands/package.js";
import editPackageButton from "./Buttons/editPackage.js";
import submitPackageButton from "./Buttons/submitPackage.js";
import claimPackageButton from "./Buttons/claimPackage.js";
import editPackageModal from "./Modals/editPackageModal.js";

export function registerPackageSystem(client, config) {
  const cfg = config?.packages;
  const guildId = config?.guildId;

  if (!guildId) throw new Error("Missing top-level `guildId` in config.json");
  if (!cfg) throw new Error("Missing `packages` block in config.json");

  const CATEGORY_KEYS = ["clothing", "liveries", "graphics"];
  for (const key of CATEGORY_KEYS) {
    if (!cfg.forums?.[key]) {
      console.warn(
        `⚠️ [packageSystem] \`packages.forums.${key}\` is not set - sending ${key} packages will fail until it is.`
      );
    }
  }

  const packageCommand = buildPackageCommand(cfg);

  const buttons = new Map(
    [editPackageButton, submitPackageButton, claimPackageButton].map((b) => [b.customID, b])
  );
  const modals = new Map([editPackageModal].map((m) => [m.customID, m]));

  client.once("ready", async () => {
    try {
      const appId = client.application?.id;
      if (!appId) throw new Error("Missing client.application.id");

      // POST (not PUT) so this upserts /package without wiping other guild
      // commands (e.g. /order) registered elsewhere.
      await client.rest.post(Routes.applicationGuildCommands(appId, guildId), {
        body: packageCommand.data.toJSON(),
      });
      console.log("✅ [packageSystem] /package slash command registered.");
    } catch (err) {
      console.error("❌ [packageSystem] Failed to register /package:", err);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === "package") {
        await packageCommand.execute(interaction);
        return;
      }

      if (interaction.isAutocomplete() && interaction.commandName === "package") {
        await packageCommand.autocomplete(interaction);
        return;
      }

      if (interaction.isButton() && buttons.has(interaction.customId)) {
        await buttons.get(interaction.customId).execute(interaction, client);
        return;
      }

      if (interaction.isModalSubmit() && modals.has(interaction.customId)) {
        await modals.get(interaction.customId).execute(interaction, client);
        return;
      }
    } catch (err) {
      console.error("❌ [packageSystem] interactionCreate error:", err);
      if (!interaction?.isRepliable?.()) return;
      try {
        const payload = { content: "Something went wrong with the package system.", flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch {}
    }
  });
}
