# 🎬 Watch Party — JioHotstar

Watch JioHotstar together with your friends! Synced playback, live chat, emoji reactions, and voice chat.

## Features

- ▶️ **Synced Playback** — Play, pause, seek mirrors across all connected users
- 💬 **Live Chat** — Real-time messaging while watching
- 🔥 **Emoji Reactions** — Floating emoji animations visible to everyone
- 🎤 **Voice Chat** — Talk to friends via WebRTC (peer-to-peer)
- 👥 **User Presence** — See who's watching

## How to Use

### 1. Start the Server

```bash
cd server
npm install
npm start
```

Server runs on `http://localhost:3000`

### 2. Install the Chrome Extension

1. Open **Chrome** → navigate to `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension` folder from this project
5. The 🎬 Watch Party icon appears in your toolbar!

### 3. Create or Join a Room

1. Open **JioHotstar** in your browser
2. Click the **Watch Party** extension icon
3. Enter your **nickname**
4. **Create Room** → share the 6-character code with friends
5. Friends click the icon → enter **nickname + room code** → **Join Room**

### 4. Enjoy Together! 🍿

- Play/pause/seek is synced automatically
- Use the chat panel on the right side of the screen
- Send emoji reactions that float across the screen
- Toggle voice chat to talk to each other

## Tech Stack

- **Backend**: Node.js + Express + Socket.io
- **Extension**: Chrome Manifest V3
- **Voice Chat**: WebRTC (peer-to-peer)
- **Styling**: Custom CSS with glassmorphism theme

## Project Structure

```
├── server/
│   ├── package.json
│   └── server.js          # Socket.io server
├── extension/
│   ├── manifest.json       # Chrome Extension Manifest V3
│   ├── popup/              # Extension popup UI
│   ├── content/            # Content scripts (video sync + overlay)
│   ├── background/         # Service worker
│   ├── styles/             # Overlay CSS
│   ├── lib/                # Socket.io client library
│   └── icons/              # Extension icons
└── README.md
```
