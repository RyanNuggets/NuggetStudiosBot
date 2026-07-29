// Features/Payment/modals/paymentModal.js
//
// IMPORTANT DESIGN NOTE:
// Discord's Modal API only supports Text Input components (no user/select
// menus inside modals) on the widely-deployed API version. So this modal
// collects Robux Amount + Description, and immediately after submission the
// bot follows up with an ephemeral User Select menu to pick the Customer -
// functionally identical to having it "in the modal" from the staff
// member's point of view (one extra click), without depending on
// modal-component support that may not exist on your discord.js version.
//
// If you're on a discord.js/Discord API version that DOES support select
// menus inside modals, you can collapse this into a single modal - see the
// commented `buildPaymentModalWithUserSelect` stub at the bottom for where
// that would go instead.

import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

export const PAYMENT_MODAL_ID = "pay:modal";

export function buildPaymentModal() {
  const modal = new ModalBuilder().setCustomId(PAYMENT_MODAL_ID).setTitle("Create Payment");

  const robuxInput = new TextInputBuilder()
    .setCustomId("robuxAmount")
    .setLabel("Robux Amount")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. 500")
    .setRequired(true);

  const descriptionInput = new TextInputBuilder()
    .setCustomId("description")
    .setLabel("Description (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(robuxInput),
    new ActionRowBuilder().addComponents(descriptionInput)
  );

  return modal;
}

/**
 * Parses+validates the modal submission's raw field values.
 * @returns {{ robuxAmount: number, description: string|null } | { error: string }}
 */
export function parsePaymentModalSubmission(interaction) {
  const robuxRaw = interaction.fields.getTextInputValue("robuxAmount")?.trim();
  const description = interaction.fields.getTextInputValue("description")?.trim() || null;

  const robuxAmount = Number(robuxRaw.replace(/,/g, ""));
  if (!Number.isFinite(robuxAmount) || robuxAmount <= 0 || !Number.isInteger(robuxAmount)) {
    return { error: "Robux Amount must be a positive whole number." };
  }

  return { robuxAmount, description };
}

// --- Optional: native user-select-in-modal, if your discord.js supports it ---
//
// import { LabelBuilder, UserSelectMenuBuilder } from "discord.js";
//
// export function buildPaymentModalWithUserSelect() {
//   const modal = new ModalBuilder().setCustomId(PAYMENT_MODAL_ID).setTitle("Create Payment");
//   const customerSelect = new UserSelectMenuBuilder().setCustomId("customer").setMinValues(1).setMaxValues(1);
//   const customerLabel = new LabelBuilder().setLabel("Customer").setUserSelectMenuComponent(customerSelect);
//   // ...add customerLabel + text input labels via modal.addLabelComponents(...)
//   return modal;
// }
