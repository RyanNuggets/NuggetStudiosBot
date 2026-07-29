// Features/Payment/buttons/ivePaidButton.js
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { CustomId } from "../config/constants.js";

/**
 * @param {string} paymentId
 * @param {"roblox"|"online"} kind - which CustomId prefix to use
 */
export function buildIvePaidButton(paymentId, kind) {
  const customId = kind === "roblox" ? CustomId.ROBLOX_PAID : CustomId.ONLINE_PAID;

  const button = new ButtonBuilder()
    .setCustomId(`${customId}:${paymentId}`)
    .setLabel("I've Paid")
    .setStyle(ButtonStyle.Primary);

  return new ActionRowBuilder().addComponents(button);
}
