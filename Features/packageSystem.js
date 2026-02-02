// packageSystem.js (FULL FIXED SCRIPT FOR YOUR CONFIG)
// ✅ Works with your existing config.packages.forumChannels
// ✅ Adds purchase verification (requires adding packages.groupId + ROBLOX_COOKIE)
// ✅ Fixes DM download interaction failed (no ephemeral in DMs + defer/editReply)
// ✅ Fixes claim timeout (deferReply)
// ✅ Keeps your send wizard + forum posting logic

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

    -- ✅ Purchases for claim validation
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL,
      roblox_user_id TEXT,
      roblox_username TEXT,
      asset_id TEXT NOT NULL,
      amount INTEGER,
      purchased_at INTEGER NOT NULL,
      claimed_at INTEGER,
      claimed_send_id INTEGER
    );

    -- ✅ Meta table for watcher
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
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, String(value));
}

// -------------------- Helpers: Ephemeral only in guilds --------------------
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

// Roblox -> Discord (guild-scoped) for purchase watcher
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

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: [cmd.toJSON()]
  });
}

// -------------------- UI IDs --------------------
const IDS = {
  // create flow
  create_edit: "pkg_create_edit",
  create_submit: "pkg_create_submit",
  create_modal: "pkg_create_modal",

  // send flow
  send_pick_pkg: "pkg_send_pick_pkg",
  send_pick_forum: "pkg_send_pick_forum",
  send_done_images: "pkg_send_done_images",
  send_done_file: "pkg_send_done_file",

  // thread embed claim + dm download
  claim: "pkg_claim",
  download: "pkg_download",

  // delete flow
  delete_pick: "pkg_delete_pick",
  delete_confirm: "pkg_delete_confirm",
  delete_cancel: "pkg_delete_cancel"
};

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
        title: `[${pkg.name}](${pkg.purchase_link})`,
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

