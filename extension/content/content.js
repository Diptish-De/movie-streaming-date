// ===== CONTENT SCRIPT: VIDEO SYNC =====
// Detects Hotstar's video player and hooks into play/pause/seek events

(function () {
    'use strict';

    // State
    let socket = null;
    let videoElement = null;
    let isRemoteAction = false; // prevents event loop
    let currentRoom = null;
    let currentNickname = null;
    let syncThreshold = 2; // seconds - don't sync if difference is small
    let lastSyncTime = 0;
    let serverUrl = 'https://watch-party-server.onrender.com';

    // ========== VIDEO DETECTION ==========
    function findVideoElement() {
        // Try to find the main video element on Hotstar
        const videos = document.querySelectorAll('video');
        if (videos.length > 0) {
            // Usually the largest/main video
            let mainVideo = videos[0];
            for (const v of videos) {
                if (v.offsetWidth > mainVideo.offsetWidth) {
                    mainVideo = v;
                }
            }
            return mainVideo;
        }
        return null;
    }

    function waitForVideo(callback, maxAttempts = 50) {
        let attempts = 0;
        const check = () => {
            const video = findVideoElement();
            if (video) {
                callback(video);
            } else if (attempts < maxAttempts) {
                attempts++;
                setTimeout(check, 1000);
            }
        };
        check();

        // Also watch for dynamically added videos
        const observer = new MutationObserver(() => {
            const video = findVideoElement();
            if (video && video !== videoElement) {
                callback(video);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ========== HOOK VIDEO EVENTS ==========
    function hookVideo(video) {
        if (videoElement === video) return;
        videoElement = video;
        console.log('[Watch Party] 🎬 Video element found and hooked!');

        video.addEventListener('play', () => {
            if (isRemoteAction) return;
            if (socket && currentRoom) {
                socket.emit('sync-play', { currentTime: video.currentTime });
            }
        });

        video.addEventListener('pause', () => {
            if (isRemoteAction) return;
            if (socket && currentRoom) {
                socket.emit('sync-pause', { currentTime: video.currentTime });
            }
        });

        video.addEventListener('seeked', () => {
            if (isRemoteAction) return;
            const now = Date.now();
            if (now - lastSyncTime < 500) return; // debounce seeks
            lastSyncTime = now;
            if (socket && currentRoom) {
                socket.emit('sync-seek', { currentTime: video.currentTime });
            }
        });

        // Notify overlay that video is ready
        window.dispatchEvent(new CustomEvent('watchparty-video-ready'));
    }

    // ========== SOCKET CONNECTION ==========
    function connectToServer(url) {
        serverUrl = url || serverUrl;

        if (socket) {
            socket.disconnect();
        }

        socket = io(serverUrl, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000
        });

        socket.on('connect', () => {
            console.log('[Watch Party] ✅ Connected to server');
            window.dispatchEvent(new CustomEvent('watchparty-connected'));
        });

        socket.on('disconnect', () => {
            console.log('[Watch Party] ❌ Disconnected from server');
            window.dispatchEvent(new CustomEvent('watchparty-disconnected'));
        });

        // --- SYNC HANDLERS ---
        socket.on('sync-play', ({ currentTime, from }) => {
            if (!videoElement) return;
            console.log(`[Watch Party] ▶️ ${from} pressed play at ${currentTime.toFixed(1)}s`);
            isRemoteAction = true;

            if (Math.abs(videoElement.currentTime - currentTime) > syncThreshold) {
                videoElement.currentTime = currentTime;
            }
            videoElement.play().then(() => {
                setTimeout(() => { isRemoteAction = false; }, 500);
            }).catch(() => {
                isRemoteAction = false;
            });

            window.dispatchEvent(new CustomEvent('watchparty-sync-event', {
                detail: { type: 'play', from, currentTime }
            }));
        });

        socket.on('sync-pause', ({ currentTime, from }) => {
            if (!videoElement) return;
            console.log(`[Watch Party] ⏸️ ${from} pressed pause at ${currentTime.toFixed(1)}s`);
            isRemoteAction = true;

            videoElement.pause();
            if (Math.abs(videoElement.currentTime - currentTime) > syncThreshold) {
                videoElement.currentTime = currentTime;
            }
            setTimeout(() => { isRemoteAction = false; }, 500);

            window.dispatchEvent(new CustomEvent('watchparty-sync-event', {
                detail: { type: 'pause', from, currentTime }
            }));
        });

        socket.on('sync-seek', ({ currentTime, from }) => {
            if (!videoElement) return;
            console.log(`[Watch Party] ⏩ ${from} seeked to ${currentTime.toFixed(1)}s`);
            isRemoteAction = true;

            videoElement.currentTime = currentTime;
            setTimeout(() => { isRemoteAction = false; }, 500);

            window.dispatchEvent(new CustomEvent('watchparty-sync-event', {
                detail: { type: 'seek', from, currentTime }
            }));
        });

        // --- CHAT & REACTIONS ---
        socket.on('chat-message', (data) => {
            window.dispatchEvent(new CustomEvent('watchparty-chat', { detail: data }));
        });

        socket.on('reaction', (data) => {
            window.dispatchEvent(new CustomEvent('watchparty-reaction', { detail: data }));
        });

        // --- USER EVENTS ---
        socket.on('user-joined', ({ nickname, users }) => {
            window.dispatchEvent(new CustomEvent('watchparty-users', { detail: { users } }));
            window.dispatchEvent(new CustomEvent('watchparty-notification', {
                detail: { message: `${nickname} joined the party! 🎉` }
            }));
            // Notify popup
            chrome.runtime.sendMessage({ action: 'users-updated', users });
        });

        socket.on('user-left', ({ nickname, users }) => {
            window.dispatchEvent(new CustomEvent('watchparty-users', { detail: { users } }));
            window.dispatchEvent(new CustomEvent('watchparty-notification', {
                detail: { message: `${nickname} left the party 👋` }
            }));
            chrome.runtime.sendMessage({ action: 'users-updated', users });
        });

        // --- WEBRTC SIGNALING ---
        socket.on('voice-offer', (data) => {
            window.dispatchEvent(new CustomEvent('watchparty-voice-offer', { detail: data }));
        });
        socket.on('voice-answer', (data) => {
            window.dispatchEvent(new CustomEvent('watchparty-voice-answer', { detail: data }));
        });
        socket.on('ice-candidate', (data) => {
            window.dispatchEvent(new CustomEvent('watchparty-ice-candidate', { detail: data }));
        });
        socket.on('voice-toggle', (data) => {
            window.dispatchEvent(new CustomEvent('watchparty-voice-toggle', { detail: data }));
        });

        return socket;
    }

    // ========== MESSAGE LISTENER (from popup) ==========
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

        if (msg.action === 'create-room') {
            connectToServer(msg.serverUrl);
            socket.on('connect', () => {
                socket.emit('create-room', { nickname: msg.nickname }, (response) => {
                    if (response.success) {
                        currentRoom = response.roomCode;
                        currentNickname = msg.nickname;
                        // Initialize overlay
                        window.dispatchEvent(new CustomEvent('watchparty-room-joined', {
                            detail: {
                                roomCode: response.roomCode,
                                nickname: msg.nickname,
                                users: response.users,
                                isHost: true
                            }
                        }));
                    }
                    sendResponse(response);
                });
            });
            return true; // async
        }

        if (msg.action === 'join-room') {
            connectToServer(msg.serverUrl);
            socket.on('connect', () => {
                socket.emit('join-room', { roomCode: msg.roomCode, nickname: msg.nickname }, (response) => {
                    if (response.success) {
                        currentRoom = response.roomCode;
                        currentNickname = msg.nickname;
                        window.dispatchEvent(new CustomEvent('watchparty-room-joined', {
                            detail: {
                                roomCode: response.roomCode,
                                nickname: msg.nickname,
                                users: response.users,
                                isHost: false
                            }
                        }));
                    }
                    sendResponse(response);
                });
            });
            return true;
        }

        if (msg.action === 'leave-room') {
            if (socket) {
                socket.emit('leave-room');
                socket.disconnect();
                socket = null;
            }
            currentRoom = null;
            currentNickname = null;
            window.dispatchEvent(new CustomEvent('watchparty-room-left'));
            sendResponse({ success: true });
        }

        if (msg.action === 'send-chat') {
            if (socket) {
                socket.emit('chat-message', { message: msg.message });
            }
        }

        if (msg.action === 'send-reaction') {
            if (socket) {
                socket.emit('reaction', { emoji: msg.emoji });
            }
        }

        if (msg.action === 'voice-offer') {
            if (socket) socket.emit('voice-offer', msg);
        }
        if (msg.action === 'voice-answer') {
            if (socket) socket.emit('voice-answer', msg);
        }
        if (msg.action === 'ice-candidate') {
            if (socket) socket.emit('ice-candidate', msg);
        }
        if (msg.action === 'voice-toggle') {
            if (socket) socket.emit('voice-toggle', { muted: msg.muted });
        }
    });

    // Make socket accessible for overlay
    window.__watchPartySocket = () => socket;
    window.__watchPartyNickname = () => currentNickname;

    // Start video detection
    waitForVideo(hookVideo);

    console.log('[Watch Party] 🎬 Content script loaded on', window.location.hostname);
})();
