const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 2 * 1024 * 1024 * 1024, // 2GB max per message
});

const PORT = process.env.PORT || 3000;

// Serve built React app (or fallback to public for dev)
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

// Maximum total bytes per room session (server-side enforcement)
const MAX_ROOM_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

const MAX_RECEIVERS_PER_ROOM = 20;

// ---------- In-memory room state ----------
// rooms: Map<roomCode, {
//   senderId: socketId | null,
//   receiverIds: Set<socketId>,
//   totalBytesReceived: number,
//   files: Map<fileId, { ... }>
// }>

const rooms = new Map();

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // 6-char hex
}

function getRoom(code) {
  const key = code.toUpperCase();
  if (!rooms.has(key)) {
    rooms.set(key, {
      senderId: null,
      receiverIds: new Set(),
      totalBytesReceived: 0,
      files: new Map(),
      texts: new Map(),
      createdAt: Date.now(),
    });
  }
  return rooms.get(key);
}

function emitToReceivers(room, event, data) {
  for (const sid of room.receiverIds) {
    io.to(sid).emit(event, data);
  }
}

// Cleanup stale rooms every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    // Remove rooms older than 30 minutes with no connections
    if (now - room.createdAt > 30 * 60 * 1000 && !room.senderId && room.receiverIds.size === 0) {
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000);

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  // ---- CREATE ROOM ----
  socket.on('create-room', () => {
    let code;
    // Ensure unique code
    do {
      code = generateRoomCode();
    } while (rooms.has(code));

    const room = getRoom(code);
    room.senderId = socket.id;
    socket.join(code);
    socket.emit('room-created', { code });
    console.log(`  -> Room ${code} created by ${socket.id}`);
  });

  // ---- JOIN ROOM ----
  socket.on('join-room', ({ code }) => {
    const key = code.toUpperCase();
    const room = rooms.get(key);

    if (!room || !room.senderId) {
      socket.emit('error-message', { message: 'Room not found or sender not connected.' });
      return;
    }

    if (room.receiverIds.has(socket.id)) {
      socket.emit('room-joined', { code: key });
      return;
    }

    if (room.receiverIds.size >= MAX_RECEIVERS_PER_ROOM) {
      socket.emit('error-message', { message: `Room has reached the maximum of ${MAX_RECEIVERS_PER_ROOM} receivers.` });
      return;
    }

    room.receiverIds.add(socket.id);
    socket.join(key);
    socket.emit('room-joined', { code: key });

    // Notify sender of receiver count
    io.to(room.senderId).emit('receiver-count-update', { count: room.receiverIds.size });
    console.log(`  -> ${socket.id} joined room ${key} (${room.receiverIds.size} receivers)`);
  });

  // ---- SENDER UPLOADS FILE META ----
  socket.on('file-meta', ({ room: roomCode, fileId, fileName, fileType, fileSize, totalChunks }) => {
    const key = roomCode.toUpperCase();
    const room = rooms.get(key);
    if (!room || room.senderId !== socket.id) return;

    room.files.set(fileId, {
      fileName,
      fileType,
      fileSize,
      chunks: [],
      receivedChunks: 0,
      totalChunks,
      completed: false,
      downloaded: false,
    });

    // Forward meta to all receivers
    emitToReceivers(room, 'file-meta', { fileId, fileName, fileType, fileSize, totalChunks });
    console.log(`  -> File meta: ${fileName} (${fileId}) in room ${key}`);
  });

  // ---- SENDER UPLOADS FILE CHUNK ----
  socket.on('file-chunk', ({ room: roomCode, fileId, chunkIndex, data }) => {
    const key = roomCode.toUpperCase();
    const room = rooms.get(key);
    if (!room || room.senderId !== socket.id) return;

    const file = room.files.get(fileId);
    if (!file || file.completed) return;

    // Server-side size enforcement
    room.totalBytesReceived += data.length;
    if (room.totalBytesReceived > MAX_ROOM_BYTES) {
      // Clean up and notify both parties
      for (const [, f] of room.files) f.chunks = [];
      room.files.clear();
      io.to(room.senderId).emit('error-message', { message: 'Upload limit exceeded (2GB)' });
      emitToReceivers(room, 'error-message', { message: 'Upload limit exceeded by sender' });
      return;
    }

    // Store chunk
    file.chunks[chunkIndex] = Buffer.from(data);
    file.receivedChunks++;

    // Forward chunk to all receivers
    emitToReceivers(room, 'file-chunk', { fileId, chunkIndex, data });

    // Check if complete
    if (file.receivedChunks >= file.totalChunks) {
      file.completed = true;
      console.log(`  -> File ${file.fileName} complete in room ${key}`);
    }
  });

  // ---- RECEIVER DOWNLOADED FILE ----
  socket.on('file-downloaded', ({ room: roomCode, fileId }) => {
    const key = roomCode.toUpperCase();
    const room = rooms.get(key);
    if (!room || !room.receiverIds.has(socket.id)) return;

    const file = room.files.get(fileId);
    if (file) {
      file.downloaded = true;
      // Clear the buffer to free memory
      file.chunks = [];
      console.log(`  -> File ${fileId} downloaded by ${socket.id}, memory cleared`);
    }
  });

  // ---- SHARE TEXT (sender) ----
  socket.on('share-text', ({ room: roomCode, textId, content, timestamp }) => {
    const key = roomCode.toUpperCase();
    const room = rooms.get(key);
    if (!room || room.senderId !== socket.id || room.receiverIds.size === 0) return;

    // Enforce text size limit (100KB)
    if (typeof content !== 'string' || content.length > 100000) {
      io.to(room.senderId).emit('error-message', { message: 'Text exceeds 100,000 character limit' });
      return;
    }

    // Track text metadata
    room.texts.set(textId, { timestamp, copied: false });

    // Forward to all receivers
    emitToReceivers(room, 'receive-text', { textId, content, timestamp });
    console.log(`  -> Text (${content.length} chars) shared in room ${key}`);
  });

  // ---- TEXT RECEIVED/COPIED (receiver acknowledges) ----
  socket.on('text-received', ({ room: roomCode, textId }) => {
    const key = roomCode.toUpperCase();
    const room = rooms.get(key);
    if (!room || !room.receiverIds.has(socket.id)) return;

    if (room.texts) {
      const t = room.texts.get(textId);
      if (t) t.copied = true;
    }

    // Notify sender that receiver got the text
    io.to(room.senderId).emit('text-delivered', { textId });
    console.log(`  -> Text ${textId} delivered in room ${key}`);
  });

  // ---- CANCEL UPLOAD (sender) ----
  socket.on('cancel-file', ({ room: roomCode, fileId }) => {
    const key = roomCode.toUpperCase();
    const room = rooms.get(key);
    if (!room) return;

    const file = room.files.get(fileId);
    if (file) {
      file.chunks = [];
      room.files.delete(fileId);
    }
    emitToReceivers(room, 'file-cancelled', { fileId });
  });

  // ---- DISCONNECT ----
  socket.on('disconnect', () => {
    console.log(`[-] Socket disconnected: ${socket.id}`);

    for (const [code, room] of rooms.entries()) {
      let changed = false;

      if (room.senderId === socket.id) {
        // Sender disconnected — notify all receivers and clean up
        emitToReceivers(room, 'sender-disconnected');
        // Clean up all file buffers and reset
        for (const [, file] of room.files) file.chunks = [];
        room.totalBytesReceived = 0;
        room.texts = new Map();
        room.senderId = null;
        changed = true;
        console.log(`  -> Sender left room ${code}`);
      }

      if (room.receiverIds.has(socket.id)) {
        room.receiverIds.delete(socket.id);
        changed = true;
        // Notify sender with updated count
        if (room.senderId) {
          room.texts = new Map();
          io.to(room.senderId).emit('receiver-count-update', { count: room.receiverIds.size });
        }
        console.log(`  -> Receiver ${socket.id} left room ${code} (${room.receiverIds.size} remaining)`);
      }

      // If room is empty, schedule cleanup
      if (changed && !room.senderId && room.receiverIds.size === 0) {
        setTimeout(() => {
          const r = rooms.get(code);
          if (r && !r.senderId && r.receiverIds.size === 0) {
            rooms.delete(code);
            console.log(`  -> Room ${code} cleaned up`);
          }
        }, 60_000); // give 1 min grace
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ⚡ BlazeShare running at http://localhost:${PORT}\n`);
});
