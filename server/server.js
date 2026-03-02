const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// ========== ROOM MANAGEMENT ==========
const rooms = new Map(); // roomCode -> { host, users: Map<socketId, {nickname, socketId}> }

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ========== HEALTH CHECK ==========
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    rooms: rooms.size,
    uptime: process.uptime()
  });
});

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
      createdAt: Date.now()
    };
    room.users.set(socket.id, { nickname, socketId: socket.id });
    rooms.set(roomCode, room);

    socket.join(roomCode);
    currentRoom = roomCode;
    currentNickname = nickname;

    console.log(`🏠 Room ${roomCode} created by ${nickname}`);

    callback({
      success: true,
      roomCode,
      users: [{ nickname, socketId: socket.id }]
    });
  });

  // ---------- JOIN ROOM ----------
  socket.on('join-room', ({ roomCode, nickname }, callback) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      callback({ success: false, error: 'Room not found! Check the code and try again.' });
      return;
    }

    room.users.set(socket.id, { nickname, socketId: socket.id });
    socket.join(code);
    currentRoom = code;
    currentNickname = nickname;

    const usersList = Array.from(room.users.values());

    // Notify others in the room
    socket.to(code).emit('user-joined', {
      nickname,
      socketId: socket.id,
      users: usersList
    });

    console.log(`👋 ${nickname} joined room ${code}`);

    callback({
      success: true,
      roomCode: code,
      users: usersList,
      isHost: false
    });
  });

  // ---------- SYNC EVENTS ----------
  socket.on('sync-play', ({ currentTime }) => {
    if (!currentRoom) return;
    console.log(`▶️ [${currentRoom}] ${currentNickname} played at ${currentTime.toFixed(1)}s`);
    socket.to(currentRoom).emit('sync-play', {
      currentTime,
      from: currentNickname
    });
  });

  socket.on('sync-pause', ({ currentTime }) => {
    if (!currentRoom) return;
    console.log(`⏸️ [${currentRoom}] ${currentNickname} paused at ${currentTime.toFixed(1)}s`);
    socket.to(currentRoom).emit('sync-pause', {
      currentTime,
      from: currentNickname
    });
  });

  socket.on('sync-seek', ({ currentTime }) => {
    if (!currentRoom) return;
    console.log(`⏩ [${currentRoom}] ${currentNickname} seeked to ${currentTime.toFixed(1)}s`);
    socket.to(currentRoom).emit('sync-seek', {
      currentTime,
      from: currentNickname
    });
  });

  // ---------- CHAT ----------
  socket.on('chat-message', ({ message }) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('chat-message', {
      message,
      nickname: currentNickname,
      socketId: socket.id,
      timestamp: Date.now()
    });
  });

  // ---------- REACTIONS ----------
  socket.on('reaction', ({ emoji }) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('reaction', {
      emoji,
      nickname: currentNickname,
      socketId: socket.id
    });
  });

  // ---------- WEBRTC SIGNALING (Voice Chat) ----------
  socket.on('voice-offer', ({ to, offer }) => {
    io.to(to).emit('voice-offer', {
      from: socket.id,
      nickname: currentNickname,
      offer
    });
  });

  socket.on('voice-answer', ({ to, answer }) => {
    io.to(to).emit('voice-answer', {
      from: socket.id,
      answer
    });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', {
      from: socket.id,
      candidate
    });
  });

  socket.on('voice-toggle', ({ muted }) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('voice-toggle', {
      socketId: socket.id,
      nickname: currentNickname,
      muted
    });
  });

  // ---------- DISCONNECT ----------
  socket.on('disconnect', () => {
    console.log(`❌ Disconnected: ${socket.id} (${currentNickname || 'unknown'})`);

    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.users.delete(socket.id);

      const usersList = Array.from(room.users.values());

      socket.to(currentRoom).emit('user-left', {
        nickname: currentNickname,
        socketId: socket.id,
        users: usersList
      });

      // Delete room if empty
      if (room.users.size === 0) {
        rooms.delete(currentRoom);
        console.log(`🗑️ Room ${currentRoom} deleted (empty)`);
      }
      // Transfer host if host left
      else if (room.host === socket.id) {
        const newHost = room.users.keys().next().value;
        room.host = newHost;
        io.to(currentRoom).emit('host-changed', {
          newHostId: newHost,
          newHostNickname: room.users.get(newHost).nickname
        });
        console.log(`👑 Host transferred in ${currentRoom}`);
      }
    }
  });

  // ---------- LEAVE ROOM ----------
  socket.on('leave-room', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.users.delete(socket.id);
      socket.leave(currentRoom);

      const usersList = Array.from(room.users.values());

      socket.to(currentRoom).emit('user-left', {
        nickname: currentNickname,
        socketId: socket.id,
        users: usersList
      });

      if (room.users.size === 0) {
        rooms.delete(currentRoom);
      }

      console.log(`🚪 ${currentNickname} left room ${currentRoom}`);
      currentRoom = null;
      currentNickname = null;
    }
  });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  🎬 Watch Party Server is running!
  🌐 http://localhost:${PORT}
  📡 WebSocket ready for connections
  `);
});
