const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder,
  MessageFlags,
  ChannelType
} = require('discord.js');
const { getConfig } = require('../utils/configLoader');
const { getBotStatus } = require('../utils/status');

// The Discord integration spawns a client that listens for commands.
// It supports /send-embed for live status and /shards for shard counts.

let statusMessage = null;
let updateInterval = null;
let statusChannelId = null;
let fetchWarningShown = false;

/**
 * Start the Discord bot. Pass a function that returns the current
 * dictionary of bots.
 * @param {Function} getBots A function returning an object of bots
 */
module.exports = function startDiscordBot(getBots) {
  const cfg = getConfig();
  if (!cfg.discord || !cfg.discord.enabled) {
    console.log('[DISCORD] Disabled in config');
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', async () => {
    console.log(`[DISCORD] Bot connected as ${client.user.tag}`);
    try {
      const rest = new REST({ version: '10' }).setToken(cfg.discord.token);
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, cfg.discord.guildId),
        {
          body: [
            {
              name: 'send-embed',
              description: 'Send an embed with live bot statuses'
            },
            {
              name: 'shards',
              description: 'Show current shard count for each bot'
            }
          ]
        }
      );
      console.log('[DISCORD] Slash commands registered');
    } catch (err) {
      console.error('[DISCORD] Failed to register slash commands:', err);
    }
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'send-embed') {
      try {
        await interaction.reply({
          content: 'Status embed started. It will update automatically.',
          flags: MessageFlags.Ephemeral
        });

        statusChannelId = interaction.channelId;

        if (updateInterval) {
          clearInterval(updateInterval);
          updateInterval = null;
        }
        statusMessage = null;

        const sendOrEdit = async () => {
          if (!statusChannelId) return;

          let channel;
          try {
            channel = await client.channels.fetch(statusChannelId);
          } catch (fetchErr) {
            if (!fetchWarningShown) {
              console.warn('[DISCORD] Failed to fetch channel:', fetchErr.message);
              fetchWarningShown = true;
            }
            return;
          }

          if (!channel || channel.type !== ChannelType.GuildText) return;

          const bots = getBots();
          const cfg = getConfig();
          const embed = buildEmbed(bots, cfg);

          try {
            if (!statusMessage) {
              statusMessage = await channel.send({ embeds: [embed] });
            } else {
              await statusMessage.edit({ embeds: [embed] });
            }
          } catch (err) {
            console.error('[DISCORD] Failed to send/edit embed:', err.message);

            try {
              statusMessage = await channel.send({ embeds: [embed] });
            } catch (fallbackErr) {
              console.error('[DISCORD] Fallback send failed:', fallbackErr.message);
            }
          }
        };

        await sendOrEdit();

        updateInterval = setInterval(async () => {
          await sendOrEdit();
        }, cfg.discord.updateInterval || 10000);

      } catch (err) {
        console.error('[DISCORD] Interaction handling error:', err);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: 'An error occurred while starting the status embed.',
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }
    } else if (interaction.commandName === 'shards') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const bots = getBots();
        const embed = new EmbedBuilder()
          .setTitle('Bot Shard Balances')
          .setColor(0x9932cc)
          .setDescription('Shard counts from last /shards query.')
          .setTimestamp();

        let total = 0;
        let knownCount = 0;

        for (const [accountKey, bot] of Object.entries(bots)) {
          const mcName = bot?.username || 'Offline';
          const shards = bot.shards;

          let value = shards !== null ? `${shards.toLocaleString()} shards` : 'Unknown';
          embed.addFields({ name: `${mcName} (${accountKey})`, value, inline: true });

          if (shards !== null) {
            total += shards;
            knownCount++;
          }
        }

        if (knownCount > 0) {
          embed.addFields({ name: 'Total Shards', value: total.toLocaleString(), inline: false });
        } else {
          embed.setDescription('No shard data yet. Wait for bots to query /shards.');
        }

        await interaction.editReply({ embeds: [embed] });

      } catch (err) {
        console.error('[DISCORD] /shards error:', err);
        await interaction.editReply({ content: 'Error fetching shards.' });
      }
    }
  });

  client.login(cfg.discord.token).catch(err => {
    console.error('[DISCORD] Login failed:', err);
  });
};

/**
 * Build an embed containing the status for all bots.
 */
function buildEmbed(bots, cfg) {
  const embed = new EmbedBuilder()
    .setTitle('DonutSMP Farm Bots - Live Status')
    .setTimestamp();

  const anyOnline = Object.values(bots).some(bot => bot?.entity);
  embed.setColor(anyOnline ? 0x00ff00 : 0xff0000);

  let totalShards = 0;

  for (const [accountKey, bot] of Object.entries(bots)) {
    const statusObj = getBotStatus(bot) || {};

    const accountName = accountKey;
    const mcUsername = bot?.username || 'Unknown';

    const statusLines = [];
    statusLines.push(`**Account:** ${accountName}`);
    statusLines.push(`**Username:** ${mcUsername}`);

    const isOnline = !!bot?.entity;
    const isAlive = statusObj.alive ?? (isOnline && (bot.health > 0));
    statusLines.push(`**Online:** ${isOnline ? '🟢 Yes' : '🔴 No'}`);
    statusLines.push(`**Alive:** ${isAlive ? 'Yes' : 'No'}`);

    const health = statusObj.health ?? bot?.health ?? 'N/A';
    const food = statusObj.food ?? bot?.food ?? 'N/A';
    const dimension = statusObj.dimension ?? bot?.game?.dimension ?? 'N/A';

    statusLines.push(`**Health:** ${health}`);
    statusLines.push(`**Food:** ${food}`);
    statusLines.push(`**Dimension:** ${dimension}`);

    if (statusObj.position || bot?.entity?.position) {
      const pos = statusObj.position || `${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}`;
      statusLines.push(`**Position:** ${pos}`);
    }

    const shards = bot.shards ?? 'Unknown';
    statusLines.push(`**Shards:** ${shards}`);

    const fieldValue = statusLines.join('\n');

    embed.addFields({
      name: `${mcUsername} (${accountName})`,
      value: fieldValue || 'No data',
      inline: false
    });

    if (bot.shards !== null) totalShards += bot.shards;

    if (statusObj.scoreboard && Array.isArray(statusObj.scoreboard.lines)) {
      const sbLines = statusObj.scoreboard.lines.slice(0, cfg.discord?.scoreboardMaxLines || 10);
      const sbValue = sbLines.join('\n') || '(empty)';
      embed.addFields({
        name: `Scoreboard - ${mcUsername}`,
        value: `\`\`\`\n${sbValue}\n\`\`\``,
        inline: false
      });
    }
  }

  embed.addFields({ name: 'Total Shards', value: totalShards.toLocaleString() || 'N/A', inline: false });

  if (cfg.web?.enabled) {
    embed.setFooter({ text: `Web dashboard: http://localhost:${cfg.web.port || 3000}` });
  }

  return embed;
}
