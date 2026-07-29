// Features/Payment/embeds/paymentCompleteEmbed.js
import { EmbedBuilder } from "discord.js";
import getConfig from "../config/config.js";
import { formatCurrency, formatRobux } from "../utils/pricing.js";

export function buildPaymentCompleteEmbed({ payment, staffId }) {
  const { embedColors } = getConfig();

  const isRoblox = payment.method === "Robux Gamepass" || payment.method === "Robux T-Shirt";
  const amountDisplay = isRoblox
    ? formatRobux(payment.robuxAmount)
    : formatCurrency(payment.convertedAmount, payment.currency);

  return new EmbedBuilder()
    .setTitle("✅ Payment Complete")
    .setColor(embedColors.success)
    .addFields(
      { name: "Customer", value: `<@${payment.customerId}>`, inline: true },
      { name: "Staff Member", value: staffId ? `<@${staffId}>` : "N/A", inline: true },
      { name: "Payment Method", value: payment.method, inline: true },
      { name: "Amount Paid", value: amountDisplay, inline: true },
      { name: "Currency", value: isRoblox ? "Robux" : payment.currency, inline: true },
      { name: "Description", value: payment.description || "None", inline: true },
      { name: "Payment ID", value: `\`${payment.paymentId}\``, inline: true },
      { name: "Status", value: "Completed", inline: true }
    )
    .setTimestamp();
}
