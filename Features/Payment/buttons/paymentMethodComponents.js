// Features/Payment/buttons/paymentMethodComponents.js
import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { CustomId, PaymentMethod } from "../config/constants.js";

/**
 * Select menu used on the payment method embed. A select menu (rather than
 * 5 separate buttons) keeps the message compact and easy to extend if more
 * methods get added later.
 */
export function buildPaymentMethodSelect(paymentId) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${CustomId.METHOD_SELECT}:${paymentId}`)
    .setPlaceholder("Choose a payment method")
    .addOptions(
      { label: "Robux Gamepass", value: PaymentMethod.ROBUX_GAMEPASS, emoji: "🎮" },
      { label: "Robux T-Shirt", value: PaymentMethod.ROBUX_TSHIRT, emoji: "👕" },
      { label: PaymentMethod.ONLINE_PAYMENT, value: PaymentMethod.ONLINE_PAYMENT, emoji: "💳" }
    );

  return new ActionRowBuilder().addComponents(select);
}
