import { Routes } from "discord-api-types/v10";
import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import fs from "fs";

// Reads full config (guildId top-level, dashboard group inside)
const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));

// ---------- HARD-CODED DASHBOARD LAYOUT (YOUR NEW COMPONENT EMBED JSON) ----------
const DASHBOARD_LAYOUT = {
  flags: 32768,
  components: [
    {
      type: 17,
      components: [
        {
          type: 12,
          items: [
            {
              media: {
                url: "https://media.discordapp.net/attachments/1467051814733222043/1467051887936147486/Dashboard_1.png?ex=697efa0a&is=697da88a&hm=7f3d70a98d76fe62886d729de773f0d2d178184711381f185521366f88f93423&=&format=webp&quality=lossless&width=550&height=165"
              }
            }
          ]
        },
        { type: 14 },
        {
          type: 10,
          content:
            "Nugget Studios is a commission-based design shop focused on clean, high-impact graphics for creators, communities, and game brands — from banners and Discord panels to uniforms, embeds, and polished promo visuals. We keep it fast, professional, and consistent so your server looks premium everywhere."
        },
        { type: 14 },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "dashboard_main_select",
              placeholder: "Select an option…",
              options: [
                { label: "Support", value: "support", description: "Open a support ticket" }
              ]
            }
          ]
        }
      ]
    }
  ]
};

// ---------- HARD-CODED TICKET TYPES ----------
const TICKET_TYPES = [
  { label: "General Support", value: "general", description: "Questions / help" },
  { label: "Order / Commission", value: "order", description: "Start / update an order" },
  { label: "Billing", value: "billing", description: "Payments / invoices" }
];

// Component / modal IDs (hardcoded and stable)
const IDS = {
  mainSelect: "dashboard_main_select",
  ticketTypeSelect: "support_ticket_type_select",
  modalBase: "support_enquiry_modal",
  modalInput: "support_enquiry_input"
};

// ---------- HELPERS ----------
const shortId = () => Math.random().toString(36).slice(2, 8);

const safeChannelName = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);

// ---------- SEND DASHBOARD ----------
export async function sendDashboard(client) {
  const config = readConfig();
  const conf = config.dashboard;

  // Optional: ensure bot is in the right guild (not required, but sanity)
  // if (config.guildId && client.guilds.cache.has(config.guildId) === false) {
  //   console.warn("⚠️ Bot does not see guildId in cache yet.");
  // }

  await client.rest.post(Routes.channelMessages(conf.dashboardChannelId), {
    body: DASHBOARD_LAYOUT
  });

  console.log("✅ Dashboard message sent");
}

// ---------- INTERACTION HANDLER ----------
export async function handleDashboardInteractions(client, interaction) {
  const config = readConfig();
  const conf = config.dashboard;

  // 1) Dashboard dropdown -> show ephemeral ticket types select
  if (interaction.isStringSelectMenu() && interaction.customId === IDS.mainSelect) {
    const pick = interaction.values?.[0];

    if (pick !== "support") {
      return interaction.reply({ content: "Unknown option.", ephemeral: true });
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(IDS.ticketTypeSelect)
      .setPlaceholder("Choose a ticket type…")
      .addOptions(TICKET_TYPES);

    return interaction.reply({
      content: "Select one of the three ticket types:",
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: true
    });
  }

  // 2) Ticket type select -> show modal
  if (interaction.isStringSelectMenu() && interaction.customId === IDS.ticketTypeSelect) {
    const type = interaction.values?.[0] ?? "unknown";

    const modal = new ModalBuilder()
      .setCustomId(`${IDS.modalBase}:${type}`)
      .setTitle("Support Enquiry");

    const input = new TextInputBuilder()
      .setCustomId(IDS.modalInput)
      .setLabel("What do you need help with?")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Describe your issue clearly…")
      .setMinLength(10)
      .setMaxLength(1000)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));

    return interaction.showModal(modal);
  }

  // 3) Modal submit -> create ticket channel + perms + send embed
  if (interaction.isModalSubmit() && interaction.customId.startsWith(IDS.modalBase + ":")) {
    const type = interaction.customId.split(":")[1] || "unknown";
    const enquiry = interaction.fields.getTextInputValue(IDS.modalInput);

    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: "Server only.", ephemeral: true });

    const typeLabel = TICKET_TYPES.find((t) => t.value === type)?.label || type;

    // Channel name from format
    const nameRaw = (conf.ticketChannelNameFormat || "ticket-{username}-{shortId}")
      .replace("{username}", interaction.user.username)
      .replace("{shortId}", shortId());

    const channelName = safeChannelName(nameRaw);

    const categoryId = conf.ticketCategoryId || null;
    const supportRoleId = conf.supportRoleId || null;

    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      }
    ];

    if (supportRoleId) {
      overwrites.push({
        id: supportRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages
        ]
      });
    }

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: overwrites
    });

    // Hardcoded ticket embed (we’ll edit later)
    const embed = new EmbedBuilder()
      .setTitle("Thanks for contacting support!")
      .setDescription(
        `A team member will respond soon.\n\n` +
          `**Type:** ${typeLabel}\n` +
          `**User:** <@${interaction.user.id}>\n\n` +
          `**Enquiry:**\n${enquiry}`
      )
      .setColor(0xffffff)
      .setFooter({ text: "Nugget Studios Support" });

    await channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [embed]
    });

    return interaction.reply({
      content: `✅ Ticket created: <#${channel.id}>`,
      ephemeral: true
    });
  }
}
