// Features/packageSystem/Buttons/submitPackage.js
import { MessageFlags } from "discord.js";
import { findPackage, createPackage } from "../Models/packageStore.js";
import { fetchDraft, deleteDraft } from "../Utils/Packages/packageDraftStore.js";
import {
  sanitizePackageDraft,
  buildPublicPackageEmbed,
  buildPreviewEmbed,
  PACKAGE_ATTENTION_COLOR,
} from "../Utils/Packages/packageUtils.js";

export default {
  customID: "submitPackage",
  async execute(interaction) {
    const { draft: cachedDraft, expired } = fetchDraft(interaction.user.id);
    if (!cachedDraft) {
      const content = expired
        ? "Your package draft expired after 10 minutes of inactivity. Use **Edit** to start a fresh draft."
        : "No package draft was found. Tap **Edit** to start again.";
      return await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }

    const draft = sanitizePackageDraft(cachedDraft.raw ?? cachedDraft);

    if (draft.issues.length) {
      const attentionEmbed = buildPreviewEmbed(draft);
      const pendingTitle = draft.name ? `${draft.name} - Pending Updates` : "Package Draft - Pending Updates";
      attentionEmbed.setTitle(pendingTitle);

      return await interaction.reply({
        content: "The draft still needs the following before it can be saved:",
        embeds: [attentionEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }

    const duplicate = await findPackage((p) => p.name === draft.name || p.assetId === draft.assetId);

    if (duplicate) {
      const duplicateEmbed = buildPublicPackageEmbed({
        name: duplicate.name,
        purchaselink: duplicate.purchaselink,
        packerId: duplicate.packerId,
        price: duplicate.price,
        assetId: duplicate.assetId,
        items: duplicate.items,
      })
        .setColor(PACKAGE_ATTENTION_COLOR)
        .setTitle("Duplicate Package Detected")
        .setDescription(
          [`**${duplicate.name}** already uses this name or asset ID.`, "Edit your draft with unique details, or retire the existing package first."].join(
            "\n\n"
          )
        );

      return await interaction.reply({ embeds: [duplicateEmbed], flags: MessageFlags.Ephemeral });
    }

    try {
      const created = await createPackage({
        name: draft.name,
        purchaselink: draft.purchaselink,
        assetId: draft.assetId,
        packerId: draft.packerId,
        price: draft.price,
        items: draft.items,
      });

      deleteDraft(interaction.user.id);

      const savedEmbed = buildPublicPackageEmbed({
        name: created.name,
        purchaselink: created.purchaselink,
        packerId: created.packerId,
        price: created.price,
        assetId: created.assetId,
        items: created.items,
      })
        .setTitle(`${created.name} Saved`)
        .setDescription("The package is ready to go live. Run `/package send` when you want to publish it to the forum.");

      await interaction.reply({
        content: "Package saved successfully.",
        embeds: [savedEmbed],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error("Error submitting package:", error);
      await interaction.reply({
        content: "Saving the package failed unexpectedly. Try again shortly or contact an administrator.",
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
