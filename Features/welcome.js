import { Events } from "discord.js";
import fs from "fs";

const readConfig = () => JSON.parse(fs.readFileSync("./config.json", "utf8"));

// Resolve welcome channel safely
async function resolveWelcomeChannel(guild, channelId) {
  if (!channelId) return null;

  let ch = guild.channels.cache.get(channelId);
  if (ch) return ch;

  try {
    ch = await guild.channels.fetch(channelId);
    return ch ?? null;
  } catch {
    return null;
  }
}

export default function registerWelcomeModule(client) {
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const conf = readConfig();
      const welcomeConf = conf?.welcome;

      if (!welcomeConf?.enabled) return;
      if (welcomeConf.guildId && member.guild.id !== welcomeConf.guildId) return;

      const channel = await resolveWelcomeChannel(member.guild, welcomeConf.channelId);
      if (!channel || !channel.isTextBased()) return;

      const serverCount = member.guild.memberCount;
      const emoji = "<:nspink:1467186922211377427>";

      const message =
        `\`-\` Welcome ${member} to ${emoji} **Nugget Studios**, ` +
        `we are now at **${serverCount}** members.`;

      await channel.send({
        content: message,
        allowedMentions: { users: [member.id] }
      });
    } catch (err) {
      console.error("[WELCOME] failed:", err);
    }
  });

  console.log("✅ Welcome module registered");
}
