// Features/packageSystem/Utils/Packages/packageUtils.js
import { EmbedBuilder } from "discord.js";

const PACKAGE_COLOR = 0x242429;
const PACKAGE_ATTENTION_COLOR = 0xd97706;
const MARKDOWN_LINK = /^\s*\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)\s*$/i;

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureHttps(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function normalizePurchaseLink(rawValue) {
  const value = trimString(rawValue);
  if (!value) {
    return { url: "", label: "" };
  }

  const markdownMatch = value.match(MARKDOWN_LINK);
  if (markdownMatch) {
    return {
      url: ensureHttps(markdownMatch[2]),
      label: trimString(markdownMatch[1]),
    };
  }

  return { url: ensureHttps(value), label: "" };
}

function parsePackerId(rawValue) {
  const value = trimString(rawValue);
  if (!value) return "";

  const mentionMatch = value.match(/<@!?(?<id>\d{5,})>/);
  if (mentionMatch?.groups?.id) return mentionMatch.groups.id;

  const digitsMatch = value.match(/\d{5,}/);
  if (digitsMatch) return digitsMatch[0];

  return "";
}

function extractAssetId(rawLink) {
  if (!rawLink) return null;

  const link = String(rawLink).trim();

  try {
    const url = new URL(link);

    const segments = url.pathname.split("/").filter(Boolean);
    for (const segment of segments) {
      if (/^\d+$/.test(segment)) return Number(segment);
    }

    const searchKeys = ["assetId", "id", "itemId", "gamepassId"];
    for (const key of searchKeys) {
      const value = url.searchParams.get(key);
      if (value && /^\d+$/.test(value)) return Number(value);
    }
  } catch (_) {}

  const fallback = link.match(/(\d{4,})/);
  return fallback ? Number(fallback[1]) : null;
}

function formatItems(rawValue) {
  const cleanValue = trimString(rawValue);
  if (!cleanValue) return { itemsList: [], display: "" };

  const splitItems = cleanValue
    .split(/[\r\n]+|,/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!splitItems.length) return { itemsList: [], display: "" };

  return {
    itemsList: splitItems,
    display: splitItems.map((item) => `- ${item}`).join("\n"),
  };
}

function sanitizePackageDraft(input) {
  const raw = {
    name: trimString(input.name),
    purchaselink: trimString(input.purchaselink),
    packer: trimString(input.packer),
    price: trimString(input.price),
    items: trimString(input.items),
  };

  const { url: purchaselink, label: purchaseLabel } = normalizePurchaseLink(raw.purchaselink);
  const packerId = parsePackerId(raw.packer);
  const { itemsList, display } = formatItems(raw.items);
  const assetId = extractAssetId(purchaselink || raw.purchaselink);

  const issues = [];
  if (!raw.name) issues.push("Set a package name.");
  if (!purchaselink) issues.push("Add the Roblox purchase link.");
  if (!assetId) issues.push("Ensure the purchase link contains a valid asset ID.");
  if (!packerId) issues.push("Select or mention the packer.");
  if (!raw.price) issues.push("Enter the package price.");
  if (!itemsList.length) issues.push("List at least one included item.");

  return {
    name: raw.name,
    purchaselink,
    purchaseLabel,
    packerId,
    price: raw.price,
    items: display,
    itemsList,
    assetId,
    issues,
    raw,
  };
}

function buildPreviewEmbed(draft) {
  const hasIssues = draft.issues.length > 0;
  const embed = new EmbedBuilder()
    .setColor(hasIssues ? PACKAGE_ATTENTION_COLOR : PACKAGE_COLOR)
    .setTitle(draft.name || "Package Preview")
    .setTimestamp();

  if (draft.purchaselink) {
    if (draft.purchaseLabel) {
      embed.setDescription(`[${draft.purchaseLabel}](${draft.purchaselink})`);
    } else {
      embed.setDescription(`[View Roblox Listing](${draft.purchaselink})`);
    }
  } else {
    embed.setDescription("Add the Roblox purchase link so the listing is easy to find.");
  }

  embed.addFields(
    { name: "Packer", value: draft.packerId ? `<@${draft.packerId}>` : "Not set", inline: true },
    { name: "Price", value: draft.price || "Not set", inline: true },
    { name: "Asset ID", value: draft.assetId ? `\`${draft.assetId}\`` : "Not detected", inline: true }
  );

  embed.addFields({
    name: "Included Items",
    value: draft.items || "List the deliverables to complete the overview.",
  });

  if (hasIssues) {
    embed.addFields({
      name: "Next Steps",
      value: draft.issues.map((issue) => `- ${issue}`).join("\n"),
    });
    embed.setFooter({ text: "Submit will unlock once every item above is resolved." });
  } else {
    embed.setFooter({ text: "All required details captured. Ready to submit." });
  }

  return embed;
}

function buildPublicPackageEmbed(data) {
  const embed = new EmbedBuilder().setColor(PACKAGE_COLOR).setTitle(data.name).setTimestamp();

  if (data.purchaselink) {
    embed.setURL(data.purchaselink);
  } else {
    embed.setDescription("No purchase link has been provided for this package.");
  }

  embed.addFields(
    { name: "Packer", value: `<@${data.packerId}>`, inline: true },
    { name: "Price", value: data.price, inline: true },
    { name: "Asset ID", value: data.assetId ? `\`${data.assetId}\`` : "Not set", inline: true }
  );

  if (Array.isArray(data.itemsList) && data.itemsList.length) {
    embed.addFields({ name: "Included Items", value: data.itemsList.map((item) => `- ${item}`).join("\n") });
  } else if (typeof data.items === "string" && data.items.trim()) {
    embed.addFields({ name: "Included Items", value: data.items });
  }

  return embed;
}

export {
  PACKAGE_COLOR,
  PACKAGE_ATTENTION_COLOR,
  sanitizePackageDraft,
  buildPreviewEmbed,
  buildPublicPackageEmbed,
  extractAssetId,
  parsePackerId,
  normalizePurchaseLink,
  formatItems,
};
