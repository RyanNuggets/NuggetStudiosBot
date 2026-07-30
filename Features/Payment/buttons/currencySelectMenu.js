// Features/Payment/buttons/currencySelectMenu.js
import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { CustomId } from "../config/constants.js";
import getConfig from "../config/config.js";

/**
 * Shown right after a customer is picked for a payment. This is the very
 * first "how do you want to pay" prompt - Robux (Gamepass/T-Shirt), or one
 * of the supported real-world currencies (routed to the online Card / Apple
 * Pay / Google Pay checkout). Whichever is picked, a confirm/back step
 * follows before anything is actually generated - see
 * handlers/paymentChoiceHandler.js.
 */
export function buildCurrencyChoiceSelect(paymentId) {
  const { supportedCurrencies } = getConfig();

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${CustomId.CHOICE_SELECT}:${paymentId}`)
    .setPlaceholder("Choose how you'd like to pay")
    .addOptions(
      {
        label: "Robux",
        value: "ROBUX",
        emoji: "🎮",
        description: "Pay with a Gamepass or T-Shirt purchase",
      },
      ...supportedCurrencies.map((code) => ({
        label: code,
        value: code,
        emoji: "💳",
        description: `Pay by card / Apple Pay / Google Pay in ${code}`,
      }))
    );

  return new ActionRowBuilder().addComponents(select);
}
