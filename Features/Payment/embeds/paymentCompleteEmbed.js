// Features/Payment/embeds/paymentCompleteEmbed.js
import getConfig from "../config/config.js";
import { formatCurrency, formatRobux } from "../utils/pricing.js";
import { buildContainer, Emoji } from "./brand.js";

export function buildPaymentCompleteEmbed({ payment, staffId }) {
  const { embedColors } = getConfig();

  const isRoblox = payment.method === "Robux Gamepass" || payment.method === "Robux T-Shirt";
  const amountDisplay = isRoblox ? formatRobux(payment.robuxAmount) : formatCurrency(payment.convertedAmount, payment.currency);
  const currencyDisplay = isRoblox ? "Robux" : payment.currency;

  const content =
    `# ${Emoji.greenCheck} Payment Complete\n` +
    `> Your payment has been received successfully.\n\n` +
    `-# **\`Customer\`**   ${Emoji.dot}   <@${payment.customerId}>\n` +
    `-# **\`Staff Member\`**   ${Emoji.dot}   ${staffId ? `<@${staffId}>` : "N/A"}\n\n` +
    `## ${Emoji.shoppingCart} Payment Summary\n` +
    `**\`Amount Paid:\`** ${amountDisplay}\n` +
    `**\`Payment Method:\`** ${payment.method}\n` +
    `**\`Currency:\`** ${currencyDisplay}\n` +
    `**\`Payment ID:\`** \`${payment.paymentId}\`\n\n` +
    `> Thank you for choosing **Nugget Studios!** Your order has been confirmed and is now being processed.`;

  return buildContainer({ content, accentColorHex: embedColors.success });
}
