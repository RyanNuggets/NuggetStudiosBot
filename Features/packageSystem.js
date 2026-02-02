// packageSystem.js (FULL SCRIPT + DEBUG LOGS + FIXES)
// ✅ Fixes DM "interaction failed" on download (no ephemeral in DMs + defer/editReply)
// ✅ Fixes claim timeouts (deferReply)
// ✅ Adds purchase verification via Roblox GROUP sales watcher (requires packages.groupId + ROBLOX_COOKIE)
// ✅ Adds 7-day lookback on first run so it can catch recent purchases
// ✅ Adds detailed logs so you can SEE why it says "no verified purchase"

// -------------------- IMPORTS --------------------
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import noblox from "noblox.js";

import {
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder,
  ChannelType
} from "discord.js";

// -------------------- DB (Railway Volume) --------------------
const DB_PATH = process.env.DB_PATH || "/data/packages.db";
const LOOKBACK_DAYS_ON_FIRST_RUN = 7;

function openDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      purchase_link TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      price INTEGER NOT NULL,
      packer_id TEXT NOT NULL,
      included_items TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      package_id INTEGER NOT NULL,
      forum_key TEXT NOT NULL,
      thread_id TEXT,
      dm_message_id TEXT,
      dm_channel_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS send_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      send_id INTEGER NOT NULL,
      url TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS send_file (
      send_id INTEGER PRIMARY KEY,
      attachment_url TEXT NOT NULL,
      filename TEXT NOT NULL
    );

    -- Purchase verification storage (Roblox group sale watcher writes here)
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL,
      roblox_user_id TEXT,
      roblox_username TEXT,
      asset_id TEXT NOT NULL,
      item_name TEXT,
      amount INTEGER,
      purchased_at INTEGER NOT NULL,
      claimed_at INTEGER,
      claimed_send_id INTEGER
    );

    -- Meta table for watcher timestamp
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return db;
}

function metaGet(db, key) {
  return db.prepare("SELECT value FROM meta WHERE key=?").get(key)?.value ?? null;
}
function metaSet(db, key, value) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).run(key, String(value));
}

// -------------------- Helpers: ephemeral only in guilds --------------------
function isGuildInteraction(interaction) {
  return typeof interaction.inGuild === "function" ? interaction.inGuild() : !!interaction.guildId;
}

async function safeReply(interaction, payload, { ephemeral = false } = {}) {
  const useEphemeral = ephemeral && isGuildInteraction(interaction);
  const body = { ...payload };
  if (useEphemeral) body.ephemeral = true;
  return interaction.reply(body);
}

async function safeFollowUp(interaction, payload, { ephemeral = false } = {}) {
  const useEphemeral = ephemeral && isGuildInteraction(interaction);
  const body = { ...payload };
  if (useEphemeral) body.ephemeral = true;
  return interaction.followUp(body);
}

async function safeDeferReply(interaction, { ephemeral = false } = {}) {
  const useEphemeral = ephemeral && isGuildInteraction(interaction);
  return interaction.deferReply(useEphemeral ? { ephemeral: true } : {});
}

// -------------------- Bloxlink lookups --------------------
async function getRobloxUsernameViaBloxlink(discordUserId) {
  const apiKey = process.env.BLOXLINK_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(`https://api.blox.link/v4/public/guilds/0/users/${discordUserId}`, {
    headers: { Authorization: apiKey }
  });
  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  const robloxId = data?.robloxID || data?.robloxId || null;
  if (!robloxId) return null;

  const ures = await fetch(`https://users.roblox.com/v1/users/${robloxId}`);
  if (!ures.ok) return null;
  const udata = await ures.json().catch(() => null);

  return udata?.name || null;
}

// Roblox -> Discord (guild scoped) used by watcher
async function getDiscordIdFromBloxlink(robloxId, discordGuildId) {
  const apiKey = process.env.BLOXLINK_API_KEY;
  if (!apiKey) return null;
  if (!discordGuildId) return null;

  const res = await fetch(
    `https://api.blox.link/v4/public/guilds/${discordGuildId}/roblox-to-discord/${robloxId}`,
    { headers: { Authorization: apiKey } }
  );
  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  return data?.discordIDs?.[0] ?? null;
}

