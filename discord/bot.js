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

let statusMessage = null;
let updateInterval = null;
let statusChannelId = null;
let fetchWarningShown = false;

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
            },
            {
              name: 'kick',
              description: 'Force disconnect one or all bots',
              options: [
                {
                  name: 'bot',
                  description: 'Bot name or "all"',
                  type: 3, // String
                  required: true
                }
              ]
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
          if (!statusChannelId) {
            console.warn('[DISCORD] No channel ID set');
            return;
          }

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

          if (!channel || channel.type !== ChannelType.GuildText) {
            console.warn('[DISCORD] Channel no longer accessible');
            return;
          }

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
    }

    if (interaction.commandName === 'shards') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const bots = getBots();

        Object.values(bots).forEach(bot => {
          if (bot?.entity) {
            bot.chat('/shards');
          }
        });

        await new Promise(resolve => setTimeout(resolve, 8000));

        const embed = new EmbedBuilder()
          .setTitle('Bot Shard Balances')
          .setColor(0x9932cc)
          .setDescription('Latest shard counts (fresh query sent).')
          .setTimestamp();

        let totalShards = 0;
        let hasData = false;

        for (const [accountKey, bot] of Object.entries(bots)) {
          const mcName = bot?.username || 'Offline';
          const shards = bot.shards ?? null;

          let value = shards !== null ? `${shards.toLocaleString()} shards` : 'Unknown (awaiting response)';
          embed.addFields({
            name: `${mcName} (${accountKey})`,
            value,
            inline: true
          });

          if (shards !== null) {
            totalShards += shards;
            hasData = true;
          }
        }

        if (hasData) {
          embed.addFields({
            name: 'Total Shards (known)',
            value: totalShards.toLocaleString(),
            inline: false
          });
        } else {
          embed.setDescription(embed.description + '\n\nNo responses yet — try again in 10–15s.');
        }

        await interaction.editReply({ embeds: [embed] });

      } catch (err) {
        console.error('[DISCORD] /shards command error:', err);
        await interaction.editReply({ content: 'Error fetching shard data.' });
      }
    }

    if (interaction.commandName === 'kick') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const target = interaction.options.getString('bot');
        const bots = getBots();
        let result = '';

        Object.entries(bots).forEach(([name, bot]) => {
          if (target === 'all' || name === target) {
            if (bot?.entity) {
              try {
                bot.quit('Kicked via /kick command');
                result += `${name}: Disconnected\n`;
              } catch (quitErr) {
                result += `${name}: Disconnect failed - ${quitErr.message}\n`;
              }
            } else {
              result += `${name}: Already offline\n`;
            }
          }
        });

        await interaction.editReply({ content: result || 'No bots kicked' });
      } catch (err) {
        console.error('[DISCORD] /kick error:', err);
        await interaction.editReply({ content: 'Error during kick command.' });
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

  const anyOnline = Object.values(bots).some(b => b?.entity);
  embed.setColor(anyOnline ? 0x00ff00 : 0xff0000);

  let totalShards = 0;

  for (const [accountKey, bot] of Object.entries(bots)) {
    const accountName = accountKey;
    const mcUsername = bot?.username || 'Unknown (not logged in)';

    const extraStatus = getBotStatus(bot) || {};

    const statusLines = [];
    statusLines.push(`**Account (config):** ${accountName}`);
    statusLines.push(`**Minecraft Username:** ${mcUsername}`);

    const isOnline = !!bot?.entity;
    const isAlive = isOnline && (bot.health > 0);
    statusLines.push(`**Online:** ${isOnline ? '🟢 Yes' : '🔴 No'}`);
    statusLines.push(`**Alive:** ${isAlive ? 'Yes' : (isOnline ? 'No (dead)' : 'N/A')}`);

    if (isOnline) {
      const health = bot.health ?? 'N/A';
      const food = bot.food ?? 'N/A';
      const dimension = bot.game?.dimension ?? 'N/A';

      statusLines.push(`**Health:** ${health} ${health !== 'N/A' ? '♥' : ''}`);
      statusLines.push(`**Food:** ${food} ${food !== 'N/A' ? '🍗' : ''}`);
      statusLines.push(`**Dimension:** ${dimension}`);
    } else {
      statusLines.push('**Health / Food / Dimension:** N/A (offline)');
    }

    if (isOnline && bot.entity?.position) {
      const pos = bot.entity.position;
      statusLines.push(`**Position:** x:${Math.floor(pos.x)} y:${Math.floor(pos.y)} z:${Math.floor(pos.z)}`);
    }

    const shardsDisplay = extraStatus.shards !== null && extraStatus.shards !== undefined
      ? `${extraStatus.shards.toLocaleString()} shards`
      : 'Unknown';

    statusLines.push(`**Shards:** ${shardsDisplay}`);

    const fieldValue = statusLines.join('\n') || 'No data';

    embed.addFields({
      name: `${mcUsername} (${accountName})`,
      value: fieldValue,
      inline: false
    });

    if (typeof extraStatus.shards === 'number') {
      totalShards += extraStatus.shards;
    }

    if (extraStatus.scoreboard && Array.isArray(extraStatus.scoreboard.lines) && extraStatus.scoreboard.lines.length > 0) {
      const maxLines = cfg.discord?.scoreboardMaxLines || 10;
      const sbLines = extraStatus.scoreboard.lines.slice(0, maxLines);
      const sbValue = sbLines.join('\n') || '(empty)';
      embed.addFields({
        name: `Scoreboard - ${mcUsername}`,
        value: `\`\`\`\n${sbValue}\n\`\`\``,
        inline: false
      });
    }
  }

  embed.addFields({
    name: 'Total Shards (from known bots)',
    value: totalShards > 0 ? totalShards.toLocaleString() : 'N/A',
    inline: false
  });

  embed.setFooter({
    text: `Updated ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago' })} CST • Interval: ${(cfg.discord?.updateInterval || 10000) / 1000}s`
  });

  if (cfg.web?.enabled) {
    embed.addFields({
      name: 'Web Dashboard',
      value: `http://localhost:${cfg.web.port || 3000}${cfg.web.allowWebChat ? ' (chat enabled)' : ''}`,
      inline: false
    });
  }

  return embed;
}
