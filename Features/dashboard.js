import { Routes } from "discord-api-types/v10";
import {
  ActionRowBuilder,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import fs from "fs";

// ---------------- CONFIG ----------------
const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));

// ---------------- DASHBOARD LAYOUT ----------------
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
                url: "https://media.discordapp.net/attachments/1467051814733222043/1467051887936147486/Dashboard_1.png"
              }
            }
          ]
        },
        { type: 14 },
        {
          type: 10,
          content:
            "Nugget Studios is a commission-based design shop focused on clean, high-impact graphics for creators, communities, and game brands — from banners and Discord panels to uniforms, embeds, and polished promo visuals."
        },
        { type: 14 },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "dashboard_main_select",
              placeholder: "Select an option…",
              options: [{ label: "Support", value: "support" }]
            }
          ]
        }
      ]
    }
  ]
};

// ---------------- TICKET TYPES ----------------
const TICKET_TYPES = [
  { label: "General Support", value: "general" },
  { label: "Order / Commission", value: "order" },
  { label: "Billing", value: "billing" }
];

// ---------------- IDS ----------------
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
    .slice(0, 90);

// ---------------- BUILD TICKET MESSAGE ----------------
function buildTicketOpenPayload({ userId, supportRoleId, ticketType, enquiry }) {
  return {
    flags: 32768,
    allowed_mentions: { parse: ["users", "roles"] },
    components: [
      {
        type: 10,
        content: `-# <@${userId}> | <@&${supportRoleId}>`
      },
      {
        type: 17,
        components: [
          {
            type: 12,
            items: [
              {
                media: {
                  url: "https://media.discordapp.net/attachments/1467051814733222043/1467051887936147486/Dashboard_1.png"
                }
              }
            ]
          },
          { type: 14, spacing: 2 },
          {
            type: 10,
            content:
              `# **Thank you for contacting Nugget Studios.**\n` +
              `> Your request has been received and is now in our queue.\n\n` +
              `## **Ticket Information:**\n` +
              `> **User:** <@${userId}>\n` +
              `> **Ticket Type:** ${ticketType}\n\n` +
              `## **Enquiry:**\n` +
              `> *${enquiry}*`
          },
          { type: 14, spacing: 2 },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: IDS.ticketActionsSelect,
                placeholder: "Ticket Actions…",
                options: [
                  { label: "Claim", value: "claim" },
                  { label: "Close", value: "close" }
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

  console.log("✅ Dashboard sent");
}

// ---------------- INTERACTION HANDLER ----------------
export async function handleDashboardInteractions(client, interaction) {
  const { dashboard: conf } = readConfig();

  // Dashboard select
  if (interaction.isStringSelectMenu() && interaction.customId === IDS.mainSelect) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(IDS.ticketTypeSelect)
      .setPlaceholder("Choose ticket type…")
      .addOptions(TICKET_TYPES);

    return interaction.reply({
      content: "Select a ticket type:",
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: true
    });
  }

  // Ticket type → modal
  if (interaction.isStringSelectMenu() && interaction.customId === IDS.ticketTypeSelect) {
    const modal = new ModalBuilder()
      .setCustomId(`${IDS.modalBase}:${interaction.values[0]}`)
      .setTitle("Support Enquiry");

    const input = new TextInputBuilder()
      .setCustomId(IDS.modalInput)
      .setLabel("Describe your issue")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Modal submit → create ticket
  if (interaction.isModalSubmit() && interaction.customId.startsWith(IDS.modalBase)) {
    const ticketType = interaction.customId.split(":")[1];
    const enquiry = interaction.fields.getTextInputValue(IDS.modalInput);

    const guild = interaction.guild;
    const channelName = safeChannelName(
      conf.ticketChannelNameFormat.replace("{username}", interaction.user.username)
    );

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: conf.ticketCategoryId,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
        },
        {
          id: conf.supportRoleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
        }
      ]
    });

    await client.rest.post(Routes.channelMessages(channel.id), {
      body: buildTicketOpenPayload({
        userId: interaction.user.id,
        supportRoleId: conf.supportRoleId,
        ticketType,
        enquiry
      })
    });

    return interaction.reply({
      content: `You have successfully created a ticket. View your ticket ⁠<#${channel.id}>.`,
      ephemeral: true
    });
  }

  // ---------------- CLAIM / CLOSE ----------------
  if (interaction.isStringSelectMenu() && interaction.customId === IDS.ticketActionsSelect) {
    const action = interaction.values[0];

    // CLAIM
    if (action === "claim") {
      const claimMessage =
        `Hello! My name is <@${interaction.user.id}> and I’ll be assisting you with this ticket.`;

      await interaction.message.reply({
        content: claimMessage,
        allowedMentions: { parse: ["users"] }
      });

      return interaction.reply({ content: "Ticket claimed.", ephemeral: true });
    }

    // CLOSE
    if (action === "close") {
      await interaction.reply({ content: "Closing ticket in 10 seconds…", ephemeral: true });

      setTimeout(() => {
        interaction.channel.delete("Ticket closed").catch(() => {});
      }, 10_000);
    }
  }
}
