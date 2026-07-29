// Features/Payment/buttons/robloxConfirmButtons.js
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { CustomId } from "../config/constants.js";

export function buildRobloxConfirmButtons(paymentId) {
  const confirm = new ButtonBuilder()
    .setCustomId(`${CustomId.ROBLOX_CONFIRM}:${paymentId}`)
    .setLabel("Confirm")
    .setStyle(ButtonStyle.Success);

  const reverify = new ButtonBuilder()
    .setCustomId(`${CustomId.ROBLOX_REVERIFY}:${paymentId}`)
    .setLabel("Reverify Account")
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(confirm, reverify);
}
