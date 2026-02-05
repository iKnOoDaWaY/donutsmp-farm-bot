<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>DonutSMP Farm Bot Dashboard</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      margin: 0;
      padding: 20px;
    }
    h1, h2 {
      color: #58a6ff;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    select {
      padding: 8px;
      background: #161b22;
      color: #c9d1d9;
      border: 1px solid #30363d;
      border-radius: 6px;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 15px;
    }
    .indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .online { background: #3fb950; }
    .offline { background: #f85149; }
    #skin {
      width: 64px;
      height: 64px;
      image-rendering: pixelated;
      border-radius: 6px;
    }
    #chat {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 12px;
      height: 300px;
      overflow-y: auto;
      margin-bottom: 10px;
      font-family: monospace;
      font-size: 14px;
    }
    #input {
      width: 100%;
      padding: 10px;
      background: #0d1117;
      color: #c9d1d9;
      border: 1px solid #30363d;
      border-radius: 6px;
      box-sizing: border-box;
    }
    #viewer-btn {
      margin-top: 12px;
      padding: 8px 16px;
      background: #238636;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }
    #viewer-btn:hover {
      background: #2ea043;
    }
    #viewer-btn:disabled {
      background: #444c56;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>DonutSMP Farm Bot Dashboard</h1>
      <select id="botSelect">
        <option value="">Select a bot</option>
      </select>
    </div>

    <div class="card">
      <div class="status">
        <div id="status-indicator" class="indicator offline"></div>
        <h2 id="username">No bot selected</h2>
        <img id="skin" src="" alt="Skin">
      </div>

      <div id="chat"></div>
      <input id="input" type="text" placeholder="Type message and press Enter..." style="display: none;">

      <button id="viewer-btn" disabled>View in 3D</button>
    </div>
  </div>

<script>
// Client side script for the web dashboard. Handles selecting
// between multiple bots, displaying chat logs, updating status
// indicators, sending messages, and opening 3D viewer.

const socket = io();

const chatEl          = document.getElementById('chat');
const inputEl         = document.getElementById('input');
const usernameEl      = document.getElementById('username');
const skinEl          = document.getElementById('skin');
const botSelect       = document.getElementById('botSelect');
const statusIndicator = document.getElementById('status-indicator');

// Maintain a log of messages per bot so switching preserves history
const messageLogs = {};

// Store latest status for all bots (keyed by config username)
let botsStatus = {};

// Currently selected bot (config username)
let selectedBot = null;

// When server broadcasts bot statuses → update dropdown + UI
socket.on('bots', data => {
  botsStatus = data || {};
  updateSelectOptions();
  
  // Auto-select first bot if none chosen yet and one exists
  if (!selectedBot || !botsStatus[selectedBot]) {
    selectedBot = Object.keys(botsStatus).find(key => botsStatus[key]?.online) || Object.keys(botsStatus)[0] || null;
  }
  
  updateUI();
  renderChat(); // Refresh chat if selection changed implicitly
});

// Append incoming chat messages
socket.on('chat', ({ username, botUsername, chatUsername, message }) => {
  if (!messageLogs[username]) messageLogs[username] = [];
  messageLogs[username].push({ botUsername, chatUsername, message });
  
  if (username === selectedBot) {
    appendChat(botUsername, chatUsername, message);
  }
});

// Maintenance result (for debugging if you use it)
socket.on('maintenance-result', (data) => {
  console.log(`[MAINTENANCE RESPONSE] ${data.message}`);
});

// Dropdown change → update selected bot and UI
botSelect.addEventListener('change', () => {
  selectedBot = botSelect.value;
  renderChat();
  updateUI();
});

// Enter key → send chat message to selected bot
inputEl.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (!selectedBot) return;
  if (inputEl.style.display === 'none') return;
  
  const msg = inputEl.value.trim();
  if (!msg) return;
  
  socket.emit('sendMessage', { username: selectedBot, message: msg });
  inputEl.value = '';
});

/**
 * Rebuild dropdown options from botsStatus
 */
function updateSelectOptions() {
  botSelect.innerHTML = '<option value="">Select a bot</option>';
  
  Object.entries(botsStatus).forEach(([id, status]) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = status.minecraftUsername || status.botUsername || id;
    if (status.online) option.style.color = '#00ff00';
    botSelect.appendChild(option);
  });
  
  // Restore previous selection if still valid
  if (selectedBot && botsStatus[selectedBot]) {
    botSelect.value = selectedBot;
  }
}

/**
 * Update username, skin, status indicator, chat input visibility,
 * and show/hide the 3D Viewer button
 */
function updateUI() {
  if (!selectedBot || !botsStatus[selectedBot]) {
    usernameEl.textContent = 'No bot selected';
    skinEl.src = '';
    statusIndicator.classList.remove('online');
    statusIndicator.classList.add('offline');
    inputEl.style.display = 'none';
    hideViewerButton();
    return;
  }

  const status = botsStatus[selectedBot];
  
  usernameEl.textContent = status.minecraftUsername || status.botUsername || selectedBot;
  skinEl.src = `https://mc-heads.net/avatar/${status.minecraftUsername || selectedBot}/64`;
  
  statusIndicator.classList.toggle('online', status.online);
  statusIndicator.classList.toggle('offline', !status.online);
  
  // Show chat input only if allowed (from config)
  inputEl.style.display = (status.allowWebChat !== false) ? 'block' : 'none';

  // Show/hide 3D viewer button
  if (status.online && status.viewerPort) {
    showViewerButton(status.viewerPort);
  } else {
    hideViewerButton();
  }
}

/**
 * Create/show the "View in 3D" button if not present
 */
function showViewerButton(port) {
  let btn = document.getElementById('viewer-button');
  
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'viewer-button';
    btn.textContent = 'View in 3D';
    btn.style.marginTop = '12px';
    btn.style.padding = '10px 16px';
    btn.style.backgroundColor = '#4CAF50';
    btn.style.color = 'white';
    btn.style.border = 'none';
    btn.style.borderRadius = '6px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '16px';
    btn.style.fontWeight = 'bold';
    
    btn.onclick = () => {
      window.open(`http://localhost:${port}`, '_blank', 'width=900,height=700');
    };
    
    // Append below skin or status area – adjust selector if needed
    const target = document.querySelector('.bot-info') || document.body;
    target.appendChild(btn);
  } else {
    btn.style.display = 'block';
  }
}

/**
 * Hide/disable the viewer button
 */
function hideViewerButton() {
  const btn = document.getElementById('viewer-button');
  if (btn) btn.style.display = 'none';
}

/**
 * Clear and re-render full chat history for selected bot
 */
function renderChat() {
  chatEl.innerHTML = '';
  const logs = messageLogs[selectedBot] || [];
  
  logs.forEach(entry => {
    appendChat(entry.botUsername, entry.chatUsername, entry.message);
  });
  
  chatEl.scrollTop = chatEl.scrollHeight;
}

/**
 * Append one chat line + auto-scroll if near bottom
 */
function appendChat(botUsername, chatUsername, message) {
  const shouldScroll = (chatEl.scrollTop + chatEl.clientHeight) >= (chatEl.scrollHeight - 60);
  
  const div = document.createElement('div');
  div.textContent = `<${botUsername}> | ${chatUsername || 'Server'} : ${message}`;
  chatEl.appendChild(div);
  
  if (shouldScroll) {
    chatEl.scrollTop = chatEl.scrollHeight;
  }
}
</script>
</body>
</html>