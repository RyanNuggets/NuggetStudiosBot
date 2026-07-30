// Features/Payment/commands/payment.js
import { MessageFlags } from "discord.js";
import getConfig from "../config/config.js";
import { buildPaymentModal } from "../modals/paymentModal.js";
import { hasAllowedRole } from "../utils/permissions.js";

export const paymentCommandData = {
  name: "payment",
  description: "Payment tools for staff.",
  options: [
    {
      name: "create",
      description: "Create a new payment session for a customer.",
      type: 1, // SUB_COMMAND
    },
    {
      name: "diagnose",
      description: "View open payments, inspect their status/errors, or force-expire one.",
      type: 1, // SUB_COMMAND
    },
  ],
};

/**
 * Staff runs /payment create -> shows the modal (Robux Amount + Description).
 * The customer is picked in a follow-up step - see modals/paymentModal.js.
 */
export async function handlePaymentCreateCommand(client, interaction) {
  const { allowedRoleId } = getConfig();

  if (!hasAllowedRole(interaction.member, allowedRoleId)) {
    return interaction.reply({
      content: "You don't have permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.showModal(buildPaymentModal());
}
