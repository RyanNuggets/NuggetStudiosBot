// Features/Payment/buttons/customerSelectMenu.js
import { ActionRowBuilder, UserSelectMenuBuilder } from "discord.js";
import { CustomId } from "../config/constants.js";

/**
 * Shown right after the payment modal is submitted, so staff can pick the
 * customer this payment is for. See modals/paymentModal.js for why this
 * isn't inside the modal itself.
 *
 * @param {string} draftId - a temporary ID for this in-progress session, not yet a real paymentId
 */
export function buildCustomerSelect(draftId) {
  const select = new UserSelectMenuBuilder()
    .setCustomId(`${CustomId.CUSTOMER_SELECT}:${draftId}`)
    .setPlaceholder("Select the customer")
    .setMinValues(1)
    .setMaxValues(1);

  return new ActionRowBuilder().addComponents(select);
}
