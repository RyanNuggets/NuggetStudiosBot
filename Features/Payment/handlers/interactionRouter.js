// Features/Payment/handlers/interactionRouter.js
// Single interactionCreate listener for everything this feature owns.
// Scoped entirely to "pay:*" customIds and the /payment, /forceexpirepayment
// commands, so it can sit alongside your existing bot's interaction
// handling without conflicting.

import { MessageFlags } from "discord.js";
import { handlePaymentCommand } from "../commands/payment.js";
import { handleForceExpireCommand, handleForceExpireConfirm } from "../commands/forceexpirepayment.js";
import {
  isPaymentModalSubmit,
  handlePaymentModalSubmit,
  isCustomerSelect,
  handleCustomerSelect,
} from "./createPaymentHandler.js";
import { isPaymentMethodSelect, handlePaymentMethodSelect } from "./paymentMethodHandler.js";
import {
  isRobloxConfirm,
  isRobloxReverify,
  isRobloxPaid,
  handleRobloxConfirm,
  handleRobloxReverify,
  handleRobloxPaid,
} from "./robloxPaymentHandler.js";
import { isCurrencySelect, isOnlinePaid, handleCurrencySelect, handleOnlinePaid } from "./onlinePaymentHandler.js";
import { logError } from "../utils/logger.js";

export function setupPaymentInteractionRouter(client) {
  client.on("interactionCreate", async (interaction) => {
    try {
      // --- Slash commands ---
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "payment") return handlePaymentCommand(client, interaction);
        if (interaction.commandName === "forceexpirepayment") return handleForceExpireCommand(client, interaction);
        return;
      }

      // --- Modals ---
      if (isPaymentModalSubmit(interaction)) return handlePaymentModalSubmit(client, interaction);

      // --- Select menus ---
      if (isCustomerSelect(interaction)) return handleCustomerSelect(client, interaction);
      if (isPaymentMethodSelect(interaction)) return handlePaymentMethodSelect(client, interaction);
      if (isCurrencySelect(interaction)) return handleCurrencySelect(client, interaction);

      // --- Buttons ---
      if (isRobloxConfirm(interaction)) return handleRobloxConfirm(client, interaction);
      if (isRobloxReverify(interaction)) return handleRobloxReverify(client, interaction);
      if (isRobloxPaid(interaction)) return handleRobloxPaid(client, interaction);
      if (isOnlinePaid(interaction)) return handleOnlinePaid(client, interaction);

      if (interaction.isButton?.() && interaction.customId.startsWith("pay:forceexpire:confirm:")) {
        const paymentId = interaction.customId.split(":")[3];
        return handleForceExpireConfirm(client, interaction, paymentId);
      }
    } catch (err) {
      console.error("[Payment] interaction handler error:", err);
      await logError(client, "Interaction handler error", err);

      const errorPayload = { content: "Something went wrong processing that. Please try again, or contact staff.", components: [] };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ ...errorPayload, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else if (interaction.isRepliable?.()) {
        await interaction.reply({ ...errorPayload, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });
}
