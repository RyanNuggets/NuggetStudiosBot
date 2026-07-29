// Features/Payment/buttons/currencySelectMenu.js
import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { CustomId } from "../config/constants.js";
import getConfig from "../config/config.js";

export function buildCurrencySelect(paymentId) {
  const { supportedCurrencies } = getConfig();

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${CustomId.CURRENCY_SELECT}:${paymentId}`)
    .setPlaceholder("Choose your currency")
    .addOptions(supportedCurrencies.map((code) => ({ label: code, value: code })));

  return new ActionRowBuilder().addComponents(select);
}