// -------------------- Discord command registration --------------------
async function registerCommands({ token, clientId, guildId }) {
  const rest = new REST({ version: "10" }).setToken(token);

  const cmd = new SlashCommandBuilder()
    .setName("package")
    .setDescription("Package system")
    .addSubcommand((s) => s.setName("create").setDescription("Create a package"))
    .addSubcommand((s) => s.setName("send").setDescription("Send yourself a package (DM wizard)"))
    .addSubcommand((s) => s.setName("delete").setDescription("Delete a package (and its forum threads)"));

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [cmd.toJSON()] });
}

// -------------------- UI IDs --------------------
const IDS = {
  create_edit: "pkg_create_edit",
  create_submit: "pkg_create_submit",
  create_modal: "pkg_create_modal",

  send_pick_pkg: "pkg_send_pick_pkg",
  send_pick_forum: "pkg_send_pick_forum",
  send_done_images: "pkg_send_done_images",
  send_done_file: "pkg_send_done_file",

  claim: "pkg_claim",
  download: "pkg_download",

  delete_pick: "pkg_delete_pick",
  delete_confirm: "pkg_delete_confirm",
  delete_cancel: "pkg_delete_cancel"
};

// -------------------- Embeds/UI builders --------------------
function packagePreviewEmbed(draft) {
  return new EmbedBuilder()
    .setTitle("Package Preview")
    .setDescription(
      [
        `**Name:** ${draft.name || "Not set"}`,
        `**Purchase Link:** ${draft.purchase_link || "Not set"}`,
        `**Asset ID:** ${draft.asset_id || "Not detected"}`,
        `**Packer:** ${draft.packer_id ? `<@${draft.packer_id}>` : "Not set"}`,
        `**Price:** ${draft.price ? `R$${draft.price}` : "Not set"}`,
        "",
        "**Included Items:**",
        draft.included_items?.length ? draft.included_items.map((x) => `• ${x}`).join("\n") : "None"
      ].join("\n")
    );
}

function buildThreadEmbed(pkg, packerPing) {
  const dot = "<:dot:1467233440117297203>";

  const descriptionLines = [
    `## [${pkg.name}](${pkg.purchase_link})`,
    "",
    `**<:people:1467165138259018005> Packer:** ${packerPing}`,
    `**<:card:1467165047624302664> Price:** R$${pkg.price}`,
    "",
    "**Included Items:**",
    ...pkg.included_items.map((i) => `${dot} ${i}`),
    "",
    `<:star:1467246556649623694> To receive your package, click on "Claim Package".`
  ];

  return {
    embeds: [
      {
        // ✅ title fully removed
        description: descriptionLines.join("\n"),
        fields: [{ name: "", value: "" }],
        image: {
          url: "https://media.discordapp.net/attachments/1467051814733222043/1467852126406578469/Screenshot_2026-01-23_at_5.04.08_PM_1.png?ex=6981e352&is=698091d2&hm=f9091c04592476cda23f39c4dabc23d0cc7d4eb58217a3d6ad3283383ef4188f&=&format=webp&quality=lossless"
        }
      }
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: "Claim Package",
            custom_id: IDS.claim
          }
        ]
      }
    ]
  };
}

