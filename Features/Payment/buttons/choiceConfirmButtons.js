// Features/Payment/buttons/choiceConfirmButtons.js
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { CustomId } from "../config/constants.js";

/**
 * Confirm/Back buttons shown after picking Robux or a currency from the
 * initial choice select. `value` is carried through so the confirm handler
 * knows what's being confirmed without a re-lookup.
 *
 * @param {string} paymentId
 * @param {string} value - "ROBUX" or a currency code (e.g. "AED")
 */
export function buildChoiceConfirmButtons(paymentId, value) {
  const confirm = new ButtonBuilder()
    .setCustomId(`${CustomId.CHOICE_CONFIRM}:${paymentId}:${value}`)
    .setLabel("Confirm")
    .setStyle(ButtonStyle.Success);

  const back = new ButtonBuilder()
    .setCustomId(`${CustomId.CHOICE_BACK}:${paymentId}`)
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(confirm, back);
}
