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

const ticketTypeLabel = (value) =>
  TICKET_TYPES.find((t) => t.value === value)?.label ?? value;

// ---------------- IDS ----------------
const IDS = {
  mainSelect: "dashboard_main_select",
  ticketTypeSelect: "support_ticket_type_select",
  modalBase: "support_enquiry_modal",
  modalInput: "support_enquiry_input",
  ticketActionsSelect: "ticket_actions_select"
};

// ---------------- HELPERS ----------------
const safeChannelName = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90);

const isSupport = (interaction, supportRoleId) => {
  const member = interaction.member;
  if (!member) return false;
  // member.roles can be a cache or array depending on partials; handle both
  const roles = member.roles?.cache ?? member.roles;
  return roles?.has ? roles.has(supportRoleId) : Array.isArray(roles) ? roles.includes(supportRoleId) : false;
};

// ---------------- BUILD TICKET MESSAGE ----------------
function buildTicketOpenPayload({ userId, supportRoleId, ticketTypeValue, enquiry }) {
  const typeLabel = ticketTypeLabel(ticketTypeValue);

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
              `## **Thank you for contacting Nugget Studios.**\n` +
              `> Thanks for reaching out to Nugget Studios. Your request has been received and is now in our queue. Please share all relevant details so we can assist you efficiently. While we review your ticket, we ask that you do not tag or message staff directly.\n\n` +
              `### **Ticket Information:**\n` +
              `> *User:* <@${userId}>\n` +
              `> *Ticket Type:* ${typeLabel}\n\n` +
              `### **Enquiry:**\n` +
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
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(1000);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Modal submit → create ticket
  if (interaction.isModalSubmit() && interaction.customId.startsWith(IDS.modalBase + ":")) {
    const ticketTypeValue = interaction.customId.split(":")[1];
    const enquiry = interaction.fields.getTextInputValue(IDS.modalInput);

    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: "Server only.", ephemeral: true });

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
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        {
          id: conf.supportRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages
          ]
        }
      ]
    });

    await client.rest.post(Routes.channelMessages(channel.id), {
      body: buildTicketOpenPayload({
        userId: interaction.user.id,
        supportRoleId: conf.supportRoleId,
        ticketTypeValue,
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

    // Only support can use this menu
    if (!isSupport(interaction, conf.supportRoleId)) {
      return interaction.reply({
        content: "Only the support team can use ticket actions.",
        ephemeral: true
      });
    }

    // Ticket can only be claimed once:
    // We'll "lock" the menu by editing the message components after claim.
    // If it's already been claimed, the menu placeholder will be changed to "Claimed by ..."
    const msg = interaction.message;
    const alreadyClaimed =
      msg?.components?.some((row) =>
        row.components?.some(
          (c) =>
            c.type === 3 &&
            c.customId === IDS.ticketActionsSelect &&
            (c.placeholder?.toLowerCase()?.includes("claimed") || c.disabled === true)
        )
      ) ?? false;

    if (action === "claim") {
      if (alreadyClaimed) {
        return interaction.reply({ content: "This ticket has already been claimed.", ephemeral: true });
      }

      const claimMessage = `Hello! My name is <@${interaction.user.id}> and I’ll be assisting you with this ticket.`;

      // Reply to the embed message
      await msg.reply({
        content: claimMessage,
        allowedMentions: { parse: ["users"] }
      });

      // Disable the actions menu so it can't be claimed again
      // (Also prevents close being used by multiple people if you want it locked; but support can still close via other means later.)
      try {
        const newComponents = msg.components.map((row) => {
          const rowJson = row.toJSON();
          rowJson.components = rowJson.components.map((c) => {
            if (c.type === 3 && c.custom_id === IDS.ticketActionsSelect) {
              return {
                ...c,
                disabled: true,
                placeholder: `Claimed by ${interaction.user.username}`
              };
            }
            return c;
          });
          return rowJson;
        });

        await msg.edit({ components: newComponents });
      } catch {
        // ignore if we can't edit
      }

      return interaction.reply({ content: "Ticket claimed.", ephemeral: true });
    }

    if (action === "close") {
      return interaction.reply({ content: "Closing ticket…", ephemeral: true }).then(() => {
        setTimeout(() => {
          interaction.channel?.delete("Ticket closed").catch(() => {});
        }, 3_000);
      });
    }
  }
}