function buildDmThanksComponents({ robloxUser, price, productName, sendId }) {
  const embed = new EmbedBuilder()
    .setDescription(
      [
        `Thank you for your purchase! Click "Download Product" to receive your product.`,
        "",
        `**<:people:1467165138259018005> Roblox Account:** ${robloxUser || "Unknown"}`,
        `**<:robux:1467165348565487841> Price:** R$${price}`,
        `**<:document:1467165307465629817> Product Received:** ${productName}`
      ].join("\n")
    )
    .setImage(
      "https://media.discordapp.net/attachments/1467051814733222043/1467573189625254151/NS_Thank_You.png?ex=6981884a&is=698036ca&hm=7aaeba9ff35b5b9874f6efc8cf1d8bb36da96a2bca620ed6fd02282d6cc62a89&=&format=webp&quality=lossless&width=1872&height=560"
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${IDS.download}:${sendId}`)
      .setLabel("Download Product")
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

// -------------------- Roblox GROUP purchase watcher --------------------
async function startPurchaseWatcher({ db, discordGuildId, groupId, pollMs = 20000 }) {
  const cookie = process.env.ROBLOX_COOKIE;

  if (!cookie) {
    console.log("⚠️ Purchase watcher disabled: Missing env ROBLOX_COOKIE");
    return;
  }
  if (!groupId) {
    console.log("⚠️ Purchase watcher disabled: Missing config.packages.groupId");
    return;
  }

  try {
    await noblox.setCookie(cookie);
    console.log("✅ Roblox cookie set. Purchase watcher running...");
  } catch (e) {
    console.error("❌ Failed to set Roblox cookie:", e);
    return;
  }

  const metaKey = "purchases:last_ts";
  const existing = metaGet(db, metaKey);

  // ✅ Lookback on first run so recent purchases can be verified
  if (!existing) {
    const backMs = LOOKBACK_DAYS_ON_FIRST_RUN * 24 * 60 * 60 * 1000;
    metaSet(db, metaKey, Date.now() - backMs);
    console.log(`🕒 First run: purchase watcher lookback set to last ${LOOKBACK_DAYS_ON_FIRST_RUN} days.`);
  }

  setInterval(async () => {
    try {
      const lastTs = Number(metaGet(db, metaKey) || Date.now());
      const txns = await noblox.getGroupTransactions(Number(groupId), "Sale");

      if (!Array.isArray(txns)) {
        console.log("⚠️ getGroupTransactions returned non-array.");
        return;
      }

      // Process oldest -> newest for stable last_ts update
      const sorted = [...txns].sort((a, b) => new Date(a.created) - new Date(b.created));
      let newestSeen = lastTs;

      for (const t of sorted) {
        const createdMs = new Date(t.created).getTime();
        if (!Number.isFinite(createdMs)) continue;
        if (createdMs <= lastTs) continue;

        const robloxBuyerId = t.agent?.id ?? null;
        const robloxBuyerName = t.agent?.name ?? null;
        const itemId = t.details?.id ?? null;           // IMPORTANT: this is what we store as asset_id
        const itemName = t.details?.name ?? null;
        const amount = t.currency?.amount ?? null;

        console.log("SALE SEEN:", {
          created: t.created,
          itemId,
          itemName,
          buyerId: robloxBuyerId,
          buyerName: robloxBuyerName,
          amount
        });

        newestSeen = Math.max(newestSeen, createdMs);

        if (!robloxBuyerId || !itemId) continue;

        const discordId = await getDiscordIdFromBloxlink(String(robloxBuyerId), discordGuildId);
        if (!discordId) {
          console.log("BLOXLINK FAILED:", { robloxBuyerId, robloxBuyerName, discordGuildId });
          continue;
        }
        console.log("BLOXLINK OK:", { robloxBuyerId, discordId });

        // Prevent duplicates (discord + itemId + createdMs)
        const existsRow = db.prepare(`
          SELECT 1 FROM purchases
          WHERE discord_user_id=? AND asset_id=? AND purchased_at=?
          LIMIT 1
        `).get(String(discordId), String(itemId), createdMs);

        if (!existsRow) {
          db.prepare(`
            INSERT INTO purchases (discord_user_id, roblox_user_id, roblox_username, asset_id, item_name, amount, purchased_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            String(discordId),
            String(robloxBuyerId),
            robloxBuyerName ? String(robloxBuyerName) : null,
            String(itemId),
            itemName ? String(itemName) : null,
            amount !== null ? Number(amount) : null,
            createdMs
          );

          console.log("✅ PURCHASE STORED:", { discordId, asset_id: String(itemId), purchased_at: createdMs });
        }
      }

      if (newestSeen > lastTs) {
        metaSet(db, metaKey, newestSeen);
      }
    } catch (e) {
      console.error("purchase watcher error:", e);
    }
  }, pollMs);
}

