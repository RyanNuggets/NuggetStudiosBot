// Features/Payment/buttons/tosAgreementButtons.js
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { CustomId } from "../config/constants.js";

const TOS_URL = "https://nuggetstudios.xyz/tos";

/**
 * Shown on the service agreement gate: a link to actually read it, an
 * "I Agree" button that carries the paymentId/value through so the next
 * handler knows exactly what to generate, and a Back button that returns
 * to the Robux/currency choice screen.
 */
export function buildTosAgreementButtons(paymentId, value) {
  const readItLink = new ButtonBuilder().setLabel("Read Service Agreement").setStyle(ButtonStyle.Link).setURL(TOS_URL);

  const agree = new ButtonBuilder()
    .setCustomId(`${CustomId.TOS_AGREE}:${paymentId}:${value}`)
    .setLabel("I Agree")
    .setStyle(ButtonStyle.Success);

  const back = new ButtonBuilder()
    .setCustomId(`${CustomId.CHOICE_BACK}:${paymentId}`)
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(readItLink, agree, back);
}
