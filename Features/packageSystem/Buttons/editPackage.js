// Features/packageSystem/Buttons/editPackage.js
import { ModalBuilder } from "discord.js";
import { fetchDraft } from "../Utils/Packages/packageDraftStore.js";

export default {
  customID: "editPackage",
  async execute(interaction) {
    const { draft } = fetchDraft(interaction.user.id);

    const modal = new ModalBuilder()
      .setCustomId("editPackageModal")
      .setTitle("Package Details")
      .addLabelComponents(
        (label) =>
          label.setLabel("Package Name").setTextInputComponent((input) =>
            input
              .setCustomId("packagename")
              .setPlaceholder("FHP Livery Pack")
              .setRequired(false)
              .setStyle(1)
              .setValue(draft?.raw?.name ?? "")
          ),
        (label) =>
          label.setLabel("Roblox Purchase Link").setTextInputComponent((input) =>
            input
              .setCustomId("packagepurchaselink")
              .setPlaceholder("https://www.roblox.com/catalog/1234567890/example")
              .setRequired(false)
              .setStyle(1)
              .setValue(draft?.raw?.purchaselink ?? "")
          ),
        (label) =>
          label.setLabel("Packer").setUserSelectMenuComponent((menu) =>
            menu.setCustomId("packagepacker").setPlaceholder("Select the packer").setRequired(false).setMaxValues(1)
          ),
        (label) =>
          label.setLabel("Price").setTextInputComponent((input) =>
            input
              .setCustomId("packageprice")
              .setPlaceholder("The desired price of the item")
              .setRequired(false)
              .setStyle(1)
              .setValue(draft?.raw?.price ?? "")
          ),
        (label) =>
          label.setLabel("Included Items").setTextInputComponent((input) =>
            input
              .setCustomId("packageitems")
              .setPlaceholder("Class A Uniform\n2015 Dodge Charger\nEMS Livery")
              .setRequired(false)
              .setStyle(2)
              .setValue(draft?.raw?.items ?? "")
          )
      );

    await interaction.showModal(modal);
  },
};
