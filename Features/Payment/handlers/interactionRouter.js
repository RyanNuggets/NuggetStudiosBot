// Features/Payment/handlers/interactionRouter.js
// Single interactionCreate listener for everything this feature owns.
// Scoped entirely to "pay:*" customIds and the /payment command (create +
// diagnose subcommands), so it can sit alongside your existing bot's
// interaction handling without conflicting.

import { MessageFlags } from "discord.js";
import { handlePaymentCreateCommand } from "../commands/payment.js";
import {
  handlePaymentDiagnoseCommand,
  isDiagnoseSelect,
  handleDiagnoseSelect,
  isDiagnoseRefresh,
  handleDiagnoseRefresh,
  isDiagnoseBack,
  handleDiagnoseBack,
  isDiagnoseForceExpireAsk,
  handleDiagnoseForceExpireAsk,
  isDiagnoseForceExpireConfirm,
  handleDiagnoseForceExpireConfirm,
  isDiagnoseForceExpireCancel,
  handleDiagnoseForceExpireCancel,
} from "../commands/paymentDiagnose.js";
import {
  isPaymentModalSubmit,
  handlePaymentModalSubmit,
  isCustomerSelect,
  handleCustomerSelect,
} from "./createPaymentHandler.js";
import {
  isChoiceSelect,
  handleChoiceSelect,
  isChoiceConfirm,
  handleChoiceConfirm,
  isChoiceBack,
  handleChoiceBack,
} from "./paymentChoiceHandler.js";
import { isPaymentMethodSelect, handlePaymentMethodSelect } from "./paymentMethodHandler.js";
import {
  isRobloxConfirm,
  isRobloxReverify,
  isRobloxPaid,
  handleRobloxConfirm,
  handleRobloxReverify,
  handleRobloxPaid,
} from "./robloxPaymentHandler.js";
import { isOnlinePaid, handleOnlinePaid } from "./onlinePaymentHandler.js";
import { logError } from "../utils/logger.js";

export function setupPaymentInteractionRouter(client) {
  client.on("interactionCreate", async (interaction) => {
    try {
      // --- Slash commands ---
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "payment") {
          const subcommand = interaction.options.getSubcommand();
          if (subcommand === "create") return handlePaymentCreateCommand(client, interaction);
          if (subcommand === "diagnose") return handlePaymentDiagnoseCommand(client, interaction);
        }
        return;
      }

      // --- Modals ---
      if (isPaymentModalSubmit(interaction)) return handlePaymentModalSubmit(client, interaction);

      // --- Select menus ---
      if (isCustomerSelect(interaction)) return handleCustomerSelect(client, interaction);
      if (isChoiceSelect(interaction)) return handleChoiceSelect(client, interaction);
      if (isPaymentMethodSelect(interaction)) return handlePaymentMethodSelect(client, interaction);

      // --- Buttons: Robux/currency choice step ---
      if (isChoiceConfirm(interaction)) return handleChoiceConfirm(client, interaction);
      if (isChoiceBack(interaction)) return handleChoiceBack(client, interaction);

      // --- Buttons: Roblox path ---
      if (isRobloxConfirm(interaction)) return handleRobloxConfirm(client, interaction);
      if (isRobloxReverify(interaction)) return handleRobloxReverify(client, interaction);
      if (isRobloxPaid(interaction)) return handleRobloxPaid(client, interaction);

      // --- Buttons: online payment path ---
      if (isOnlinePaid(interaction)) return handleOnlinePaid(client, interaction);

      // --- Buttons: /payment diagnose ---
      if (isDiagnoseSelect(interaction)) return handleDiagnoseSelect(client, interaction);
      if (isDiagnoseRefresh(interaction)) return handleDiagnoseRefresh(client, interaction);
      if (isDiagnoseBack(interaction)) return handleDiagnoseBack(client, interaction);
      if (isDiagnoseForceExpireAsk(interaction)) return handleDiagnoseForceExpireAsk(client, interaction);
      if (isDiagnoseForceExpireConfirm(interaction)) return handleDiagnoseForceExpireConfirm(client, interaction);
      if (isDiagnoseForceExpireCancel(interaction)) return handleDiagnoseForceExpireCancel(client, interaction);
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
