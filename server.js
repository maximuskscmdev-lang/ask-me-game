const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const Room = require('./rooms');

const PORT = process.env.PORT || 3000;
const RECONNECT_GRACE_MS = 60000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const bySocket = new Map();
const pendingLeaves = new Map(); // socketId -> { room, timer } : dropped, still reclaimable

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function detach(socketId, leftVoluntarily) {
  const room = bySocket.get(socketId);
  const pend = pendingLeaves.get(socketId);
  if (pend) {
    clearTimeout(pend.timer);
    pendingLeaves.delete(socketId);
  }
  bySocket.delete(socketId);
  if (!room) return;
  const p = room.player(socketId);
  room.leave(socketId);
  if (room.players.length) {
    if (leftVoluntarily && p) room.emitToBoth('system', { text: `${p.name} left the game.` });
    room.broadcast();
  } else {
    rooms.delete(room.code);
  }
}

/* re-attach an existing player (matched by nickname) to a new socket */
function doRejoin(socket, room, name) {
  const pendFor = [...pendingLeaves.entries()].find(([, pend]) => pend.room === room);
  const p = room.players.find((pl) => pl.name.toLowerCase() === String(name).toLowerCase());
  if (!p) {
    return socket.emit('errorMsg', 'That nickname is not in this room. Pick the one you joined with.');
  }
  if (pendFor) {
    clearTimeout(pendFor[1].timer);
    pendingLeaves.delete(pendFor[0]);
  }
  const oldId = p.id;
  p.id = socket.id;
  p.connected = true;
  socket.join(room.code);
  bySocket.set(socket.id, room);
  if (oldId !== socket.id) bySocket.delete(oldId);
  room.emitToBoth('system', { text: `${p.name} reconnected!` });
  socket.emit('joined', room.wide());
  room.broadcast();
}

io.on('connection', (socket) => {
  // socket.io may reuse the same id when the session survives a short blip
  const reattachable = bySocket.get(socket.id);

  const roomOf = () => {
    const room = bySocket.get(socket.id);
    if (!room) {
      socket.emit('errorMsg', 'You are no longer connected to a game. Reload the page to rejoin.');
      return null;
    }
    return room;
  };
  const withRoom = (fn) => (arg) => {
    const room = roomOf();
    if (!room) return;
    try {
      fn(room, arg);
      room.broadcast();
    } catch (e) {
      socket.emit('errorMsg', e.message);
    }
  };

  socket.on('join', ({ code, name, avatar }) => {
    if (!code || !name) return socket.emit('errorMsg', 'Oops... Missing data.');

    if (code === 'CREATE') {
      const room = new Room(makeCode(), io);
      rooms.set(room.code, room);
      socket.join(room.code);
      bySocket.set(socket.id, room);
      room.join({ id: socket.id, name, avatar });
      socket.emit('joined', room.wide());
      room.broadcast();
      return;
    }

    const room = rooms.get(String(code).toUpperCase());
    if (!room) return socket.emit('errorMsg', `Room ${String(code).toUpperCase()} not found.`);
    if (room.players.length >= 2 && !room.players.some((p) => p.name.toLowerCase() === String(name).toLowerCase())) {
      return socket.emit('errorMsg', 'That room is full.');
    }
    if (room.phase !== 'lobby' && !room.players.some((p) => p.name.toLowerCase() === String(name).toLowerCase())) {
      return socket.emit('errorMsg', 'That game already started.');
    }
    if (room.players.length === 2 || room.phase !== 'lobby') return doRejoin(socket, room, name);
    if (room.players.some((p) => p.name.toLowerCase() === String(name).toLowerCase())) {
      return socket.emit('errorMsg', 'That nickname is already used in this room. Pick another.');
    }

    socket.join(room.code);
    bySocket.set(socket.id, room);
    room.join({ id: socket.id, name, avatar });
    socket.emit('joined', room.wide());
    room.broadcast();
  });

  // rejoin after a reconnect that got a new socket id (also used by mid-game page reloads)
  socket.on('rejoin', ({ code, name }) => {
    const room = rooms.get(String(code).toUpperCase());
    if (!room) return socket.emit('errorMsg', 'Could not rejoin - the game may have ended. Reload the page to start fresh.');
    doRejoin(socket, room, name);
  });

  socket.on('lobbyOptions', (opts) => {
    const room = roomOf();
    if (!room) return;
    const p = room.player(socket.id);
    if (!p) return;
    if (opts.confirmAdult !== undefined) p.confirmAdult = !!opts.confirmAdult;
    if (Array.isArray(opts.categories)) {
      p.categories = [...new Set(opts.categories)].filter((c) => c !== 'adult' || p.confirmAdult);
    }
    room.broadcast();
  });

  socket.on('startGame', withRoom((room) => room.startGame()));
  socket.on('chooseCategory', withRoom((room, c) => room.chooseCategory(c)));
  socket.on('askCustom', withRoom((room, { text, toPool }) => room.askCustom(socket.id, text, !!toPool)));
  socket.on('questionRating', withRoom((room, v) => room.questionRating(socket.id, v)));
  socket.on('rejectQuestion', withRoom((room) => room.rejectQuestion(socket.id)));
  socket.on('submitAnswer', withRoom((room, text) => room.submitAnswer(socket.id, text)));
  socket.on('answerRating', withRoom((room, v) => room.answerRating(socket.id, v)));
  socket.on('addCustom', withRoom((room, text) => room.addCustom(socket.id, text)));
  socket.on('removeCustom', withRoom((room, qid) => room.removeCustom(socket.id, qid)));

  socket.on('playAgain', () => {
    const room = roomOf();
    if (!room) return;
    room.playAgain();
    room.emitToBoth('system', { text: 'Back to the lobby! Pick categories and start again.' });
    room.broadcast();
  });

  socket.on('endGame', withRoom((room) => room.endGame()));

  socket.on('leave', () => {
    detach(socket.id, true);
    socket.emit('leftRoom');
  });

  socket.on('disconnect', () => {
    const room = bySocket.get(socket.id);
    if (!room) return;
    const p = room.player(socket.id);
    if (!p) {
      bySocket.delete(socket.id);
      return;
    }
    if (pendingLeaves.has(socket.id)) return;
    p.connected = false;
    room.emitToBoth('system', { text: `${p.name} lost connection - reconnecting...` });
    const timer = setTimeout(() => {
      pendingLeaves.delete(socket.id);
      const r = bySocket.get(socket.id);
      if (r) {
        r.leave(socket.id);
        bySocket.delete(socket.id);
        if (r.players.length) {
          r.emitToBoth('system', { text: `${p.name} was disconnected.` });
          r.broadcast();
        } else {
          rooms.delete(r.code);
        }
      }
    }, RECONNECT_GRACE_MS);
    pendingLeaves.set(socket.id, { room, timer });
    room.broadcast();
  });

  // handlers registered above; now (re)attach if this is a recovering socket
  if (reattachable && reattachable.player(socket.id)) {
    const pend = pendingLeaves.get(socket.id);
    if (pend) {
      clearTimeout(pend.timer);
      pendingLeaves.delete(socket.id);
    }
    const p = reattachable.player(socket.id);
    p.connected = true;
    socket.join(reattachable.code);
    reattachable.emitToBoth('system', { text: `${p.name} reconnected!` });
    socket.emit('joined', reattachable.wide());
    reattachable.broadcast();
  }
});

server.listen(PORT, () => {
  console.log(`Ask Me running on http://localhost:${PORT}`);
});
