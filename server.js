const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const Room = require('./rooms');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const bySocket = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function where(room) {
  return { code: room.code, players: room.playerList(), phase: room.phase };
}

io.on('connection', (socket) => {
  socket.on('join', ({ code, name, avatar }) => {
    if (!code || !name) return socket.emit('errorMsg', 'Oops... Missing data.');

    if (code === 'CREATE') {
      const room = new Room(makeCode(), io);
      rooms.set(room.code, room);
      socket.join(room.code);
      bySocket.set(socket.id, room);
      room.join({ id: socket.id, name, avatar });
      socket.emit('joined', where(room));
      room.broadcast();
      return;
    }

    const room = rooms.get(String(code).toUpperCase());
    if (!room) return socket.emit('errorMsg', `Room ${String(code).toUpperCase()} not found.`);
    if (room.players.length >= 2) return socket.emit('errorMsg', 'That room is full.');
    if (room.phase !== 'lobby') return socket.emit('errorMsg', 'That game already started.');
    if (room.players.some((p) => p.name.toLowerCase() === String(name).toLowerCase())) {
      return socket.emit('errorMsg', 'That nickname is already used in this room. Pick another.');
    }

    socket.join(room.code);
    bySocket.set(socket.id, room);
    room.join({ id: socket.id, name, avatar });
    socket.emit('joined', where(room));
      room.broadcast();
  });

  socket.on('lobbyOptions', (opts) => {
    const room = bySocket.get(socket.id);
    if (!room) return;
    const p = room.player(socket.id);
    if (!p) return;
    if (opts.confirmAdult !== undefined) p.confirmAdult = !!opts.confirmAdult;
    if (Array.isArray(opts.categories)) {
      p.categories = [...new Set(opts.categories)].filter((c) => c !== 'adult' || p.confirmAdult);
    }
      room.broadcast();
  });

  socket.on('startGame', () => {
    const room = bySocket.get(socket.id);
    if (!room) return;
    try {
      room.startGame();
      room.broadcast();
    } catch (e) {
      socket.emit('errorMsg', e.message);
    }
  });

  socket.on('chooseCategory', (category) => {
    const room = bySocket.get(socket.id);
    if (!room) return;
    try {
      room.chooseCategory(category);
      room.broadcast();
    } catch (e) {
      socket.emit('errorMsg', e.message);
    }
  });

  socket.on('askCustom', ({ text, toPool }) => {
    const room = bySocket.get(socket.id);
    if (!room) return;
    try {
      room.askCustom(socket.id, text, !!toPool);
      room.broadcast();
    } catch (e) {
      socket.emit('errorMsg', e.message);
    }
  });

  socket.on('questionRating', (s) => {
    const room = bySocket.get(socket.id);
    if (!room) return;
    try {
      room.questionRating(socket.id, s);
      room.broadcast();
    } catch (e) {
      socket.emit('errorMsg', e.message);
    }
  });

  socket.on('rejectQuestion', () => {
    const room = bySocket.get(socket.id);
    if (!room) return;
    try {
      room.rejectQuestion(socket.id);
      room.broadcast();
    } catch (e) {
      socket.emit('errorMsg', e.message);
    }
  });

  socket.on('submitAnswer', (text) => {
    const room = bySocket.get(socket.id);
    if (!room) return;
    try {
      room.submitAnswer(socket.id, text);
      room.broadcast();
    } catch (e) {
      socket.emit('errorMsg', e.message);
    }
  });

  socket.on('answerRating', (s) => {
    const room = bySocket.get(socket.id);
    if (!room) return;
    try {
      room.answerRating(socket.id, s);
      room.broadcast();
    } catch (e) {
      socket.emit('errorMsg', e.message);
    }
  });

  socket.on('addCustom', (text) => {
    const room = bySocket.get(socket.id);
    if (!room) return;
    try {
      room.addCustom(socket.id, text);
      room.broadcast();
    } catch (e) {
      socket.emit('errorMsg', e.message);
    }
  });

  socket.on('removeCustom', (qid) => {
    const room = bySocket.get(socket.id);
    if (!room) return;
    try {
      room.removeCustom(socket.id, qid);
      room.broadcast();
    } catch (e) {
      socket.emit('errorMsg', e.message);
    }
  });

  socket.on('playAgain', () => {
    const room = bySocket.get(socket.id);
    if (!room) return;
    room.playAgain();
    room.emitToBoth('system', { text: 'Back to the lobby! Pick categories and start again.' });
    room.broadcast();
  });

  socket.on('endGame', () => {
    const room = bySocket.get(socket.id);
    if (!room) return;
    room.endGame();
    room.broadcast();
  });

  socket.on('leave', () => {
    const room = bySocket.get(socket.id);
    bySocket.delete(socket.id);
    if (!room) return;
    const p = room.player(socket.id);
    room.leave(socket.id);
    socket.leave(room.code);
    if (p && room.players.length) {
      room.emitToBoth("system", { text: `${p.name} left the game.` });
    }
    if (room.players.length) room.broadcast();
    else rooms.delete(room.code);
  });

  socket.on('disconnect', () => {
    const room = bySocket.get(socket.id);
    bySocket.delete(socket.id);
    if (!room) return;
    const p = room.player(socket.id);
    room.leave(socket.id);
    socket.leave(room.code);
    if (p && room.players.length) {
      room.emitToBoth("system", { text: `${p.name} disconnected.` });
    }
    if (room.players.length) room.broadcast();
    else rooms.delete(room.code);
  });
});

server.listen(PORT, () => {
  console.log(`Ask Me running on http://localhost:${PORT}`);
});