// -------------------- MAIN --------------------
export function registerPackageSystem(client, config) {
  const guildId = config?.guildId;
  const cfg = config?.packages;

  if (!guildId) throw new Error("Missing top-level `guildId` in config.json");
  if (!cfg) throw new Error("Missing `packages` in config.json");

  const db = openDb();
  const drafts = new Map(); // userId -> draft

  client.once("ready", async () => {
    try {
      const token = process.env.DISCORD_TOKEN;
      const clientId = process.env.CLIENT_ID;

      if (!token) throw new Error("Missing env DISCORD_TOKEN");
      if (!clientId) throw new Error("Missing env CLIENT_ID");

      await registerCommands({ token, clientId, guildId });
      console.log("✅ Slash commands registered.");

      // Start watcher (requires cfg.groupId)
      await startPurchaseWatcher({
        db,
        discordGuildId: guildId,
        groupId: cfg.groupId,
        pollMs: cfg.pollMs || 20000
      });
    } catch (e) {
      console.error("❌ Startup failed:", e);
    }
  });

  // ---------------- interactions ----------------
  client.on("interactionCreate", async (interaction) => {
    try {
      // ---------- Slash commands ----------
      if (interaction.isChatInputCommand() && interaction.commandName === "package") {
        const sub = interaction.options.getSubcommand();

        // /package create
        if (sub === "create") {
          const userId = interaction.user.id;
          const draft = drafts.get(userId) || {
            name: "",
            purchase_link: "",
            asset_id: "",
            price: 0,
            packer_id: "",
            included_items: []
          };
          drafts.set(userId, draft);

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(IDS.create_edit).setLabel("Edit").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(IDS.create_submit).setLabel("Submit").setStyle(ButtonStyle.Primary)
          );

          await safeReply(interaction, { embeds: [packagePreviewEmbed(draft)], components: [row] }, { ephemeral: true });
          return;
        }

        // /package send
        if (sub === "send") {
          await safeReply(interaction, { content: "Check your DMs." }, { ephemeral: true });

          const dm = await interaction.user.createDM();
          const all = db.prepare("SELECT id, name FROM packages ORDER BY created_at DESC").all();
          if (!all.length) {
            await dm.send("No packages exist yet. Use `/package create` first.");
            return;
          }

          const pkgSelect = new StringSelectMenuBuilder()
            .setCustomId(IDS.send_pick_pkg)
            .setPlaceholder("Select a package")
            .addOptions(all.slice(0, 25).map((p) => ({ label: p.name, value: String(p.id) })));

          await dm.send({ content: "Select which package to send:", components: [new ActionRowBuilder().addComponents(pkgSelect)] });
          return;
        }

        // /package delete
        if (sub === "delete") {
          const all = db.prepare("SELECT id, name FROM packages ORDER BY created_at DESC").all();
          if (!all.length) {
            await safeReply(interaction, { content: "No packages to delete." }, { ephemeral: true });
            return;
          }

          const select = new StringSelectMenuBuilder()
            .setCustomId(`${IDS.delete_pick}:${interaction.user.id}`)
            .setPlaceholder("Select a package to delete")
            .addOptions(all.slice(0, 25).map((p) => ({ label: p.name, value: String(p.id) })));

          await safeReply(
            interaction,
            { content: "Select the package you want to delete:", components: [new ActionRowBuilder().addComponents(select)] },
            { ephemeral: true }
          );
          return;
        }
      }

      // ---------- Create flow ----------
      if (interaction.isButton() && interaction.customId === IDS.create_edit) {
        const userId = interaction.user.id;
        const draft = drafts.get(userId) || {
          name: "",
          purchase_link: "",
          asset_id: "",
          price: 0,
          packer_id: "",
          included_items: []
        };

        const modal = new ModalBuilder().setCustomId(IDS.create_modal).setTitle("Package Details");

        const name = new TextInputBuilder().setCustomId("name").setLabel("Package Name").setStyle(TextInputStyle.Short).setRequired(true).setValue(draft.name || "");
        const link = new TextInputBuilder().setCustomId("purchase_link").setLabel("Roblox Purchase Link").setStyle(TextInputStyle.Short).setRequired(true).setValue(draft.purchase_link || "");
        const packer = new TextInputBuilder().setCustomId("packer_id").setLabel("Packer Discord User ID (paste ID)").setStyle(TextInputStyle.Short).setRequired(true).setValue(draft.packer_id || "");
        const price = new TextInputBuilder().setCustomId("price").setLabel("Price (Robux)").setStyle(TextInputStyle.Short).setRequired(true).setValue(draft.price ? String(draft.price) : "");
        const items = new TextInputBuilder().setCustomId("items").setLabel("Included Items (one per line)").setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(draft.included_items?.join("\n") || "");

        modal.addComponents(
          new ActionRowBuilder().addComponents(name),
          new ActionRowBuilder().addComponents(link),
          new ActionRowBuilder().addComponents(packer),
          new ActionRowBuilder().addComponents(price),
          new ActionRowBuilder().addComponents(items)
        );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === IDS.create_modal) {
        const userId = interaction.user.id;

        const name = interaction.fields.getTextInputValue("name").trim();
        const purchase_link = interaction.fields.getTextInputValue("purchase_link").trim();
        const packer_id = interaction.fields.getTextInputValue("packer_id").trim();
        const priceRaw = interaction.fields.getTextInputValue("price").trim();
        const itemsRaw = interaction.fields.getTextInputValue("items").trim();

        const price = Number(priceRaw);
        const included_items = itemsRaw.split("\n").map((s) => s.trim()).filter(Boolean);

        const match = purchase_link.match(/\/(\d+)\b/);
        const asset_id = match ? match[1] : "";

        const draft = {
          name,
          purchase_link,
          asset_id,
          price: Number.isFinite(price) ? price : 0,
          packer_id,
          included_items
        };
        drafts.set(userId, draft);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(IDS.create_edit).setLabel("Edit").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(IDS.create_submit).setLabel("Submit").setStyle(ButtonStyle.Primary)
        );

        await safeReply(interaction, { embeds: [packagePreviewEmbed(draft)], components: [row] }, { ephemeral: true });
        return;
      }

      if (interaction.isButton() && interaction.customId === IDS.create_submit) {
        const userId = interaction.user.id;
        const draft = drafts.get(userId);

        if (!draft?.name || !draft.purchase_link || !draft.asset_id || !draft.price || !draft.packer_id || !draft.included_items?.length) {
          await safeReply(interaction, { content: "Your draft is missing fields. Click **Edit** and fill everything." }, { ephemeral: true });
          return;
        }

        db.prepare(`
          INSERT INTO packages (name, purchase_link, asset_id, price, packer_id, included_items, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(draft.name, draft.purchase_link, draft.asset_id, draft.price, draft.packer_id, JSON.stringify(draft.included_items), Date.now());

        await safeReply(interaction, { content: "✅ Package saved." }, { ephemeral: true });
        return;
      }

      // ---------- SEND wizard (DM) ----------
      if (interaction.isStringSelectMenu() && interaction.customId === IDS.send_pick_pkg) {
        const pkgId = Number(interaction.values[0]);
        const pkg = db.prepare("SELECT * FROM packages WHERE id=?").get(pkgId);

        if (!pkg) {
          await safeReply(interaction, { content: "Package not found." });
          return;
        }

        const send = db.prepare("INSERT INTO sends (user_id, package_id, forum_key, created_at) VALUES (?, ?, ?, ?)")
          .run(interaction.user.id, pkgId, "uniforms", Date.now());

        const sendId = send.lastInsertRowid;

        const forumSelect = new StringSelectMenuBuilder()
          .setCustomId(`${IDS.send_pick_forum}:${sendId}`)
          .setPlaceholder("Select forum type")
          .addOptions([
            { label: "Uniforms", value: "uniforms" },
            { label: "Graphics", value: "graphics" },
            { label: "Livery", value: "livery" }
          ]);

        await safeReply(interaction, {
          content: "Select which forum this should be posted in:",
          components: [new ActionRowBuilder().addComponents(forumSelect)]
        });

        await safeFollowUp(interaction, {
          content: "Now upload your package images here in DM.\nSend as many images as you want, then press **Done Images**."
        });

        await safeFollowUp(interaction, {
          content: "When finished uploading images:",
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${IDS.send_done_images}:${sendId}`).setLabel("Done Images").setStyle(ButtonStyle.Primary)
          )]
        });

        return;
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${IDS.send_pick_forum}:`)) {
        const [, sendIdStr] = interaction.customId.split(":");
        const sendId = Number(sendIdStr);
        const forumKey = interaction.values[0];

        db.prepare("UPDATE sends SET forum_key=? WHERE id=?").run(forumKey, sendId);
        await safeReply(interaction, { content: `✅ Forum set to **${forumKey}**.` });
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith(`${IDS.send_done_images}:`)) {
        const sendId = Number(interaction.customId.split(":")[1]);

        await safeReply(interaction, {
          content: "Now upload the **ZIP / product file** here in DM.\nAfter you upload it, press **Done File**."
        });

        await safeFollowUp(interaction, {
          content: "When finished uploading the file:",
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${IDS.send_done_file}:${sendId}`).setLabel("Done File").setStyle(ButtonStyle.Primary)
          )]
        });

        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith(`${IDS.send_done_file}:`)) {
        const sendId = Number(interaction.customId.split(":")[1]);

        const sendRow = db.prepare("SELECT * FROM sends WHERE id=?").get(sendId);
        if (!sendRow) return void (await safeReply(interaction, { content: "Send session not found." }));

        const pkg = db.prepare("SELECT * FROM packages WHERE id=?").get(sendRow.package_id);
        if (!pkg) return void (await safeReply(interaction, { content: "Package not found." }));

        const imgs = db.prepare("SELECT url FROM send_images WHERE send_id=?").all(sendId).map((r) => r.url);
        const fileRow = db.prepare("SELECT * FROM send_file WHERE send_id=?").get(sendId);
        if (!fileRow) return void (await safeReply(interaction, { content: "No product file recorded. Upload the file first." }));

        const forumId = cfg.forumChannels?.[sendRow.forum_key];
        if (!forumId) return void (await safeReply(interaction, { content: "Forum channel ID missing in config." }));

        const forum = await interaction.client.channels.fetch(forumId).catch(() => null);
        if (!forum || forum.type !== ChannelType.GuildForum) {
          await safeReply(interaction, { content: "Configured forum is not a forum channel." });
          return;
        }

        const imageEmbeds = imgs.slice(0, 10).map((url) => new EmbedBuilder().setImage(url));

        const thread = await forum.threads.create({
          name: pkg.name,
          message: { content: "", embeds: imageEmbeds }
        });

        db.prepare("UPDATE sends SET thread_id=? WHERE id=?").run(thread.id, sendId);

        const included = JSON.parse(pkg.included_items);
        const pkgObj = { ...pkg, included_items: included };
        await thread.send(buildThreadEmbed(pkgObj, `<@${pkg.packer_id}>`));

        await safeReply(interaction, { content: "✅ Posted to forum thread." });
        return;
      }

      // ---------- CLAIM (guild thread button) ----------
      if (interaction.isButton() && interaction.customId === IDS.claim) {
        await safeDeferReply(interaction, { ephemeral: true });

        const threadId = interaction.channel?.id;
        if (!threadId) return void (await interaction.editReply("Missing thread context."));

        const sendRow = db.prepare("SELECT * FROM sends WHERE thread_id=? ORDER BY created_at DESC LIMIT 1").get(threadId);
        if (!sendRow) return void (await interaction.editReply("This thread isn't linked to a send session."));

        const pkg = db.prepare("SELECT * FROM packages WHERE id=?").get(sendRow.package_id);
        if (!pkg) return void (await interaction.editReply("Package not found."));

        console.log("CLAIM CHECK:", {
          discordUserId: interaction.user.id,
          pkgId: pkg.id,
          pkgName: pkg.name,
          pkgAssetId: String(pkg.asset_id),
          threadId
        });

        const purchase = db.prepare(`
          SELECT * FROM purchases
          WHERE discord_user_id=?
            AND asset_id=?
            AND claimed_at IS NULL
          ORDER BY purchased_at DESC
          LIMIT 1
        `).get(interaction.user.id, String(pkg.asset_id));

        console.log("PURCHASE FOUND?", !!purchase, purchase ? {
          purchaseId: purchase.id,
          purchaseAssetId: purchase.asset_id,
          purchaseItemName: purchase.item_name,
          purchased_at: purchase.purchased_at
        } : null);

        if (!purchase) {
          await interaction.editReply("❌ No verified purchase found for your account.");
          return;
        }

        db.prepare("UPDATE purchases SET claimed_at=?, claimed_send_id=? WHERE id=?")
          .run(Date.now(), sendRow.id, purchase.id);

        const robloxUser = await getRobloxUsernameViaBloxlink(interaction.user.id);

        const dm = await interaction.user.createDM();
        const dmPayload = buildDmThanksComponents({
          robloxUser,
          price: pkg.price,
          productName: pkg.name,
          sendId: sendRow.id
        });

        const msg = await dm.send(dmPayload);

        db.prepare("UPDATE sends SET dm_message_id=?, dm_channel_id=? WHERE id=?")
          .run(msg.id, dm.channel.id, sendRow.id);

      await interaction.editReply(
      "📬 **Look at your DMs!**\nYour package has been sent there. Click **Download Product** to receive it."
    );
      return;

      // ---------- DOWNLOAD (DM button) ----------
      if (interaction.isButton() && interaction.customId.startsWith(`${IDS.download}:`)) {
        const sendId = Number(interaction.customId.split(":")[1]);

        // ✅ DMs cannot use ephemeral. Defer normally.
        await safeDeferReply(interaction);

        const fileRow = db.prepare("SELECT * FROM send_file WHERE send_id=?").get(sendId);
        if (!fileRow) return void (await interaction.editReply("File not found for this package."));

        const res = await fetch(fileRow.attachment_url);
        if (!res.ok) return void (await interaction.editReply("Could not fetch the product file."));

        const buf = Buffer.from(await res.arrayBuffer());
        const attachment = new AttachmentBuilder(buf, { name: fileRow.filename });

        await interaction.editReply({ content: "✅ Download:", files: [attachment] });
        return;
      }

      // ---------- DELETE flow (unchanged but kept) ----------
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${IDS.delete_pick}:`)) {
        const [, ownerId] = interaction.customId.split(":");
        if (ownerId !== interaction.user.id) return void (await safeReply(interaction, { content: "This delete menu isn't for you." }, { ephemeral: true }));

        const pkgId = Number(interaction.values[0]);
        const pkg = db.prepare("SELECT id, name FROM packages WHERE id=?").get(pkgId);
        if (!pkg) return void (await safeReply(interaction, { content: "Package not found." }, { ephemeral: true }));

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${IDS.delete_confirm}:${pkgId}:${interaction.user.id}`).setLabel("Yes, delete").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${IDS.delete_cancel}:${interaction.user.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
        );

        await safeReply(interaction, {
          content: `⚠️ Are you sure you want to delete **${pkg.name}**?\nThis will also delete any forum threads created for it.`,
          components: [row]
        }, { ephemeral: true });
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith(`${IDS.delete_cancel}:`)) {
        const ownerId = interaction.customId.split(":")[1];
        if (ownerId !== interaction.user.id) return void (await safeReply(interaction, { content: "Not your button." }, { ephemeral: true }));
        await safeReply(interaction, { content: "✅ Cancelled." }, { ephemeral: true });
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith(`${IDS.delete_confirm}:`)) {
        const [, pkgIdStr, ownerId] = interaction.customId.split(":");
        if (ownerId !== interaction.user.id) return void (await safeReply(interaction, { content: "Not your delete confirm." }, { ephemeral: true }));

        const pkgId = Number(pkgIdStr);
        const pkg = db.prepare("SELECT id, name FROM packages WHERE id=?").get(pkgId);
        if (!pkg) return void (await safeReply(interaction, { content: "Package already deleted / not found." }, { ephemeral: true }));

        const threads = db
          .prepare("SELECT thread_id FROM sends WHERE package_id=? AND thread_id IS NOT NULL")
          .all(pkgId)
          .map((r) => r.thread_id)
          .filter(Boolean);

        let deletedThreads = 0;
        for (const tid of threads) {
          try {
            const ch = await interaction.client.channels.fetch(tid).catch(() => null);
            if (ch && "delete" in ch) {
              await ch.delete(`Package deleted by ${interaction.user.tag}`);
              deletedThreads++;
            }
          } catch {}
        }

        const tx = db.transaction((id) => {
          const sendIds = db.prepare("SELECT id FROM sends WHERE package_id=?").all(id).map((r) => r.id);
          for (const sid of sendIds) {
            db.prepare("DELETE FROM send_images WHERE send_id=?").run(sid);
            db.prepare("DELETE FROM send_file WHERE send_id=?").run(sid);
          }
          db.prepare("DELETE FROM sends WHERE package_id=?").run(id);
          db.prepare("DELETE FROM packages WHERE id=?").run(id);
        });

        tx(pkgId);

        await safeReply(interaction, { content: `🗑️ Deleted **${pkg.name}**.\nDeleted forum threads: **${deletedThreads}**.` }, { ephemeral: true });
        return;
      }
    } catch (err) {
      console.error("interactionCreate error:", err);
      if (interaction?.isRepliable?.()) {
        try {
          await safeReply(interaction, { content: "Something went wrong. Check logs." }, { ephemeral: true });
        } catch {}
      }
    }
  });

  // -------------------- DM attachment capture --------------------
  client.on("messageCreate", async (msg) => {
    try {
      if (msg.author.bot) return;
      if (msg.channel.type !== ChannelType.DM) return;
      if (!msg.attachments.size) return;

      const recent = db
        .prepare("SELECT * FROM sends WHERE user_id=? AND created_at > ? ORDER BY created_at DESC LIMIT 1")
        .get(msg.author.id, Date.now() - 10 * 60 * 1000);

      if (!recent) return;

      for (const a of msg.attachments.values()) {
        const url = a.url;
        const name = a.name || "file.bin";
        const isImage =
          (a.contentType || "").startsWith("image/") ||
          /\.(png|jpe?g|webp|gif)$/i.test(name);

        if (isImage) {
          db.prepare("INSERT INTO send_images (send_id, url) VALUES (?, ?)").run(recent.id, url);
        } else {
          db.prepare("INSERT OR REPLACE INTO send_file (send_id, attachment_url, filename) VALUES (?, ?, ?)")
            .run(recent.id, url, name);
        }
      }
    } catch (e) {
      console.error("messageCreate attach collector error:", e);
    }
  });
}

