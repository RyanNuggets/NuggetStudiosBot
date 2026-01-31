import { Routes } from "discord-api-types/v10";
import {
  ActionRowBuilder,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder
} from "discord.js";
import fs from "fs";

const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));

// ---------------- HARDCODED: DASHBOARD (RAW COMPONENT LAYOUT) ----------------
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
              options: [{ label: "Support", value: "support", description: "Open a support ticket" }]
            }
          ]
        }
      ]
    }
  ]
};

// ---------------- HARDCODED: TICKET TYPES ----------------
const TICKET_TYPES = [
  { label: "General Support", value: "general", description: "Questions / help" },
  { label: "Order / Commission", value: "order", description: "Start / update an order" },
  { label: "Billing", value: "billing", description: "Payments / invoices" }
];

// ---------------- IDs (HARD-CODED) ----------------
const IDS = {
  mainSelect: "dashboard_main_select",
  ticketTypeSelect: "support_ticket_type_select",
  modalBase: "support_enquiry_modal",
  modalInput: "support_enquiry_input",
  ticketActionsSelect: "ticket_actions_select"
};

// ---------------- HELPERS ----------------
const shortId = () => Math.random().toString(36).slice(2, 8);

const safeChannelName = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);

// Build your RAW ticket-open message payload (component layout) with substitutions
function buildTicketOpenPayload({ userId, supportRoleId, ticketTypeLabel, enquiry }) {
  const pingLine = `-# <@${userId}> | <@&${supportRoleId}>`;

  const mainContent =
    `# **Thank you for contacting Nugget Studios.**  \n` +
    `> Thanks for reaching out to Nugget Studios. Your request has been received and is now in our queue. Please share all relevant details so we can assist you efficiently. While we review your ticket, we ask that you do not tag or message staff directly.\n\n` +
    `## **Ticket Information:**\n` +
    `> - **User:** <@${userId}>\n` +
    `> - **Ticket Type:** ${ticketTypeLabel}\n\n` +
    `## **Enquiry:**\n` +
    `> - *${enquiry}*`;

  return {
    flags: 32768,
    // Make sure mentions actually ping
    allowed_mentions: { parse: ["users", "roles"] },
    components: [
      { type: 10, content: pingLine },
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
          { type: 14, spacing: 2 },
          { type: 10, content: mainContent },
          { type: 14, spacing: 2 },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: IDS.ticketActionsSelect,
                placeholder: "Ticket Actions…",
                options: [
                  { label: "Claim", value: "claim", description: "Assign this ticket to you" },
                  { label: "Close", value: "close", description: "Close and delete this ticket" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

// ---------------- SEND DASHBOARD ----------------
export async function sendDashboard(client) {
  const conf = readConfig().dashboard;

  await client.rest.post(Routes.channelMessages(conf.dashboardChannelId), {
    body: DASHBOARD_LAYOUT
  });

  console.log("✅ Dashboard message sent");
}

// ---------------- INTERACTIONS ----------------
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

  // 3) Modal submit -> create ticket channel + perms + send RAW ticket embed
  if (interaction.isModalSubmit() && interaction.customId.startsWith(IDS.modalBase + ":")) {
    const type = interaction.customId.split(":")[1] || "unknown";
    const enquiry = interaction.fields.getTextInputValue(IDS.modalInput);

    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: "Server only.", ephemeral: true });

    const typeLabel = TICKET_TYPES.find((t) => t.value === type)?.label || type;

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

    // Send your NEW ticket embed message (raw component based)
    if (!supportRoleId) {
      await channel.send("⚠️ supportRoleId is missing in config.json.");
    } else {
      const payload = buildTicketOpenPayload({
        userId: interaction.user.id,
        supportRoleId,
        ticketTypeLabel: typeLabel,
        enquiry
      });

      await client.rest.post(Routes.channelMessages(channel.id), { body: payload });
    }

    return interaction.reply({
      content: `✅ Ticket created: <#${channel.id}>`,
      ephemeral: true
    });
  }

  // 4) Ticket actions select: Claim / Close
  if (interaction.isStringSelectMenu() && interaction.customId === IDS.ticketActionsSelect) {
    const action = interaction.values?.[0];
    const conf2 = readConfig().dashboard;

    // Basic check: must be in a guild text channel
    if (!interaction.guild || !interaction.channel) {
      return interaction.reply({ content: "Server only.", ephemeral: true });
    }

    // Optional check: only support role can claim/close
    const supportRoleId = conf2.supportRoleId;
    const member = await interaction.guild.members.fetch(interaction.user.id);

    if (supportRoleId && !member.roles.cache.has(supportRoleId)) {
      return interaction.reply({ content: "Only the support team can use this.", ephemeral: true });
    }

    if (action === "claim") {
      // Announce claim
      await interaction.channel.send(`✅ Ticket claimed by <@${interaction.user.id}>.`);
      return interaction.reply({ content: "Claimed.", ephemeral: true });
    }

    if (action === "close") {
      // Lock user from sending, then delete after 10 seconds
      const channel = interaction.channel;

      // Try to find the ticket opener (first mentioned user in channel perms)
      // We’ll just lock @everyone? No — lock the channel for non-staff is complex.
      // Simple: remove SendMessages from all overwrites except support role.
      try {
        // Deny send for everyone and ticket creator overwrite stays unless we edit it.
        // We’ll deny for the ticket creator if present:
        const overwrites = channel.permissionOverwrites.cache;

        // Find any overwrite that is a member (type=1) and deny SendMessages
        for (const [, ow] of overwrites) {
          if (ow.type === 1) {
            await channel.permissionOverwrites.edit(ow.id, {
              SendMessages: false
            });
          }
        }
      } catch {
        // ignore if perms fail
      }

      await interaction.reply({ content: "Closing ticket… deleting in 10 seconds.", ephemeral: true });

      setTimeout(async () => {
        try {
          await channel.delete("Ticket closed");
        } catch (e) {
          console.error("Failed to delete ticket channel:", e);
        }
      }, 10_000);

      return;
    }

    return interaction.reply({ content: "Unknown action.", ephemeral: true });
  }
}
