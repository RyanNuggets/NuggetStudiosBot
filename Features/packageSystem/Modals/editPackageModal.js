// Features/packageSystem/Modals/editPackageModal.js
import { ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } from "discord.js";
import { saveDraft, fetchDraft } from "../Utils/Packages/packageDraftStore.js";
import { sanitizePackageDraft, buildPreviewEmbed } from "../Utils/Packages/packageUtils.js";

export default {
  customID: "editPackageModal",
  async execute(interaction) {
    const { draft: previousDraft } = fetchDraft(interaction.user.id);

    const readText = (customId, fallbackKey) => {
      try {
        return interaction.fields.getTextInputValue(customId) ?? "";
      } catch {
        if (previousDraft?.raw && fallbackKey in previousDraft.raw) {
          return previousDraft.raw[fallbackKey] ?? "";
        }
        if (previousDraft && fallbackKey in previousDraft) {
          return previousDraft[fallbackKey] ?? "";
        }
        return "";
      }
    };

    const readUserSelect = (customId, fallbackKey) => {
      try {
        const selected = interaction.fields.getSelectedUsers(customId);
        if (selected && selected.size > 0) {
          return selected.first().id;
        }
      } catch {}

      if (previousDraft?.raw && fallbackKey in previousDraft.raw) {
        return previousDraft.raw[fallbackKey] ?? "";
      }
      if (previousDraft && fallbackKey in previousDraft) {
        return previousDraft[fallbackKey] ?? "";
      }
      return "";
    };

    const draft = sanitizePackageDraft({
      name: readText("packagename", "name"),
      purchaselink: readText("packagepurchaselink", "purchaselink"),
      packer: readUserSelect("packagepacker", "packer"),
      price: readText("packageprice", "price"),
      items: readText("packageitems", "items"),
    });

    saveDraft(interaction.user.id, draft);

    const previewEmbed = buildPreviewEmbed(draft);

    const editButton = new ButtonBuilder().setCustomId("editPackage").setLabel("Edit").setStyle(ButtonStyle.Secondary);
    const submitButton = new ButtonBuilder()
      .setCustomId("submitPackage")
      .setLabel("Submit")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(draft.issues.length > 0);

    const buttons = new ActionRowBuilder().addComponents(editButton, submitButton);

    try {
      await interaction.update({
        embeds: [previewEmbed],
        components: [buttons],
      });
    } catch (error) {
      console.error("Error editing message:", error);
      await interaction.reply({
        content: "There was an error updating the package preview. Try again in a moment.",
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
