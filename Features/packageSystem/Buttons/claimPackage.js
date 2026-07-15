// Features/packageSystem/Buttons/claimPackage.js
import { MessageFlags } from "discord.js";
import { getRobloxInfo } from "../../Shared/Docksys.js";
import { findPackageByMessageId, updatePackage } from "../Models/packageStore.js";
import { buildPublicPackageEmbed, PACKAGE_ATTENTION_COLOR } from "../Utils/Packages/packageUtils.js";
import { storePackageFile, storedPackageFileExists, toAbsolutePath } from "../Utils/Packages/packageFileStore.js";

// Docksys API key - was hardcoded in the original script; moved to env for safety.
// Set DOCKSYS_API_KEY in your environment (get it from https://docksys.xyz/account).
// Your server also needs the Docksys bot present for account linking to work.
const DOCK_API = process.env.DOCKSYS_API_KEY;

function packageSummaryEmbed(packageData) {
  return buildPublicPackageEmbed({
    name: packageData.name,
    purchaselink: packageData.purchaselink,
    packerId: packageData.packerId,
    price: packageData.price,
    assetId: packageData.assetId,
    items: packageData.items,
  });
}

async function userHasAsset(robloxId, assetId) {
  try {
    const res = await fetch(`https://inventory.roblox.com/v1/users/${robloxId}/items/0/${assetId}/is-owned`);

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const data = await res.json();
    return data === true;
  } catch (err) {
    console.error("Error checking Roblox inventory:", err.message);
    return false;
  }
}

export default {
  customID: "claimPackage",

  async execute(interaction, client) {
    if (!DOCK_API) {
      return interaction.reply({
        content: "⚠️ Package claims are misconfigured: missing `DOCKSYS_API_KEY` environment variable.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const message = interaction.message;
    if (!message) {
      await interaction.reply({
        content: "I couldn't locate the original package message.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let packageData = await findPackageByMessageId(message.id);
    if (!packageData) {
      await interaction.reply({
        content: "That package is no longer available.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existingClaim = packageData.claims?.find((claim) => claim.userId === interaction.user.id) ?? null;

    if (existingClaim) {
      const dmLink =
        existingClaim.dmChannelId && existingClaim.dmMessageId
          ? `https://discord.com/channels/@me/${existingClaim.dmChannelId}/${existingClaim.dmMessageId}`
          : null;

      const alreadyEmbed = packageSummaryEmbed(packageData)
        .setColor(PACKAGE_ATTENTION_COLOR)
        .setTitle(`${packageData.name} Already Delivered`)
        .setDescription(
          ["You've already received this download.", dmLink ? `[Open your original DM delivery](${dmLink})` : "Check your DMs for the original delivery."].join(
            "\n\n"
          )
        )
        .setFooter({ text: "Need it resent? Contact a staff member." });

      await interaction.reply({ embeds: [alreadyEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const robloxId = await getRobloxInfo(interaction.user.id, interaction, DOCK_API);
    if (!robloxId) {
      return interaction.editReply({
        content: "> Please link your Roblox account to your Discord account [**here**](https://api.docksys.xyz/v1/api/verify/discord) and then try again.",
      });
    }

    const assetId = packageData.assetId;
    if (!assetId) {
      const assetEmbed = packageSummaryEmbed(packageData)
        .setColor(PACKAGE_ATTENTION_COLOR)
        .setTitle("Asset ID Missing")
        .setDescription("This package doesn't list a Roblox asset ID yet. Please let staff know so they can update it.");

      await interaction.editReply({ embeds: [assetEmbed] });
      return;
    }

    const ownsPackage = await userHasAsset(robloxId, assetId);
    if (!ownsPackage) {
      const ownershipEmbed = packageSummaryEmbed(packageData)
        .setColor(PACKAGE_ATTENTION_COLOR)
        .setTitle("Ownership Not Verified")
        .setDescription(
          ["We couldn't confirm the item in your Roblox inventory.", "Make sure the purchase succeeded and your inventory privacy allows verification."].join(
            "\n\n"
          )
        );

      await interaction.editReply({ embeds: [ownershipEmbed] });
      return;
    }

    const currentDownloadFile = { ...(packageData.downloadFile || {}) };

    let downloadFile = currentDownloadFile;
    let hasStoredFile = await storedPackageFileExists(downloadFile.localPath);

    if (!hasStoredFile && downloadFile.url) {
      try {
        const stored = await storePackageFile({
          packageName: packageData.name,
          sourceUrl: downloadFile.url,
          originalName: downloadFile.name,
        });

        downloadFile = { ...downloadFile, ...stored, name: stored.name || downloadFile.name };

        packageData = await updatePackage(packageData.name, { downloadFile });
        hasStoredFile = true;
      } catch (error) {
        console.error("Failed to backfill package file for claim:", error);
      }
    }

    if (!hasStoredFile) {
      const missingFileEmbed = packageSummaryEmbed(packageData)
        .setColor(PACKAGE_ATTENTION_COLOR)
        .setTitle("Download Missing")
        .setDescription("This package file is not available for delivery yet. Please contact staff to resolve it.");

      await interaction.editReply({ embeds: [missingFileEmbed] });
      return;
    }

    const downloadFilePath = toAbsolutePath(downloadFile.localPath);
    const downloadFileName = downloadFile.name || downloadFile.storedName || `${packageData.name}-download`;

    const deliveryEmbed = packageSummaryEmbed(packageData)
      .setTitle(`${packageData.name} Delivered`)
      .setDescription(
        [
          `Thank you for purchasing **${packageData.name}**.`,
          packageData.purchaselink ? `[Revisit the Roblox listing](${packageData.purchaselink})` : null,
          "Your package download is attached to this DM.",
        ]
          .filter(Boolean)
          .join("\n\n")
      )
      .setFooter({ text: "Questions about the files? Reach out to support." });

    try {
      const dmMessage = await interaction.user.send({
        embeds: [deliveryEmbed],
        files: [{ attachment: downloadFilePath, name: downloadFileName }],
      });

      packageData.claims = packageData.claims ?? [];
      packageData.claims.push({
        userId: interaction.user.id,
        dmChannelId: dmMessage.channel.id,
        dmMessageId: dmMessage.id,
        claimedAt: new Date().toISOString(),
      });
      await updatePackage(packageData.name, { claims: packageData.claims });

      await interaction.editReply({ content: "Check your DMs - your package file has been delivered." });
    } catch {
      const dmFailureEmbed = packageSummaryEmbed(packageData)
        .setColor(PACKAGE_ATTENTION_COLOR)
        .setTitle("DM Delivery Failed")
        .setDescription("I couldn't open a DM with you. Enable direct messages for this server and try claiming again.");

      await interaction.editReply({ embeds: [dmFailureEmbed] });
    }
  },
};
