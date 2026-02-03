// In client.once('ready', ...)
body: [
  // ... existing commands ...
  {
    name: 'kick',
    description: 'Force disconnect a bot or all',
    options: [
      {
        name: 'bot',
        description: 'Bot config name or "all"',
        type: 3, // String
        required: true
      }
    ]
  }
]

// In interactionCreate
if (interaction.commandName === 'kick') {
  try {
    await interaction.deferReply({ ephemeral: true });

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