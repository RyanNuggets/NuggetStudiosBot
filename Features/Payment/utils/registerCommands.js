// Features/Payment/utils/registerCommands.js
// Upserts this feature's global slash commands without touching any other
// commands your bot already has registered - same pattern as the bot's
// existing payment.js reference file.

import { Routes } from "discord-api-types/v10";

async function upsertGlobalCommand(client, command) {
  const appId = client.application?.id;
  if (!appId) throw new Error("Missing application id.");

  const existing = await client.rest.get(Routes.applicationCommands(appId));
  const found = Array.isArray(existing) ? existing.find((c) => c?.name === command.name) : null;

  if (found?.id) {
    await client.rest.patch(Routes.applicationCommand(appId, found.id), { body: command });
    return "updated";
  }

  await client.rest.post(Routes.applicationCommands(appId), { body: command });
  return "created";
}

export async function registerPaymentCommands(client, commands) {
  for (const command of commands) {
    const result = await upsertGlobalCommand(client, command);
    console.log(`✅ [PAYMENT] Global slash command ${result}: /${command.name}`);
  }
}
