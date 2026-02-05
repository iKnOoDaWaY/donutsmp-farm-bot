// Client side script for the web dashboard. Handles selecting
// between multiple bots, displaying chat logs, updating status
// indicators and sending messages back to the server.

const socket = io();
const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const usernameEl = document.getElementById('username');
const skinEl = document.getElementById('skin');
const botSelect = document.getElementById('botSelect');
const statusIndicator = document.getElementById('status-indicator');

// Maintain a log of messages per bot so switching between bots
// preserves the conversation history.
const messageLogs = {};

// Store the latest status for all bots. Each entry is keyed by
// username and contains online state plus allowWebChat.
let botsStatus = {};

// The bot currently selected in the drop down. When undefined the
// first available bot will be selected automatically.
let selectedBot = null;

// When the server broadcasts bot statuses we update our drop down
// options, pick a selected bot (if none yet) and refresh the UI.
socket.on('bots', data => {
  botsStatus = data || {};
  updateSelectOptions();
  if (!selectedBot || !botsStatus[selectedBot]) {
    selectedBot = Object.keys(botsStatus)[0] || null;
  }
  updateUI();
});

// Append incoming chat messages to the appropriate log and, if
// currently selected, to the visible chat area. All chat events
// carry the name of the bot they originated from.
socket.on('chat', ({ username, botUsername, chatUsername, message }) => {
  if (!messageLogs[username]) {
    messageLogs[username] = [];
  }
  messageLogs[username].push({ botUsername, chatUsername, message });
  if (username === selectedBot) {
    appendChat(botUsername, chatUsername, message);
  }
});

// When the user selects a different bot from the drop down we
// update our selectedBot variable and redraw the chat history and
// status display.
botSelect.addEventListener('change', () => {
  selectedBot = botSelect.value;
  renderChat();
  updateUI();
});

// Handle the enter key for sending chat messages. We emit the
// message along with the currently selected bot's username so the
// server knows which bot should speak. If web chat is disabled
// nothing will happen.
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
 * Update the drop down options based on the current botsStatus.
 * Preserve the previously selected value if still valid.
 */
function updateSelectOptions() {
  botSelect.innerHTML = '';
  for (const [id, status] of Object.entries(botsStatus)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = status.botUsername || status.username || id;
    botSelect.appendChild(option);
  }
  if (selectedBot && botsStatus[selectedBot]) {
    botSelect.value = selectedBot;
  }
}

/**
 * Update the displayed username, skin, status indicator and
 * visibility of the input box based on the selected bot. If no
 * bot is selected the fields are cleared.
 */
function updateUI() {
  if (!selectedBot || !botsStatus[selectedBot]) {
    usernameEl.textContent = 'No bot';
    skinEl.src = '';
    statusIndicator.classList.remove('online');
    statusIndicator.classList.add('offline');
    inputEl.style.display = 'none';
    hideViewerButtons();
    return;
  }
  const status = botsStatus[selectedBot];
  usernameEl.textContent = status.botUsername || status.username || selectedBot;
  skinEl.src = `https://mc-heads.net/avatar/${status.botUsername || status.username || selectedBot}/64`;
  if (status.online) {
    statusIndicator.classList.remove('offline');
    statusIndicator.classList.add('online');
  } else {
    statusIndicator.classList.remove('online');
    statusIndicator.classList.add('offline');
  }
  // Hide or show the message input depending on whether web chat is
  // enabled in the server configuration.
  if (status.allowWebChat === false) {
    inputEl.style.display = 'none';
  } else {
    inputEl.style.display = 'block';
  }
  // Viewer buttons (only if online)
  if (status.online) {
    showViewerButtons(status.viewerRunning, status.viewerPort);
  } else {
    hideViewerButtons();
  }
}

/**
 * Show/update viewer buttons in the card
 */
function updateViewerControls() {
  const status = botsStatus[selectedBot];
  const controls = document.getElementById('viewer-controls');
  if (!controls || !status || !status.online) {
    if (controls) controls.innerHTML = '';
    return;
  }

  controls.innerHTML = '';

  const toggleBtn = document.createElement('button');
  toggleBtn.textContent = status.viewerRunning ? 'Stop Viewer' : 'Start Viewer';
  toggleBtn.style.padding = '8px 16px';
  toggleBtn.style.marginRight = '10px';
  toggleBtn.style.backgroundColor = status.viewerRunning ? '#e74c3c' : '#2ecc71';
  toggleBtn.style.color = 'white';
  toggleBtn.style.border = 'none';
  toggleBtn.style.borderRadius = '4px';
  toggleBtn.style.cursor = 'pointer';
  toggleBtn.onclick = () => {
    socket.emit(status.viewerRunning ? 'stopViewer' : 'startViewer', { username: selectedBot });
  };
  controls.appendChild(toggleBtn);

  const openBtn = document.createElement('button');
  openBtn.textContent = 'Open Viewer';
  openBtn.style.padding = '8px 16px';
  openBtn.style.backgroundColor = status.viewerRunning ? '#3498db' : '#95a5a6';
  openBtn.style.color = 'white';
  openBtn.style.border = 'none';
  openBtn.style.borderRadius = '4px';
  openBtn.disabled = !status.viewerRunning;
  openBtn.onclick = () => {
    if (status.viewerRunning && status.viewerPort) {
      window.open(`http://localhost:${status.viewerPort}`, '_blank');
    }
  };
  controls.appendChild(openBtn);
}

// Call this function in existing update places
// Add inside socket.on('bots', ...) after updateUI():
updateViewerControls();

// Add inside botSelect.addEventListener('change', ...) after updateUI():
updateViewerControls();