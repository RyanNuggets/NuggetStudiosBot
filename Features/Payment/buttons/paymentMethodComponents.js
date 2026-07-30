// Features/Payment/buttons/paymentMethodComponents.js
import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { CustomId, PaymentMethod } from "../config/constants.js";

/**
 * Select menu shown after Robux is confirmed on the choice screen. Only
 * Gamepass/T-Shirt now - the online payment option is chosen earlier, on
 * the currency choice screen, so it no longer needs to live here.
 */
export function buildPaymentMethodSelect(paymentId) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${CustomId.METHOD_SELECT}:${paymentId}`)
    .setPlaceholder("Choose Gamepass or T-Shirt")
    .addOptions(
      { label: "Robux Gamepass", value: PaymentMethod.ROBUX_GAMEPASS, emoji: "🎮" },
      { label: "Robux T-Shirt", value: PaymentMethod.ROBUX_TSHIRT, emoji: "👕" }
    );

  return new ActionRowBuilder().addComponents(select);
}
