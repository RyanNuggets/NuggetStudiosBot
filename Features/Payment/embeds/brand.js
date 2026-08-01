// Features/Payment/embeds/brand.js
//
// Shared bits for the Components V2 ("Container") look used across the
// payment flow, so the banner image / accent colors only live in one
// place. All the actual per-screen containers live in their own files;
// this is just plumbing.

// NOTE: this is a Discord CDN "media.discordapp.net" signed URL (has
// ex=/is=/hm= query params) copied from the Discohook export. Signed CDN
// URLs like this are tied to a specific request and can eventually expire
// or stop resolving. If the banner ever stops showing up, re-upload the
// image to any channel, grab the fresh attachment URL, and swap it in
// here - or better, host it somewhere permanent (your own CDN/domain) so
// it never has to be touched again.
export const BANNER_URL =
  "https://media.discordapp.net/attachments/1486296464350249040/1527106449740791887/Dubai_Roleplay_Banner_Footer_1.png?ex=6a6f34f5&is=6a6de375&hm=1ab32ccc57cb55d2aa7fa767d408d9401f03b8c28372dc86420d3b2b433727c4&=&format=webp&quality=lossless&width=2048&height=106";

export const Emoji = {
  greenCheck: "<:nsgreen:1527102715371716688>",
  dot: "<:dot:1528163225806307519>",
  robux: "<:robux:1528164258251018281>",
  creditCard: "<:creditcard:1528164289192525996>",
  wallet: "<:wallet:1528165051859468348>",
  document: "<:document:1533123655830208693>",
  shield: "<:shield:1528162879524704407>",
  shoppingCart: "<:shoppingcart:1528163263861231847>",
  link: "<:link:1533124640988205177>",
  ticket: "<:ticket:1533127978475716628>",
  shirt: "<:shirt:1533127951397421317>",
};

import { ContainerBuilder, SectionBuilder, ThumbnailBuilder } from "discord.js";

/**
 * ContainerBuilder#setAccentColor needs a plain number, unlike
 * EmbedBuilder#setColor which also accepts hex strings - config.js's
 * embedColors are hex strings ("#5865F2"), so convert here.
 */
export function accentColor(hex) {
  return parseInt(String(hex).replace("#", ""), 16);
}

/**
 * Adds the standard footer banner to a container. Call this last, after
 * all text/action row components have been added.
 */
export function addBanner(container) {
  return container.addMediaGalleryComponents((gallery) => gallery.addItems((item) => item.setURL(BANNER_URL)));
}

/**
 * Builds a standard Components V2 payment screen: markdown text, zero or
 * more action rows (buttons/select menus), then the footer banner. This is
 * the one function every embeds/*.js file in this folder uses to assemble
 * its final container, so the structure (and the banner) stays consistent
 * everywhere without repeating it.
 *
 * @param {object} params
 * @param {string} params.content - markdown text (becomes one TextDisplay)
 * @param {string} [params.accentColorHex] - e.g. "#5865F2"
 * @param {import('discord.js').ActionRowBuilder[]} [params.actionRows]
 */
export function buildContainer({ content, accentColorHex, actionRows = [] }) {
  const container = new ContainerBuilder();
  if (accentColorHex) container.setAccentColor(accentColor(accentColorHex));

  container.addTextDisplayComponents((td) => td.setContent(content));

  for (const row of actionRows) {
    if (!row) continue;
    container.addActionRowComponents((r) => r.setComponents(...row.components));
  }

  addBanner(container);
  return container;
}

/**
 * Same as buildContainer, but the text is a Section with a thumbnail
 * accessory (e.g. a Roblox avatar) instead of a plain TextDisplay. Used by
 * the Roblox account confirm screen.
 */
export function buildContainerWithThumbnail({ content, thumbnailUrl, accentColorHex, actionRows = [] }) {
  const container = new ContainerBuilder();
  if (accentColorHex) container.setAccentColor(accentColor(accentColorHex));

  container.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((td) => td.setContent(content))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl || BANNER_URL))
  );

  for (const row of actionRows) {
    if (!row) continue;
    container.addActionRowComponents((r) => r.setComponents(...row.components));
  }

  addBanner(container);
  return container;
}
