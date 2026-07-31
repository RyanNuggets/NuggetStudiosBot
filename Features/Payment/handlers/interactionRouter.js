// Features/Payment/handlers/interactionRouter.js
// Single interactionCreate listener for everything this feature owns.
// Scoped entirely to "pay:*" customIds and the /payment command (create +
// diagnose subcommands), so it can sit alongside your existing bot's
// interaction handling without conflicting.
//
// IMPORTANT: every branch below uses `await handleXxx(...)` (not
// `return handleXxx(...)`). In an async function, returning a promise
// without awaiting it lets a later rejection skip the surrounding
// try/catch entirely (the catch block has already been "exited" by the
// time the promise rejects) - which meant real errors were showing up to
// the user as Discord's generic "This interaction failed" toast instead
// of our friendlier fallback message. Always await, then return.

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
          if (subcommand === "create") {
            await handlePaymentCreateCommand(client, interaction);
            return;
          }
          if (subcommand === "diagnose") {
            await handlePaymentDiagnoseCommand(client, interaction);
            return;
          }
        }
        return;
      }

      // --- Modals ---
      if (isPaymentModalSubmit(interaction)) {
        await handlePaymentModalSubmit(client, interaction);
        return;
      }

      // --- Select menus ---
      if (isCustomerSelect(interaction)) {
        await handleCustomerSelect(client, interaction);
        return;
      }
      if (isChoiceSelect(interaction)) {
        await handleChoiceSelect(client, interaction);
        return;
      }
      if (isPaymentMethodSelect(interaction)) {
        await handlePaymentMethodSelect(client, interaction);
        return;
      }

      // --- Buttons: Robux/currency choice step ---
      if (isChoiceConfirm(interaction)) {
        await handleChoiceConfirm(client, interaction);
        return;
      }
      if (isChoiceBack(interaction)) {
        await handleChoiceBack(client, interaction);
        return;
      }

      // --- Buttons: Roblox path ---
      if (isRobloxConfirm(interaction)) {
        await handleRobloxConfirm(client, interaction);
        return;
      }
      if (isRobloxReverify(interaction)) {
        await handleRobloxReverify(client, interaction);
        return;
      }
      if (isRobloxPaid(interaction)) {
        await handleRobloxPaid(client, interaction);
        return;
      }

      // --- Buttons: online payment path ---
      if (isOnlinePaid(interaction)) {
        await handleOnlinePaid(client, interaction);
        return;
      }

      // --- Buttons: /payment diagnose ---
      if (isDiagnoseSelect(interaction)) {
        await handleDiagnoseSelect(client, interaction);
        return;
      }
      if (isDiagnoseRefresh(interaction)) {
        await handleDiagnoseRefresh(client, interaction);
        return;
      }
      if (isDiagnoseBack(interaction)) {
        await handleDiagnoseBack(client, interaction);
        return;
      }
      if (isDiagnoseForceExpireAsk(interaction)) {
        await handleDiagnoseForceExpireAsk(client, interaction);
        return;
      }
      if (isDiagnoseForceExpireConfirm(interaction)) {
        await handleDiagnoseForceExpireConfirm(client, interaction);
        return;
      }
      if (isDiagnoseForceExpireCancel(interaction)) {
        await handleDiagnoseForceExpireCancel(client, interaction);
        return;
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
