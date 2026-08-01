// Features/Payment/embeds/robloxConfirmEmbed.js
//
// No Discohook template was provided for this screen, so it's built to
// match the style of the ones that were (same heading/dot/section
// conventions, brand accent color, footer banner) - easy to tweak later.

import getConfig from "../config/config.js";
import { Emoji, buildContainerWithThumbnail } from "./brand.js";

/**
 * Shown after Gamepass/T-Shirt is picked - confirms which Roblox account
 * (via Bloxlink) the customer will be paying with.
 *
 * @param {import('discord.js').ActionRowBuilder} actionRow - Confirm/Reverify buttons
 */
export function buildRobloxConfirmEmbed({ payment, actionRow }) {
  const { embedColors } = getConfig();

  const content =
    `# ${Emoji.robux} Confirm Roblox Account\n` +
    `> Is this the account you'll be paying with?\n\n` +
    `-# **\`Payment ID\`**   ${Emoji.dot}   \`${payment.paymentId}\`\n` +
    `## Account Details\n` +
    `**\`Username:\`** ${payment.robloxUsername || "Unknown"}\n` +
    `**\`User ID:\`** ${payment.robloxUserId || "Unknown"}\n\n` +
    `> Press **Confirm** if this is correct, or **Reverify** to re-check your linked account.`;

  return buildContainerWithThumbnail({
    content,
    thumbnailUrl: payment.robloxAvatarUrl,
    accentColorHex: embedColors.default,
    actionRows: [actionRow],
  });
}
