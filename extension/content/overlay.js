// ===== OVERLAY UI: Chat, Reactions, Voice Chat =====
// Injected into JioHotstar pages as part of content scripts

(function () {
    'use strict';

    const EMOJIS = ['🔥', '😂', '😱', '❤️', '👏', '🥵', '😍', '💀', '🤯', '😭'];
    const AVATAR_COLORS = [
        '#e50914', '#ff6b35', '#00c853', '#2979ff',
        '#aa00ff', '#ff4081', '#00e5ff', '#ffab00'
    ];

    let overlayEl = null;
    let chatMessages = [];
    let users = [];
    let isCollapsed = true;
    let myNickname = '';
    let roomCode = '';
    let isVoiceActive = false;
    let isMuted = false;
    let peerConnections = new Map();
    let localStream = null;
    let unreadCount = 0;

    // ========== CREATE OVERLAY ==========
    function createOverlay() {
        if (overlayEl) return;

        overlayEl = document.createElement('div');
        overlayEl.id = 'watchparty-overlay';
        overlayEl.innerHTML = getOverlayHTML();
        document.body.appendChild(overlayEl);

        attachEventListeners();
        console.log('[Watch Party] 🎨 Overlay created');
    }

    function getOverlayHTML() {
        return `
      <!-- Toggle Button -->
      <div id="wp-toggle" class="wp-toggle">
        <span class="wp-toggle-icon">🎬</span>
        <span class="wp-toggle-badge" id="wpBadge" style="display:none">0</span>
      </div>

      <!-- Main Panel -->
      <div id="wp-panel" class="wp-panel collapsed">
        <!-- Panel Header -->
        <div class="wp-panel-header">
          <div class="wp-panel-title">
            <span>🎬</span>
            <span>Watch Party</span>
            <span class="wp-room-code" id="wpRoomCode"></span>
          </div>
          <div class="wp-panel-actions">
            <button class="wp-icon-btn" id="wpMinimize" title="Minimize">✕</button>
          </div>
        </div>

        <!-- Users Bar -->
        <div class="wp-users-bar" id="wpUsersBar">
          <div class="wp-users-avatars" id="wpUsersAvatars"></div>
          <span class="wp-users-count" id="wpUsersCount">0 watching</span>
        </div>

        <!-- Sync Status -->
        <div class="wp-sync-bar" id="wpSyncBar" style="display:none">
          <span class="wp-sync-text" id="wpSyncText"></span>
        </div>

        <!-- Chat Area -->
        <div class="wp-chat" id="wpChat">
          <div class="wp-chat-messages" id="wpChatMessages">
            <div class="wp-chat-empty">
              <span>💬</span>
              <p>No messages yet. Say hi!</p>
            </div>
          </div>
        </div>

        <!-- Reactions Bar -->
        <div class="wp-reactions" id="wpReactions">
          ${EMOJIS.map(e => `<button class="wp-reaction-btn" data-emoji="${e}">${e}</button>`).join('')}
        </div>

        <!-- Chat Input -->
        <div class="wp-chat-input-area">
          <input type="text" id="wpChatInput" class="wp-chat-input" placeholder="Type a message..." maxlength="500" autocomplete="off">
          <button class="wp-send-btn" id="wpSendBtn">➤</button>
        </div>

        <!-- Voice Controls -->
        <div class="wp-voice-bar">
          <button class="wp-voice-btn" id="wpVoiceToggle" title="Toggle Voice Chat">
            <span id="wpVoiceIcon">🎤</span>
            <span id="wpVoiceLabel">Voice Off</span>
          </button>
          <button class="wp-voice-btn wp-mute-btn" id="wpMuteToggle" title="Mute/Unmute" style="display:none">
            <span id="wpMuteIcon">🔊</span>
          </button>
        </div>
      </div>

      <!-- Floating Reactions Container -->
      <div id="wp-floating-reactions" class="wp-floating-reactions"></div>
    `;
    }

    // ========== EVENT LISTENERS ==========
    function attachEventListeners() {
        // Toggle panel
        document.getElementById('wp-toggle').addEventListener('click', () => {
            togglePanel();
        });

        document.getElementById('wpMinimize').addEventListener('click', () => {
            togglePanel(true);
        });

        // Chat input
        const chatInput = document.getElementById('wpChatInput');
        chatInput.addEventListener('keydown', (e) => {
            e.stopPropagation(); // prevent hotstar shortcuts
            if (e.key === 'Enter' && chatInput.value.trim()) {
                sendChat(chatInput.value.trim());
                chatInput.value = '';
            }
        });

        document.getElementById('wpSendBtn').addEventListener('click', () => {
            const msg = chatInput.value.trim();
            if (msg) {
                sendChat(msg);
                chatInput.value = '';
            }
        });

        // Prevent Hotstar keyboard shortcuts when typing in chat
        chatInput.addEventListener('keyup', (e) => e.stopPropagation());
        chatInput.addEventListener('keypress', (e) => e.stopPropagation());

        // Reactions
        document.querySelectorAll('.wp-reaction-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const emoji = btn.dataset.emoji;
                sendReaction(emoji);
                // Local animation feedback
                btn.style.transform = 'scale(1.4)';
                setTimeout(() => { btn.style.transform = ''; }, 200);
            });
        });

        // Voice chat
        document.getElementById('wpVoiceToggle').addEventListener('click', toggleVoice);
        document.getElementById('wpMuteToggle').addEventListener('click', toggleMute);
    }

    // ========== PANEL TOGGLE ==========
    function togglePanel(forceCollapse = false) {
        const panel = document.getElementById('wp-panel');
        const toggle = document.getElementById('wp-toggle');

        if (forceCollapse || !isCollapsed) {
            panel.classList.add('collapsed');
            toggle.style.display = 'flex';
            isCollapsed = true;
        } else {
            panel.classList.remove('collapsed');
            toggle.style.display = 'none';
            isCollapsed = false;
            unreadCount = 0;
            updateBadge();
            // Scroll chat to bottom
            const chatEl = document.getElementById('wpChatMessages');
            chatEl.scrollTop = chatEl.scrollHeight;
        }
    }

    // ========== CHAT ==========
    function sendChat(message) {
        // Send via content.js socket
        chrome.runtime.sendMessage({ action: 'send-chat', message, target: 'content' });
        // Also send directly if socket is available
        const socket = window.__watchPartySocket?.();
        if (socket) {
            socket.emit('chat-message', { message });
        }
    }

    function addChatMessage(data) {
        chatMessages.push(data);
        if (chatMessages.length > 200) chatMessages.shift();

        const container = document.getElementById('wpChatMessages');
        const emptyMsg = container.querySelector('.wp-chat-empty');
        if (emptyMsg) emptyMsg.remove();

        const isMe = data.nickname === myNickname;
        const colorIdx = users.findIndex(u => u.nickname === data.nickname);
        const color = AVATAR_COLORS[(colorIdx >= 0 ? colorIdx : 0) % AVATAR_COLORS.length];
        const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const msgEl = document.createElement('div');
        msgEl.className = `wp-chat-msg ${isMe ? 'wp-chat-msg-me' : ''}`;
        msgEl.innerHTML = `
      <div class="wp-msg-avatar" style="background:${color}20;color:${color}">${data.nickname.charAt(0).toUpperCase()}</div>
      <div class="wp-msg-content">
        <div class="wp-msg-header">
          <span class="wp-msg-name" style="color:${color}">${escapeHtml(data.nickname)}</span>
          <span class="wp-msg-time">${time}</span>
        </div>
        <div class="wp-msg-text">${escapeHtml(data.message)}</div>
      </div>
    `;
        container.appendChild(msgEl);
        container.scrollTop = container.scrollHeight;

        // Badge for unread
        if (isCollapsed && !isMe) {
            unreadCount++;
            updateBadge();
        }
    }

    function updateBadge() {
        const badge = document.getElementById('wpBadge');
        if (unreadCount > 0) {
            badge.style.display = 'flex';
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        } else {
            badge.style.display = 'none';
        }
    }

    // ========== REACTIONS ==========
    function sendReaction(emoji) {
        const socket = window.__watchPartySocket?.();
        if (socket) {
            socket.emit('reaction', { emoji });
        }
    }

    function showFloatingReaction(emoji, nickname) {
        const container = document.getElementById('wp-floating-reactions');
        const el = document.createElement('div');
        el.className = 'wp-float-emoji';
        el.innerHTML = `<span class="wp-float-emoji-icon">${emoji}</span><span class="wp-float-emoji-name">${escapeHtml(nickname)}</span>`;

        // Random horizontal position
        el.style.left = `${Math.random() * 60 + 20}%`;
        el.style.animationDuration = `${2 + Math.random() * 1.5}s`;

        container.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    // ========== USERS ==========
    function updateUsers(newUsers) {
        users = newUsers;
        const avatarsEl = document.getElementById('wpUsersAvatars');
        const countEl = document.getElementById('wpUsersCount');

        avatarsEl.innerHTML = users.slice(0, 8).map((u, i) => {
            const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
            return `<div class="wp-user-avatar" style="background:${color};z-index:${10 - i}" title="${escapeHtml(u.nickname)}">${u.nickname.charAt(0).toUpperCase()}</div>`;
        }).join('');

        countEl.textContent = `${users.length} watching`;
    }

    // ========== SYNC STATUS ==========
    function showSyncNotification(text) {
        const bar = document.getElementById('wpSyncBar');
        const textEl = document.getElementById('wpSyncText');
        textEl.textContent = text;
        bar.style.display = 'flex';
        setTimeout(() => { bar.style.display = 'none'; }, 3000);
    }

    // ========== NOTIFICATION ==========
    function showNotification(message) {
        addChatMessage({
            nickname: '🎬 System',
            message,
            timestamp: Date.now(),
            isSystem: true
        });
    }

    // ========== VOICE CHAT (WebRTC) ==========
    async function toggleVoice() {
        if (isVoiceActive) {
            stopVoice();
        } else {
            await startVoice();
        }
    }

    async function startVoice() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            isVoiceActive = true;
            isMuted = false;

            document.getElementById('wpVoiceIcon').textContent = '🎤';
            document.getElementById('wpVoiceLabel').textContent = 'Voice On';
            document.getElementById('wpVoiceToggle').classList.add('active');
            document.getElementById('wpMuteToggle').style.display = 'flex';

            // Create peer connections for each user
            users.forEach(user => {
                if (user.nickname !== myNickname) {
                    createPeerConnection(user.socketId, true);
                }
            });

            showNotification('Voice chat enabled 🎤');
        } catch (err) {
            console.error('[Watch Party] Mic access denied:', err);
            showNotification('Mic access denied. Please allow microphone access.');
        }
    }

    function stopVoice() {
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }

        peerConnections.forEach(pc => pc.close());
        peerConnections.clear();

        isVoiceActive = false;
        document.getElementById('wpVoiceIcon').textContent = '🎤';
        document.getElementById('wpVoiceLabel').textContent = 'Voice Off';
        document.getElementById('wpVoiceToggle').classList.remove('active');
        document.getElementById('wpMuteToggle').style.display = 'none';

        showNotification('Voice chat disabled');
    }

    function toggleMute() {
        if (!localStream) return;
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
        document.getElementById('wpMuteIcon').textContent = isMuted ? '🔇' : '🔊';

        const socket = window.__watchPartySocket?.();
        if (socket) {
            socket.emit('voice-toggle', { muted: isMuted });
        }
    }

    function createPeerConnection(peerId, initiator) {
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        const pc = new RTCPeerConnection(config);
        peerConnections.set(peerId, pc);

        // Add local audio
        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        }

        // Handle remote audio
        pc.ontrack = (event) => {
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            audio.play().catch(() => { });
        };

        // ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                const socket = window.__watchPartySocket?.();
                if (socket) {
                    socket.emit('ice-candidate', { to: peerId, candidate: event.candidate });
                }
            }
        };

        // Create offer if initiator
        if (initiator) {
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => {
                    const socket = window.__watchPartySocket?.();
                    if (socket) {
                        socket.emit('voice-offer', { to: peerId, offer: pc.localDescription });
                    }
                });
        }

        return pc;
    }

    // ========== EVENT HANDLERS FROM CONTENT.JS ==========

    window.addEventListener('watchparty-room-joined', (e) => {
        const { roomCode: code, nickname, users: roomUsers, isHost } = e.detail;
        myNickname = nickname;
        roomCode = code;
        users = roomUsers;

        createOverlay();
        document.getElementById('wpRoomCode').textContent = code;
        updateUsers(roomUsers);
        togglePanel(); // open panel

        showNotification(isHost ? 'Room created! Share the code with friends 🎉' : 'Joined the party! 🎉');
    });

    window.addEventListener('watchparty-room-left', () => {
        if (overlayEl) {
            stopVoice();
            overlayEl.remove();
            overlayEl = null;
        }
        chatMessages = [];
        users = [];
        isCollapsed = true;
    });

    window.addEventListener('watchparty-chat', (e) => {
        addChatMessage(e.detail);
    });

    window.addEventListener('watchparty-reaction', (e) => {
        showFloatingReaction(e.detail.emoji, e.detail.nickname);
    });

    window.addEventListener('watchparty-users', (e) => {
        updateUsers(e.detail.users);
    });

    window.addEventListener('watchparty-notification', (e) => {
        showNotification(e.detail.message);
    });

    window.addEventListener('watchparty-sync-event', (e) => {
        const { type, from } = e.detail;
        const labels = { play: '▶️ played', pause: '⏸️ paused', seek: '⏩ seeked' };
        showSyncNotification(`${from} ${labels[type] || type}`);
    });

    // WebRTC signaling
    window.addEventListener('watchparty-voice-offer', async (e) => {
        if (!isVoiceActive) return;
        const { from, offer } = e.detail;
        const pc = createPeerConnection(from, false);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        const socket = window.__watchPartySocket?.();
        if (socket) {
            socket.emit('voice-answer', { to: from, answer: pc.localDescription });
        }
    });

    window.addEventListener('watchparty-voice-answer', async (e) => {
        const { from, answer } = e.detail;
        const pc = peerConnections.get(from);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
    });

    window.addEventListener('watchparty-ice-candidate', async (e) => {
        const { from, candidate } = e.detail;
        const pc = peerConnections.get(from);
        if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    });

    // ========== UTILITY ==========
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    console.log('[Watch Party] 🎨 Overlay script loaded');
})();
