// Features/Payment/embeds/robloxConfirmEmbed.js
import { EmbedBuilder } from "discord.js";
import getConfig from "../config/config.js";

export function buildRobloxConfirmEmbed({ payment }) {
  const { embedColors } = getConfig();

  return new EmbedBuilder()
    .setTitle("Is this the Roblox account you want to pay with?")
    .setColor(embedColors.default)
    .setThumbnail(payment.robloxAvatarUrl || null)
    .addFields(
      { name: "Username", value: payment.robloxUsername || "Unknown", inline: true },
      { name: "User ID", value: String(payment.robloxUserId || "Unknown"), inline: true }
    )
    .setFooter({ text: `Payment ID: ${payment.paymentId}` });
}
