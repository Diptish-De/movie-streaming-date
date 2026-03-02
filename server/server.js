const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 5e6 // 5MB for video chunks
});

// ========== ROOM MANAGEMENT ==========
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ========== ROUTES ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/room/:code', (req, res) => res.sendFile(path.join(__dirname, 'public', 'room.html')));
app.get('/api/health', (req, res) => res.json({ status: 'running', rooms: rooms.size, uptime: process.uptime() }));

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
  console.log(`✅ Connected: ${socket.id}`);

  let currentRoom = null;
  let currentNickname = null;

  // ---------- CREATE ROOM ----------
  socket.on('create-room', ({ nickname }, callback) => {
    const roomCode = generateRoomCode();
    const room = {
      host: socket.id,
      users: new Map(),
      screenSharer: null,
      screenSharerName: null,
      createdAt: Date.now()
    };
    room.users.set(socket.id, { nickname, socketId: socket.id });
    rooms.set(roomCode, room);
    socket.join(roomCode);
    currentRoom = roomCode;
    currentNickname = nickname;
    console.log(`🏠 Room ${roomCode} created by ${nickname}`);
    callback({ success: true, roomCode, users: [{ nickname, socketId: socket.id }] });
  });

  // ---------- JOIN ROOM ----------
  socket.on('join-room', ({ roomCode, nickname }, callback) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) { callback({ success: false, error: 'Room not found!' }); return; }

    room.users.set(socket.id, { nickname, socketId: socket.id });
    socket.join(code);
    currentRoom = code;
    currentNickname = nickname;
    const usersList = Array.from(room.users.values());

    socket.to(code).emit('user-joined', { nickname, socketId: socket.id, users: usersList });
    console.log(`👋 ${nickname} joined room ${code} (${usersList.length} users)`);

    callback({
      success: true,
      roomCode: code,
      users: usersList,
      screenSharer: room.screenSharer,
      screenSharerName: room.screenSharerName
    });
  });

  // ---------- SYNC EVENTS ----------
  socket.on('sync-play', ({ currentTime }) => { if (currentRoom) socket.to(currentRoom).emit('sync-play', { currentTime, from: currentNickname }); });
  socket.on('sync-pause', ({ currentTime }) => { if (currentRoom) socket.to(currentRoom).emit('sync-pause', { currentTime, from: currentNickname }); });
  socket.on('sync-seek', ({ currentTime }) => { if (currentRoom) socket.to(currentRoom).emit('sync-seek', { currentTime, from: currentNickname }); });

  // ---------- CHAT ----------
  socket.on('chat-message', ({ message }) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('chat-message', { message, nickname: currentNickname, socketId: socket.id, timestamp: Date.now() });
  });

  // ---------- REACTIONS ----------
  socket.on('reaction', ({ emoji }) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('reaction', { emoji, nickname: currentNickname, socketId: socket.id });
  });

  // ---------- VIDEO URL SHARING ----------
  socket.on('share-video-url', ({ url }) => { if (currentRoom) socket.to(currentRoom).emit('share-video-url', { url }); });

  // ---------- SCREEN SHARING (server relay) ----------
  socket.on('screen-share-start', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (room) { room.screenSharer = socket.id; room.screenSharerName = currentNickname; }
    socket.to(currentRoom).emit('screen-share-start', { from: socket.id, nickname: currentNickname });
    console.log(`🖥️ ${currentNickname} started screen sharing in ${currentRoom}`);
  });

  socket.on('screen-share-stop', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (room) { room.screenSharer = null; room.screenSharerName = null; }
    socket.to(currentRoom).emit('screen-share-stop', { from: socket.id, nickname: currentNickname });
    console.log(`🖥️ ${currentNickname} stopped screen sharing`);
  });

  // Relay video stream chunks from host to viewers
  socket.on('stream-data', (data) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('stream-data', data);
  });

  // ---------- WEBRTC VOICE SIGNALING ----------
  socket.on('voice-offer', ({ to, offer }) => { io.to(to).emit('voice-offer', { from: socket.id, nickname: currentNickname, offer }); });
  socket.on('voice-answer', ({ to, answer }) => { io.to(to).emit('voice-answer', { from: socket.id, answer }); });
  socket.on('ice-candidate', ({ to, candidate }) => { io.to(to).emit('ice-candidate', { from: socket.id, candidate }); });
  socket.on('voice-toggle', ({ muted }) => { if (currentRoom) socket.to(currentRoom).emit('voice-toggle', { socketId: socket.id, nickname: currentNickname, muted }); });

  // ---------- DISCONNECT ----------
  socket.on('disconnect', () => {
    console.log(`❌ Disconnected: ${socket.id} (${currentNickname || 'unknown'})`);
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.users.delete(socket.id);
      const usersList = Array.from(room.users.values());

      if (room.screenSharer === socket.id) {
        room.screenSharer = null;
        room.screenSharerName = null;
        io.to(currentRoom).emit('screen-share-stop', { from: socket.id, nickname: currentNickname });
      }

      socket.to(currentRoom).emit('user-left', { nickname: currentNickname, socketId: socket.id, users: usersList });

      if (room.users.size === 0) { rooms.delete(currentRoom); console.log(`🗑️ Room ${currentRoom} deleted`); }
      else if (room.host === socket.id) {
        const newHost = room.users.keys().next().value;
        room.host = newHost;
        io.to(currentRoom).emit('host-changed', { newHostId: newHost, newHostNickname: room.users.get(newHost).nickname });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  🎬 Watch Party Server running on http://localhost:${PORT}\n`);
});
