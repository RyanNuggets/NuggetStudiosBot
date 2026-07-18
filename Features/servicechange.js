// /Commands/servicechange.js
import { SlashCommandBuilder } from "discord.js";
import { readConfig, writeConfig } from "../Features/orderhub.js"; // adjust path to match your project structure

export const data = new SlashCommandBuilder()
  .setName("servicechange")
  .setDescription("Open or close a service so users can/can't start new orders.")
  .addStringOption((opt) =>
    opt
      .setName("service")
      .setDescription("Which service to change")
      .setRequired(true)
      .addChoices(
        { name: "Liveries", value: "liveries" },
        { name: "Graphics", value: "graphics" }
      )
  )
  .addStringOption((opt) =>
    opt
      .setName("set")
      .setDescription("Open or close the service")
      .setRequired(true)
      .addChoices(
        { name: "Open", value: "open" },
        { name: "Close", value: "close" }
      )
  );

export async function execute(interaction) {
  const conf = readConfig();
  const oh = conf.orderhub;

  if (!oh) {
    return interaction.reply({ content: "Missing `orderhub` block in config.json.", ephemeral: true });
  }

  // ---- ROLE LOCK ----
  // Add "serviceChangeRoleId" under "orderhub" in config.json with the role ID allowed to use this command.
  const requiredRoleId = oh.serviceChangeRoleId;
  if (!requiredRoleId) {
    return interaction.reply({
      content: "Missing **orderhub.serviceChangeRoleId** in config.json.",
      ephemeral: true
    });
  }

  const member = interaction.member;
  const roles = member?.roles?.cache ?? member?.roles;
  const hasRole = roles?.has ? roles.has(requiredRoleId) : Array.isArray(roles) ? roles.includes(requiredRoleId) : false;

  if (!hasRole) {
    return interaction.reply({
      content: "You don't have permission to use this command.",
      ephemeral: true
    });
  }

  const service = interaction.options.getString("service", true); // "liveries" | "graphics"
  const set = interaction.options.getString("set", true); // "open" | "close"

  // ---- UPDATE CONFIG ----
  if (!oh.serviceStatus) oh.serviceStatus = {};
  oh.serviceStatus[service] = set === "close" ? "closed" : "open";
  writeConfig(conf);

  const serviceLabel = service === "liveries" ? "Liveries" : "Graphics";
  const stateLabel = set === "close" ? "🔒 Closed" : "🟢 Open";

  return interaction.reply({
    content: `**${serviceLabel}** orders are now: **${stateLabel}**`,
    ephemeral: true
  });
}
