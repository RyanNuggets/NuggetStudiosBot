const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const { get } = require("http");

module.exports = {
    name: "guildMemberAdd",
    once: false,
    async execute(client, member) {
        const welcomeChannelId = "1485805832519159858";
        const welcomeChannel = member.guild.channels.cache.get(welcomeChannelId);

        const guild = member.guild;
        const membercount = guild.memberCount;

        // const roleId1 = "1498946139070660609";
// const role1 = guild.roles.cache.get(roleId1);

// if (role1) {
//     try {
//         await member.roles.add(role1);
//         console.log(`Assigned role ${role1.name} to ${member.user.tag}`);
//     } catch (error) {
//         console.error(`Failed to assign role1 to ${member.user.tag}: ${error}`);
//     }
// } else {
//     console.error(`Role with ID ${roleId1} not found.`);
// }

        if (welcomeChannel) {
            const welcomeMessage = `Welcome to **:nsgreen: Nugget Studios**, ${member}! We are now at **${membercount}** members.`;

            const mcButton = new ButtonBuilder()
                .setCustomId('mcButton')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji({
                id: "1527102715371716688",
                name: "nsgreen"
                })
                .setLabel(membercount.toString())
                .setDisabled(true);

                const getStartedButton = new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel('Dashboard')
              .setURL('https://discord.com/channels/1015000518889853028/1486640714128298135');            

            const row = new ActionRowBuilder().addComponents(mcButton, getStartedButton);

            try {
                await welcomeChannel.send({ content: `${welcomeMessage}`, components: [row] });
            } catch (error) {
                console.error(`Failed to send welcome message: ${error}`);
            }
        } else {
            console.error(`Channel with ID ${welcomeChannelId} not found.`);
        }
    }
};
