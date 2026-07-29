// Features/Payment/commands/payment.js
import { MessageFlags } from "discord.js";
import getConfig from "../config/config.js";
import { buildPaymentModal } from "../modals/paymentModal.js";
import { hasAllowedRole } from "../utils/permissions.js";

export const paymentCommandData = {
  name: "payment",
  description: "Create a new payment session for a customer.",
  options: [],
};

/**
 * Staff runs /payment -> shows the modal (Robux Amount + Description).
 * The customer is picked in a follow-up step - see modals/paymentModal.js.
 */
export async function handlePaymentCommand(client, interaction) {
  const { allowedRoleId } = getConfig();

  if (!hasAllowedRole(interaction.member, allowedRoleId)) {
    return interaction.reply({
      content: "You don't have permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.showModal(buildPaymentModal());
}