// -------------------- Purchase watcher (Roblox GROUP sales) --------------------
// ✅ You must add config.packages.groupId for this to work.
// Without groupId, CLAIM will block because no purchases can be verified.
async function startPurchaseWatcher({ db, discordGuildId, groupId, pollMs = 20000 }) {
  const cookie = process.env.ROBLOX_COOKIE; // .ROBLOSECURITY
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
  if (!existing) metaSet(db, metaKey, Date.now()); // start now so we don't import history

  setInterval(async () => {
    try {
      const lastTs = Number(metaGet(db, metaKey) || Date.now());
      const txns = await noblox.getGroupTransactions(Number(groupId), "Sale");
      const sorted = [...txns].sort((a, b) => new Date(a.created) - new Date(b.created));

      let newestSeen = lastTs;

      for (const t of sorted) {
        const createdMs = new Date(t.created).getTime();
        if (!Number.isFinite(createdMs)) continue;
        if (createdMs <= lastTs) continue;

        const robloxBuyerId = t.agent?.id ?? null;
        const robloxBuyerName = t.agent?.name ?? null;
        const itemId = t.details?.id ?? null; // asset id
        const amount = t.currency?.amount ?? null;

        if (!robloxBuyerId || !itemId) {
          newestSeen = Math.max(newestSeen, createdMs);
          continue;
        }

        const discordId = await getDiscordIdFromBloxlink(String(robloxBuyerId), discordGuildId);
        if (!discordId) {
          newestSeen = Math.max(newestSeen, createdMs);
          continue;
        }

        const existsRow = db.prepare(`
          SELECT 1 FROM purchases
          WHERE discord_user_id=? AND asset_id=? AND purchased_at=?
          LIMIT 1
        `).get(String(discordId), String(itemId), createdMs);

        if (!existsRow) {
          db.prepare(`
            INSERT INTO purchases (discord_user_id, roblox_user_id, roblox_username, asset_id, amount, purchased_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            String(discordId),
            String(robloxBuyerId),
            robloxBuyerName ? String(robloxBuyerName) : null,
            String(itemId),
            amount !== null ? Number(amount) : null,
            createdMs
          );
        }

        newestSeen = Math.max(newestSeen, createdMs);
      }

      if (newestSeen > lastTs) metaSet(db, metaKey, newestSeen);
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

  client.once("ready", async () => {
    try {
      const token = process.env.DISCORD_TOKEN;
      const clientId = process.env.CLIENT_ID;

      if (!token) throw new Error("Missing env DISCORD_TOKEN");
      if (!clientId) throw new Error("Missing env CLIENT_ID");

      await registerCommands({ token, clientId, guildId });
      console.log("✅ Slash commands registered.");

      // ✅ Start purchase watcher if groupId is provided
      await startPurchaseWatcher({
        db,
        discordGuildId: guildId,
        groupId: cfg.groupId,     // <-- add this to config.json
        pollMs: cfg.pollMs || 20000
      });
    } catch (e) {
      console.error("❌ Startup failed:", e);
    }
  });

  const drafts = new Map(); // userId -> draft

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

          await safeReply(
            interaction,
            { embeds: [packagePreviewEmbed(draft)], components: [row] },
            { ephemeral: true }
          );
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

          await dm.send({
            content: "Select which package to send:",
            components: [new ActionRowBuilder().addComponents(pkgSelect)]
          });
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

        const name = new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Package Name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(draft.name || "");

        const link = new TextInputBuilder()
          .setCustomId("purchase_link")
          .setLabel("Roblox Purchase Link")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(draft.purchase_link || "");

        const packer = new TextInputBuilder()
          .setCustomId("packer_id")
          .setLabel("Packer Discord User ID (paste ID)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(draft.packer_id || "");

        const price = new TextInputBuilder()
          .setCustomId("price")
          .setLabel("Price (Robux)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(draft.price ? String(draft.price) : "");

        const items = new TextInputBuilder()
          .setCustomId("items")
          .setLabel("Included Items (one per line)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue(draft.included_items?.join("\n") || "");

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

        db.prepare(
          `INSERT INTO packages (name, purchase_link, asset_id, price, packer_id, included_items, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(draft.name, draft.purchase_link, draft.asset_id, draft.price, draft.packer_id, JSON.stringify(draft.included_items), Date.now());

        await safeReply(interaction, { content: "✅ Package saved." }, { ephemeral: true });
        return;
      }

      // ---------- SEND flow ----------
      if (interaction.isStringSelectMenu() && interaction.customId === IDS.send_pick_pkg) {
        const pkgId = Number(interaction.values[0]);
        const pkg = db.prepare("SELECT * FROM packages WHERE id=?").get(pkgId);

        if (!pkg) {
          await safeReply(interaction, { content: "Package not found." });
          return;
        }

        const send = db
          .prepare("INSERT INTO sends (user_id, package_id, forum_key, created_at) VALUES (?, ?, ?, ?)")
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
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`${IDS.send_done_images}:${sendId}`).setLabel("Done Images").setStyle(ButtonStyle.Primary)
            )
          ]
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
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`${IDS.send_done_file}:${sendId}`).setLabel("Done File").setStyle(ButtonStyle.Primary)
            )
          ]
        });

        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith(`${IDS.send_done_file}:`)) {
        const sendId = Number(interaction.customId.split(":")[1]);

        const sendRow = db.prepare("SELECT * FROM sends WHERE id=?").get(sendId);
        if (!sendRow) {
          await safeReply(interaction, { content: "Send session not found." });
          return;
        }

        const pkg = db.prepare("SELECT * FROM packages WHERE id=?").get(sendRow.package_id);
        if (!pkg) {
          await safeReply(interaction, { content: "Package not found." });
          return;
        }

        const imgs = db.prepare("SELECT url FROM send_images WHERE send_id=?").all(sendId).map((r) => r.url);
        const fileRow = db.prepare("SELECT * FROM send_file WHERE send_id=?").get(sendId);

        if (!fileRow) {
          await safeReply(interaction, { content: "No product file recorded. Upload the file first." });
          return;
        }

        const forumId = cfg.forumChannels?.[sendRow.forum_key];
        if (!forumId) {
          await safeReply(interaction, { content: "Forum channel ID missing in config." });
          return;
        }

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

      // ---------- CLAIM ----------
      if (interaction.isButton() && interaction.customId === IDS.claim) {
        await safeDeferReply(interaction, { ephemeral: true });

        const threadId = interaction.channel?.id;
        if (!threadId) {
          await interaction.editReply("Missing thread context.");
          return;
        }

        const sendRow = db.prepare("SELECT * FROM sends WHERE thread_id=? ORDER BY created_at DESC LIMIT 1").get(threadId);
        if (!sendRow) {
          await interaction.editReply("This thread isn't linked to a send session.");
          return;
        }

        const pkg = db.prepare("SELECT * FROM packages WHERE id=?").get(sendRow.package_id);
        if (!pkg) {
          await interaction.editReply("Package not found.");
          return;
        }

        // ✅ Must have a verified purchase (Roblox group sale watcher writes these)
        const purchase = db.prepare(`
          SELECT * FROM purchases
          WHERE discord_user_id=?
            AND asset_id=?
            AND claimed_at IS NULL
          ORDER BY purchased_at DESC
          LIMIT 1
        `).get(interaction.user.id, String(pkg.asset_id));

        if (!purchase) {
          await interaction.editReply("❌ No verified purchase found for your account. Please buy the product first.");
          return;
        }

        db.prepare(`
          UPDATE purchases
          SET claimed_at=?, claimed_send_id=?
          WHERE id=?
        `).run(Date.now(), sendRow.id, purchase.id);

        const robloxUser = await getRobloxUsernameViaBloxlink(interaction.user.id);

        const dm = await interaction.user.createDM();
        const dmPayload = buildDmThanksComponents({
          robloxUser,
          price: pkg.price,
          productName: pkg.name,
          sendId: sendRow.id
        });

        const msg = await dm.send(dmPayload);

        db.prepare("UPDATE sends SET dm_message_id=?, dm_channel_id=? WHERE id=?").run(msg.id, dm.channel.id, sendRow.id);

        await interaction.editReply("✅ Check your DMs.");
        return;
      }

      // ---------- DOWNLOAD (DM button) ----------
      if (interaction.isButton() && interaction.customId.startsWith(`${IDS.download}:`)) {
        const sendId = Number(interaction.customId.split(":")[1]);

        // ✅ DMs can't do ephemeral. Defer normally.
        await safeDeferReply(interaction);

        const fileRow = db.prepare("SELECT * FROM send_file WHERE send_id=?").get(sendId);
        if (!fileRow) {
          await interaction.editReply("File not found for this package.");
          return;
        }

        const res = await fetch(fileRow.attachment_url);
        if (!res.ok) {
          await interaction.editReply("Could not fetch the product file.");
          return;
        }

        const buf = Buffer.from(await res.arrayBuffer());
        const attachment = new AttachmentBuilder(buf, { name: fileRow.filename });

        await interaction.editReply({ content: "✅ Download:", files: [attachment] });
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
        const isImage = (a.contentType || "").startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name);

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
==================== IMPORTANT CONFIG CHANGE ====================
Your current config.json packages block is missing groupId.

Add this:

"packages": {
  "staffRoleId": "1467409087515070464",
  "storageChannelId": "1467859186904731785",
  "groupId": 12345678,                 <-- ✅ ADD THIS (Roblox group id)
  "pollMs": 20000,                     <-- optional
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
ROBLOX_COOKIE=...   (.ROBLOSECURITY)

If you do NOT sell via group sales, the watcher cannot verify purchases.
*/
