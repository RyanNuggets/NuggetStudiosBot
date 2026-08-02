import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";

const welcomeChannelId = "1485805832519159858";

async function handleGuildMemberAdd(member) {
    const guild = member.guild;
    const welcomeChannel = guild.channels.cache.get(welcomeChannelId);
    const membercount = guild.memberCount;

    if (!welcomeChannel) {
        console.error(`Channel with ID ${welcomeChannelId} not found.`);
        return;
    }

    const welcomeMessage = `Welcome to **<:nsgreen:1527102715371716688> Nugget Studios**, ${member}! We are now at **${membercount}** members.`;

    const mcButton = new ButtonBuilder()
        .setCustomId("mcButton")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji({
            id: "1527102715371716688",
            name: "nsgreen"
        })
        .setLabel(membercount.toString())
        .setDisabled(true);

    const getStartedButton = new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Dashboard")
        .setURL("https://discord.com/channels/1015000518889853028/1486640714128298135");

    const row = new ActionRowBuilder().addComponents(mcButton, getStartedButton);

    try {
        await welcomeChannel.send({ content: welcomeMessage, components: [row] });
    } catch (error) {
        console.error(`Failed to send welcome message: ${error}`);
    }
}

export default function registerWelcomeModule(client) {
    client.on("guildMemberAdd", (member) => {
        handleGuildMemberAdd(member).catch((err) =>
            console.error("Unhandled error in welcome module:", err)
        );
    });
}
