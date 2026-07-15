// Features/packageSystem/Commands/package.js
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { listPackages, findPackageByName, updatePackage, deletePackageByName } from "../Models/packageStore.js";
import { saveDraft } from "../Utils/Packages/packageDraftStore.js";
import { storePackageFile, deleteStoredPackageFile } from "../Utils/Packages/packageFileStore.js";
import {
  sanitizePackageDraft,
  buildPreviewEmbed,
  buildPublicPackageEmbed,
  extractAssetId,
  PACKAGE_COLOR,
  PACKAGE_ATTENTION_COLOR,
} from "../Utils/Packages/packageUtils.js";

function packageEmbedFromDocument(pkg) {
  return buildPublicPackageEmbed({
    name: pkg.name,
    purchaselink: pkg.purchaselink,
    packerId: pkg.packerId,
    price: pkg.price,
    assetId: pkg.assetId,
    items: pkg.items,
  });
}

// `cfg` = config.json's `packages` block, injected by the package system's index.js
export default function buildPackageCommand(cfg) {
  const requiredRoleId = cfg.staffRoleId;
  const forumChannelId = cfg.publishForumChannelId;

  return {
    data: new SlashCommandBuilder()
      .setName("package")
      .setDescription("Manage package drafts, publishing, and catalog cleanup.")
      .addSubcommand((sub) =>
        sub.setName("create").setDescription("Start a new package draft with an editable preview.")
      )
      .addSubcommand((sub) =>
        sub
          .setName("send")
          .setDescription("Publish a saved package to the forum channel.")
          .addStringOption((option) =>
            option.setName("package").setDescription("Select the package to publish.").setRequired(true).setAutocomplete(true)
          )
          .addAttachmentOption((option) =>
            option.setName("image").setDescription("Preview image for the forum post.").setRequired(true)
          )
          .addAttachmentOption((option) =>
            option.setName("file").setDescription("Downloadable file that will be DMed after claiming.").setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("delete")
          .setDescription("Remove a saved package from the catalog.")
          .addStringOption((option) =>
            option.setName("package").setDescription("Select the package to delete.").setRequired(true).setAutocomplete(true)
          )
      )
      .addSubcommand((sub) => sub.setName("list").setDescription("Show a snapshot of recently updated packages.")),

    async autocomplete(interaction) {
      const subcommand = interaction.options.getSubcommand();
      if (!["send", "delete"].includes(subcommand)) return;

      const focused = interaction.options.getFocused(true);
      if (focused.name !== "package") return;

      const query = focused.value?.toLowerCase() ?? "";
      const packages = (await listPackages()).slice(0, 25);

      const filtered = packages
        .filter((pkg) => pkg.name.toLowerCase().includes(query))
        .slice(0, 25)
        .map((pkg) => ({ name: pkg.name, value: pkg.name }));

      await interaction.respond(filtered);
    },

    async execute(interaction) {
      if (requiredRoleId && !interaction.member.roles.cache.has(requiredRoleId)) {
        return interaction.reply({
          content: "You don't have permission to use this command.",
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === "create") {
        const previewDraft = sanitizePackageDraft({ name: "", purchaselink: "", packer: "", price: "", items: "" });
        saveDraft(interaction.user.id, previewDraft);

        const previewEmbed = buildPreviewEmbed(previewDraft);

        const editButton = new ButtonBuilder().setCustomId("editPackage").setLabel("Edit").setStyle(ButtonStyle.Secondary);
        const submitButton = new ButtonBuilder()
          .setCustomId("submitPackage")
          .setLabel("Submit")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(previewDraft.issues.length > 0);

        const buttons = new ActionRowBuilder().addComponents(editButton, submitButton);

        return interaction.editReply({
          content: "Use **Edit** to fill in the details. Submit unlocks once the preview shows no outstanding items.",
          embeds: [previewEmbed],
          components: [buttons],
        });
      }

      if (subcommand === "send") {
        const packageName = interaction.options.getString("package");
        const image = interaction.options.getAttachment("image");
        const file = interaction.options.getAttachment("file");

        let packageData = await findPackageByName(packageName);
        if (!packageData) {
          const notFoundEmbed = new EmbedBuilder()
            .setColor(PACKAGE_ATTENTION_COLOR)
            .setTitle("Package Not Found")
            .setDescription(`No saved package named **${packageName}**.`);

          return interaction.editReply({ embeds: [notFoundEmbed] });
        }

        if (!packageData.assetId) {
          packageData = await updatePackage(packageData.name, {
            assetId: extractAssetId(packageData.purchaselink),
          });
        }

        if (!forumChannelId) {
          const missingCfgEmbed = new EmbedBuilder()
            .setColor(PACKAGE_ATTENTION_COLOR)
            .setTitle("Missing Configuration")
            .setDescription("`packages.publishForumChannelId` is not set in config.json.");
          return interaction.editReply({ embeds: [missingCfgEmbed] });
        }

        let storedDownloadFile;
        try {
          storedDownloadFile = await storePackageFile({
            packageName: packageData.name,
            sourceUrl: file.url,
            originalName: file.name,
          });
        } catch (error) {
          console.error("Failed to store package file:", error);

          const storageErrorEmbed = new EmbedBuilder()
            .setColor(PACKAGE_ATTENTION_COLOR)
            .setTitle("File Download Failed")
            .setDescription("I couldn't download and store that package file. Please re-upload the file and try again.");

          return interaction.editReply({ embeds: [storageErrorEmbed] });
        }

        const previousLocalPath = packageData.downloadFile?.localPath;

        const forum = await interaction.client.channels.fetch(forumChannelId);
        const thread = await forum.threads.create({
          name: packageData.name,
          message: { files: [image.url] },
        });

        const publicEmbed = packageEmbedFromDocument(packageData);

        const packageButton = new ButtonBuilder().setLabel("Claim Package").setStyle(ButtonStyle.Secondary).setCustomId("claimPackage");
        const row = new ActionRowBuilder().addComponents(packageButton);

        const sentMessage = await thread.send({ embeds: [publicEmbed], components: [row] });

        packageData = await updatePackage(packageData.name, {
          messageId: sentMessage.id,
          downloadFile: {
            url: file.url,
            name: storedDownloadFile.name,
            localPath: storedDownloadFile.localPath,
            storedName: storedDownloadFile.storedName,
            size: storedDownloadFile.size,
            mimeType: storedDownloadFile.mimeType,
          },
        });

        if (previousLocalPath && previousLocalPath !== storedDownloadFile.localPath) {
          try {
            await deleteStoredPackageFile(previousLocalPath);
          } catch (error) {
            console.error("Failed to delete previous package file:", error);
          }
        }

        const publishEmbed = packageEmbedFromDocument(packageData)
          .setTitle(`${packageData.name} Published`)
          .setDescription(
            [`Posted in ${forum}.`, thread?.url ? `[Open the forum thread](${thread.url})` : null].filter(Boolean).join("\n\n")
          )
          .setFooter({ text: "The claim button is live. Files will be delivered automatically." });

        return interaction.editReply({ embeds: [publishEmbed] });
      }

      if (subcommand === "delete") {
        const packageName = interaction.options.getString("package");
        const deleted = await deletePackageByName(packageName);

        if (!deleted) {
          const notFoundEmbed = new EmbedBuilder()
            .setColor(PACKAGE_ATTENTION_COLOR)
            .setTitle("Package Not Found")
            .setDescription(`No saved package named **${packageName}**.`);

          return interaction.editReply({ embeds: [notFoundEmbed] });
        }

        const deleteEmbed = new EmbedBuilder()
          .setColor(PACKAGE_ATTENTION_COLOR)
          .setTitle("Package Removed")
          .setDescription(`**${packageName}** has been removed from the catalog.`);

        return interaction.editReply({ embeds: [deleteEmbed] });
      }

      if (subcommand === "list") {
        const packages = await listPackages();
        if (!packages.length) {
          return interaction.editReply({ content: "No packages are currently saved." });
        }

        const limited = packages.slice(0, 10);
        const lines = limited.map((pkg, index) => {
          const rank = index + 1;
          const title = pkg.purchaselink ? `[${pkg.name}](${pkg.purchaselink})` : pkg.name;
          const packer = pkg.packerId ? `<@${pkg.packerId}>` : "N/A";
          const asset = pkg.assetId ? `\`${pkg.assetId}\`` : "N/A";
          return `**${rank}. ${title}**\nPrice: ${pkg.price} | Packer: ${packer}\nAsset ID: ${asset}`;
        });

        const listEmbed = new EmbedBuilder()
          .setTitle(`Available Packages (${packages.length})`)
          .setColor(PACKAGE_COLOR)
          .setDescription(lines.join("\n\n"));

        const footerText =
          limited.length < packages.length
            ? `Showing ${limited.length} of ${packages.length} packages. Run /package list again for the latest snapshot.`
            : "Use /package send <name> to publish a package to the forum.";

        listEmbed.setFooter({ text: footerText });

        return interaction.editReply({ embeds: [listEmbed] });
      }
    },
  };
}