/*
==================== YOUR CONFIG.JSON ====================
You currently have:

"packages": {
  "staffRoleId": "...",
  "storageChannelId": "...",
  "forumChannels": {...}
}

To make verified purchases work, ADD groupId:

"packages": {
  "staffRoleId": "1467409087515070464",
  "storageChannelId": "1467859186904731785",
  "groupId": 12345678,           // ✅ REQUIRED FOR VERIFICATION
  "pollMs": 20000,               // optional
  "forumChannels": {
    "uniforms": "1467859457726877850",
    "graphics": "1467855193415745619",
    "livery": "1467859474588110962"
  }
}

==================== ENV REQUIRED ====================
DISCORD_TOKEN=...
CLIENT_ID=...
BLOXLINK_API_KEY=...
ROBLOX_COOKIE=...        // .ROBLOSECURITY

==================== WHAT TO LOOK FOR IN LOGS ====================
After you buy + click claim:

1) You should see: SALE SEEN: { itemId: ..., buyerId: ... }
2) Then: BLOXLINK OK: { discordId: ... }
3) Then: ✅ PURCHASE STORED: { asset_id: ... }

When you click claim:
- CLAIM CHECK shows pkgAssetId
- PURCHASE FOUND? should be true

If SALE SEEN appears but PURCHASE FOUND is false → pkgAssetId != itemId (ID mismatch).
*/
