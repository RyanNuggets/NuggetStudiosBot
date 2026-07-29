// Features/Payment/buttons/paymentMethodComponents.js
import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { CustomId } from "../config/constants.js";

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
      { label: "Robux Gamepass", value: "Robux Gamepass", emoji: "🎮" },
      { label: "Robux T-Shirt", value: "Robux T-Shirt", emoji: "👕" },
      { label: "Apple Pay", value: "Apple Pay", emoji: "🍎" },
      { label: "Google Pay", value: "Google Pay", emoji: "🅶" },
      { label: "Credit/Debit Card", value: "Credit/Debit Card", emoji: "💳" }
    );

  return new ActionRowBuilder().addComponents(select);
}
