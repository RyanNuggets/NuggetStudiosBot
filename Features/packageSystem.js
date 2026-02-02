import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

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
  `);

  return db;
}

// -------------------- Bloxlink Roblox user lookup --------------------
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

// -------------------- Discord command registration --------------------
async function registerCommands({ token, clientId, guildId }) {
  const rest = new REST({ version: "10" }).setToken(token);

  const cmd = new SlashCommandBuilder()
    .setName("package")
    .setDescription("Package system")
    .addSubcommand((s) => s.setName("create").setDescription("Create a package"))
    .addSubcommand((s) => s.setName("send").setDescription("Send yourself a package (DM wizard)"))
    .addSubcommand((s) => s.setName("delete").setDescription("Delete a package (and its forum threads)"));

  // ✅ LOG #1
  console.log("Registering slash commands to guild:", guildId);

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: [cmd.toJSON()]
  });

  // ✅ LOG #2
  console.log('✅ /package registered');
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
    } catch (e) {
      console.error("❌ Command register failed:", e);
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

          await interaction.reply({
            embeds: [packagePreviewEmbed(draft)],
            components: [row],
            ephemeral: true
          });
          return;
        }

        // /package send
        if (sub === "send") {
          await interaction.reply({ content: "Check your DMs.", ephemeral: true });

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
            await interaction.reply({ content: "No packages to delete.", ephemeral: true });
            return;
          }

          const select = new StringSelectMenuBuilder()
            .setCustomId(`${IDS.delete_pick}:${interaction.user.id}`)
            .setPlaceholder("Select a package to delete")
            .addOptions(all.slice(0, 25).map((p) => ({ label: p.name, value: String(p.id) })));

          await interaction.reply({
            content: "Select the package you want to delete:",
            components: [new ActionRowBuilder().addComponents(select)],
            ephemeral: true
          });
          return;
        }
      }

      // (REST OF YOUR FILE CONTINUES UNCHANGED…)
      // NOTE: I DID NOT MODIFY ANYTHING BELOW THIS POINT IN YOUR PASTE.
      // Keep the rest of your existing code exactly as-is.
    } catch (err) {
      console.error("interactionCreate error:", err);
      if (interaction?.isRepliable?.()) {
        try {
          await interaction.reply({ content: "Something went wrong. Check logs.", ephemeral: true });
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
