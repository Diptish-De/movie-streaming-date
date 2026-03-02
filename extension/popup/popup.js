// ===== WATCH PARTY POPUP SCRIPT =====

const AVATAR_COLORS = [
    '#e50914', '#ff6b35', '#00c853', '#2979ff',
    '#aa00ff', '#ff4081', '#00e5ff', '#ffab00'
];

// DOM Elements
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const homeView = document.getElementById('homeView');
const roomView = document.getElementById('roomView');
const nicknameInput = document.getElementById('nicknameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const usersList = document.getElementById('usersList');
const errorMsg = document.getElementById('errorMsg');
const serverUrlInput = document.getElementById('serverUrl');
const saveServerBtn = document.getElementById('saveServerBtn');

// State
let currentRoom = null;

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', async () => {
    // Load saved settings
    const data = await chrome.storage.local.get(['nickname', 'serverUrl', 'roomState']);

    if (data.nickname) {
        nicknameInput.value = data.nickname;
    }
    if (data.serverUrl) {
        serverUrlInput.value = data.serverUrl;
    }

    // Check if already in a room
    if (data.roomState && data.roomState.roomCode) {
        showRoomView(data.roomState.roomCode, data.roomState.users || []);
    }

    // Check if on Hotstar
    checkHotstarTab();
});

// ========== TAB CHECK ==========
async function checkHotstarTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && (tab.url.includes('hotstar.com') || tab.url.includes('jiohotstar.com'))) {
            statusDot.classList.add('connected');
            statusText.textContent = 'On JioHotstar — Ready!';
        } else {
            statusText.textContent = 'Open JioHotstar to start';
        }
    } catch (e) {
        statusText.textContent = 'Open JioHotstar to start';
    }
}

// ========== SEND MESSAGE TO CONTENT SCRIPT ==========
async function sendToContent(action, data = {}) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        showError('Please open JioHotstar first!');
        return null;
    }

    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { action, ...data }, (response) => {
            if (chrome.runtime.lastError) {
                showError('Please refresh JioHotstar page and try again.');
                resolve(null);
            } else {
                resolve(response);
            }
        });
    });
}

// ========== CREATE ROOM ==========
createRoomBtn.addEventListener('click', async () => {
    const nickname = nicknameInput.value.trim();
    if (!nickname) {
        showError('Enter a nickname first!');
        nicknameInput.focus();
        return;
    }

    clearError();
    createRoomBtn.textContent = 'Creating...';
    createRoomBtn.disabled = true;

    // Save nickname
    await chrome.storage.local.set({ nickname, serverUrl: serverUrlInput.value });

    const response = await sendToContent('create-room', {
        nickname,
        serverUrl: serverUrlInput.value
    });

    createRoomBtn.innerHTML = '<span class="btn-icon">🏠</span> Create Room';
    createRoomBtn.disabled = false;

    if (response && response.success) {
        currentRoom = response.roomCode;
        await chrome.storage.local.set({
            roomState: { roomCode: response.roomCode, users: response.users }
        });
        showRoomView(response.roomCode, response.users);
    } else if (response) {
        showError(response.error || 'Failed to create room');
    }
});

// ========== JOIN ROOM ==========
joinRoomBtn.addEventListener('click', async () => {
    const nickname = nicknameInput.value.trim();
    const roomCode = roomCodeInput.value.trim().toUpperCase();

    if (!nickname) {
        showError('Enter a nickname first!');
        nicknameInput.focus();
        return;
    }
    if (!roomCode || roomCode.length < 4) {
        showError('Enter a valid room code!');
        roomCodeInput.focus();
        return;
    }

    clearError();
    joinRoomBtn.textContent = 'Joining...';
    joinRoomBtn.disabled = true;

    await chrome.storage.local.set({ nickname, serverUrl: serverUrlInput.value });

    const response = await sendToContent('join-room', {
        nickname,
        roomCode,
        serverUrl: serverUrlInput.value
    });

    joinRoomBtn.innerHTML = '<span class="btn-icon">🚀</span> Join Room';
    joinRoomBtn.disabled = false;

    if (response && response.success) {
        currentRoom = response.roomCode;
        await chrome.storage.local.set({
            roomState: { roomCode: response.roomCode, users: response.users }
        });
        showRoomView(response.roomCode, response.users);
    } else if (response) {
        showError(response.error || 'Failed to join room');
    }
});

// ========== LEAVE ROOM ==========
leaveRoomBtn.addEventListener('click', async () => {
    await sendToContent('leave-room');
    await chrome.storage.local.remove('roomState');
    currentRoom = null;
    showHomeView();
});

// ========== COPY CODE ==========
copyCodeBtn.addEventListener('click', () => {
    const code = roomCodeDisplay.textContent;
    navigator.clipboard.writeText(code).then(() => {
        copyCodeBtn.textContent = '✅';
        setTimeout(() => { copyCodeBtn.textContent = '📋'; }, 1500);
    });
});

// ========== SAVE SERVER ==========
saveServerBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ serverUrl: serverUrlInput.value });
    saveServerBtn.textContent = '✅';
    setTimeout(() => { saveServerBtn.textContent = 'Save'; }, 1000);
});

// ========== VIEW SWITCHING ==========
function showHomeView() {
    homeView.classList.add('active');
    roomView.classList.remove('active');
}

function showRoomView(roomCode, users) {
    homeView.classList.remove('active');
    roomView.classList.add('active');
    roomCodeDisplay.textContent = roomCode;
    renderUsers(users);
}

function renderUsers(users) {
    usersList.innerHTML = users.map((user, i) => `
    <div class="user-item">
      <div class="user-avatar" style="background: ${AVATAR_COLORS[i % AVATAR_COLORS.length]}20; color: ${AVATAR_COLORS[i % AVATAR_COLORS.length]}">
        ${user.nickname.charAt(0).toUpperCase()}
      </div>
      <span class="user-name">${escapeHtml(user.nickname)}</span>
      ${i === 0 ? '<span class="user-badge">Host</span>' : ''}
    </div>
  `).join('');
}

// ========== LISTEN FOR UPDATES FROM CONTENT SCRIPT ==========
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'users-updated') {
        renderUsers(msg.users || []);
        chrome.storage.local.get('roomState', (data) => {
            if (data.roomState) {
                data.roomState.users = msg.users;
                chrome.storage.local.set({ roomState: data.roomState });
            }
        });
    }
    if (msg.action === 'room-ended') {
        currentRoom = null;
        chrome.storage.local.remove('roomState');
        showHomeView();
        showError('Room was closed.');
    }
});

// ========== UTILITIES ==========
function showError(msg) {
    errorMsg.textContent = msg;
    setTimeout(() => clearError(), 4000);
}

function clearError() {
    errorMsg.textContent = '';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
