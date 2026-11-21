import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { quizRules as rules, validMultiplier, validSeconds } from './public/quiz-rules.js';
import { isLocalOnlyHost } from './public/room-links.js';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.ALLOWED_ORIGIN || true },
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 100000
});
const rooms = new Map();
const graceMs = 120000;
const roomCapacity = 2500;
const mediaBudget = 96 * 1024 * 1024;
let mediaBytesInUse = 0;
const colors = ['#7057ff', '#ff7058', '#06a889', '#f2a900'];
const demoQuiz = [
  { prompt: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correct: 1 },
  { prompt: 'How many sides does a hexagon have?', options: ['Five', 'Six', 'Seven', 'Eight'], correct: 1 },
  { prompt: 'What is the largest ocean on Earth?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correct: 3 }
];

const token = () => randomBytes(32).toString('hex');
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const codeOf = value => String(value ?? '').trim();

function problem(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function storePicture(data, images, label) {
  if (data == null || data === '') return null;
  const prefix = 'data:image/jpeg;base64,';
  if (typeof data !== 'string' || !data.startsWith(prefix) ||
      data.length > prefix.length + 4 * Math.ceil(rules.maxImageBytes / 3)) {
    throw problem(label + 'Please choose the picture again.');
  }
  const encoded = data.slice(prefix.length);
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw problem(label + 'The picture upload was incomplete.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 4 || bytes.length > rules.maxImageBytes ||
      bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff ||
      bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) {
    throw problem(label + 'The picture could not be read.');
  }
  const id = createHash('sha256').update(bytes).digest('hex');
  if (!images.has(id)) images.set(id, bytes);
  return id;
}

function createRoom(spec) {
  const input = spec?.questions ?? demoQuiz;
  if (!Array.isArray(input) || input.length < 1 || input.length > rules.maxQuestions) {
    throw problem('Add between 1 and 50 questions.');
  }
  const images = new Map();
  const questions = input.map((q, index) => {
    const label = `Question ${index + 1}: `;
    const prompt = text(q?.prompt, rules.maxPrompt);
    const imageId = storePicture(q?.imageData, images, label);
    if (!prompt && !imageId) throw problem(label + 'Add a prompt or a picture.');
    if (!Array.isArray(q?.options) || q.options.length !== rules.optionCount) {
      throw problem(label + 'Add four answers.');
    }
    const options = q.options.map(option => text(option, rules.maxOption));
    if (options.some(option => !option) || !Number.isInteger(q.correct) || !options[q.correct]) {
      throw problem(label + 'Fill in all four answers and choose the correct one.');
    }
    // Existing text-only quizzes use the original 20-second, single-points rules.
    const seconds = q.seconds ?? rules.defaultSeconds;
    const multiplier = q.multiplier ?? rules.defaultMultiplier;
    if (!validSeconds(seconds)) throw problem(label + 'Choose a timer of 5 to 300 whole seconds.');
    if (!validMultiplier(multiplier)) throw problem(label + 'Use a multiplier from 0 to 10, with up to two decimal places.');
    return { prompt, imageId, imageAlt: text(q.imageAlt, 180), options, correct: q.correct, seconds, multiplier };
  });
  let mediaBytes = 0;
  for (const image of images.values()) mediaBytes += image.length;
  if (mediaBytesInUse + mediaBytes > mediaBudget) {
    throw problem('Picture storage is full while other games are running. Try again later.', 503);
  }
  let code;
  do { code = String(randomInt(100000, 1000000)); } while (rooms.has(code));
  const room = {
    code, title: text(spec?.title, 60) || 'My Quiz', questions, images, mediaBytes,
    hostToken: token(), host: null, hostTimer: null, timer: null, lobbyTimer: null, progressTimer: null,
    status: 'lobby', questionIndex: -1, deadline: null, reveal: null, seat: 0,
    players: new Map(), names: new Set(), answers: new Map(), pendingAnswers: new Set(),
    standings: [], standingById: new Map()
  };
  mediaBytesInUse += mediaBytes;
  rooms.set(code, room);
  expireWithoutHost(room);
  return room;
}

function expireWithoutHost(room) {
  clearTimeout(room.hostTimer);
  room.hostTimer = setTimeout(() => {
    if (room.host || rooms.get(room.code) !== room) return;
    clearTimeout(room.timer);
    clearTimeout(room.progressTimer);
    clearTimeout(room.lobbyTimer);
    for (const player of room.players.values()) clearTimeout(player.disconnectTimer);
    io.to(room.code).emit('room:closed');
    io.in(room.code).socketsLeave(room.code);
    rooms.delete(room.code);
    mediaBytesInUse -= room.mediaBytes;
  }, graceMs);
}

app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url))));
app.get('/health', (_req, res) => res.json({ ok: true, activeRooms: rooms.size, transport: 'socket.io' }));

// Pictures travel once with room creation. Live events contain only a small, cacheable URL.
app.post('/api/rooms', express.json({ limit: '14mb', inflate: false }), (req, res) => {
  if (!req.is('application/json') || !Array.isArray(req.body?.questions)) {
    return res.status(400).json({ error: 'Submit a quiz with a question list.' });
  }
  const room = createRoom(req.body);
  res.set('Cache-Control', 'no-store').status(201).json({ code: room.code, token: room.hostToken });
});
// The host can export the questionnaire after a refresh, including pictures from later rounds.
app.get('/api/rooms/:code/quiz', (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const room = rooms.get(req.params.code);
  if (!room || req.get('Authorization') !== 'Bearer ' + room.hostToken) {
    return res.status(404).json({ error: 'Quiz file unavailable.' });
  }
  const questions = room.questions.map(({ prompt, options, correct, seconds, multiplier, imageId, imageAlt }) => ({
    prompt, options, correct, seconds, multiplier, imageAlt,
    imageData: imageId ? 'data:image/jpeg;base64,' + room.images.get(imageId).toString('base64') : null
  }));
  res.json({ title: room.title, questions });
});
app.get('/media/:code/:imageId', (req, res) => {
  const image = rooms.get(req.params.code)?.images.get(req.params.imageId);
  if (!image) return res.sendStatus(404);
  res.set({
    'Cache-Control': 'public, max-age=3600, immutable',
    'Content-Type': 'image/jpeg',
    'X-Content-Type-Options': 'nosniff',
    'ETag': '"' + req.params.imageId + '"'
  }).send(image);
});
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  let message = 'Could not create the room. Please try again.';
  if (err.type === 'entity.too.large') message = 'This quiz upload is too large. Choose smaller pictures.';
  else if (err.type === 'entity.parse.failed') message = 'The quiz upload could not be read.';
  else if (status < 500 || status === 503) message = err.message;
  res.status(status).json({ error: message });
});

function publicQuestion(room) {
  const q = room.questions[room.questionIndex];
  if (!q) return null;
  return {
    prompt: q.prompt, options: q.options, seconds: q.seconds, multiplier: q.multiplier,
    imageUrl: q.imageId ? `/media/${room.code}/${q.imageId}` : null, imageAlt: q.imageAlt
  };
}

function lobbySample(room) {
  const sample = [];
  for (const { id, name, color } of room.players.values()) {
    sample.push({ id, name, color, score: 0 });
    if (sample.length === rules.pageSize) break;
  }
  return sample;
}

function publicRoom(room) {
  return {
    code: room.code, title: room.title, status: room.status, questionIndex: room.questionIndex,
    question: publicQuestion(room), questionCount: room.questions.length,
    players: room.status === 'lobby' ? lobbySample(room) : room.standings.slice(0, rules.pageSize),
    answerCount: room.answers.size, totalPlayers: room.players.size,
    reveal: room.reveal, deadline: room.deadline, serverNow: Date.now()
  };
}

function publish(room) {
  io.to(room.code).emit('room:update', publicRoom(room));
}

function scheduleLobbyUpdate(room) {
  if (room.lobbyTimer) return;
  room.lobbyTimer = setTimeout(() => {
    room.lobbyTimer = null;
    if (room.status === 'lobby') publish(room);
  }, 250);
}

function reportProgress(room) {
  if (room.progressTimer) return;
  room.progressTimer = setTimeout(() => {
    room.progressTimer = null;
    if (room.status === 'question' && room.host) io.to(room.host).emit('room:answer-count', room.answers.size);
  }, 200);
}

function rankPlayers(room) {
  const before = room.standingById;
  const priorOrder = p => before.get(p.id)?.rank ?? p.seat;
  const ordered = [...room.players.values()].sort((a, b) => b.score - a.score || priorOrder(a) - priorOrder(b));
  room.standings = ordered.map((p, index) => {
    const rank = index + 1;
    const previousRank = before.get(p.id)?.rank ?? rank;
    return {
      id: p.id, name: p.name, color: p.color, score: p.score,
      rank, previousRank, movement: previousRank - rank, roundPoints: room.answers.get(p.id)?.points ?? 0
    };
  });
  room.standingById = new Map(room.standings.map(row => [row.id, row]));
}

function startQuestion(room, index) {
  if (index === 0) rankPlayers(room);
  room.questionIndex = index;
  room.status = 'question';
  room.reveal = null;
  room.answers.clear();
  room.pendingAnswers = new Set([...room.players.values()].filter(p => !p.expired).map(p => p.id));
  const duration = room.questions[index].seconds * 1000;
  room.deadline = Date.now() + duration;
  room.timer = setTimeout(() => finishQuestion(room), duration);
  publish(room);
}

function finishQuestion(room) {
  if (room.status !== 'question') return;
  clearTimeout(room.timer);
  clearTimeout(room.progressTimer);
  room.progressTimer = null;
  room.status = 'reveal';
  room.deadline = null;
  const q = room.questions[room.questionIndex];
  const counts = q.options.map(() => 0);
  for (const [id, answer] of room.answers) {
    counts[answer.choice]++;
    room.players.get(id).score += answer.points;
  }
  room.reveal = { correct: q.correct, counts };
  rankPlayers(room);
  // Each client gets its own position even outside the top ten. Sort only once per round.
  for (const p of room.players.values()) {
    if (p.socketId) io.to(p.socketId).emit('player:standing', {
      code: room.code, questionIndex: room.questionIndex, row: room.standingById.get(p.id),
      choice: room.answers.get(p.id)?.choice ?? null
    });
  }
  publish(room);
}

function chooseName(room, desired) {
  let name = desired;
  let suffix = 2;
  while (room.names.has(name.toLowerCase())) {
    const tail = ' ' + suffix++;
    name = desired.slice(0, 18 - tail.length) + tail;
  }
  return name;
}

function bindHost(socket, room) {
  clearTimeout(room.hostTimer);
  room.host = socket.id;
  socket.join(room.code);
  socket.data = { role: 'host', code: room.code };
}

function hostLobbyDetails(socket, room) {
  const details = { code: room.code, title: room.title };
  // Only a host connecting locally needs the machine's other addresses.
  if (!isLocalOnlyHost(socket.handshake.address || '')) return details;
  const headers = socket.handshake.headers;
  if (headers.forwarded || headers['x-forwarded-for'] || headers['x-forwarded-host']) return details;
  let hostname;
  try { hostname = new URL('http://' + headers.host).hostname; }
  catch { return details; }
  if (!isLocalOnlyHost(hostname)) return details;
  let interfaces;
  try { interfaces = Object.entries(networkInterfaces()); }
  catch { return details; } // Hosts can enter the Wi-Fi URL if the OS hides its interfaces.
  // Prefer physical Wi-Fi and Ethernet interfaces when a VPN or virtual adapter is also active.
  const physical = name => /^(en\d|eth\d|enp|ens|wlan|wlp|wi-?fi|ethernet)/i.test(name);
  interfaces.sort(([a], [b]) => Number(physical(b)) - Number(physical(a)));
  const addresses = new Set();
  for (const [, records] of interfaces) {
    for (const record of records || []) {
      if (record.family === 'IPv4' && !record.internal && !isLocalOnlyHost(record.address)) addresses.add(record.address);
    }
  }
  return { ...details, lanAddresses: [...addresses] };
}

function bindPlayer(socket, room, p) {
  clearTimeout(p.disconnectTimer);
  p.socketId = socket.id;
  socket.join(room.code);
  socket.data = { role: 'player', code: room.code, playerId: p.id };
  socket.emit('player:joined', {
    name: p.name, code: room.code, playerId: p.id, token: p.resumeToken,
    answerChoice: room.answers.get(p.id)?.choice ?? null, standing: room.standingById.get(p.id) ?? null
  });
  socket.emit('room:update', publicRoom(room));
}

function releaseSocket(socket) {
  const room = rooms.get(socket.data.code);
  if (!room) { socket.data = {}; return; }
  socket.leave(room.code);
  const p = room.players.get(socket.data.playerId);
  if (room.host === socket.id) {
    room.host = null;
    expireWithoutHost(room);
  } else if (p?.socketId === socket.id) {
    p.socketId = null;
    p.disconnectTimer = setTimeout(() => {
      if (p.socketId) return;
      p.expired = true;
      if (room.status === 'lobby') {
        room.players.delete(p.id);
        room.names.delete(p.name.toLowerCase());
        scheduleLobbyUpdate(room);
      } else {
        // Keep earned scores and submitted votes even if a phone stays offline.
        room.pendingAnswers.delete(p.id);
        if (room.pendingAnswers.size === 0 && room.answers.size > 0) finishQuestion(room);
      }
    }, graceMs);
  }
  socket.data = {};
}

io.on('connection', socket => {
  const error = message => socket.emit('app:error', message);
  const canJoin = (value, report = error) => {
    const room = rooms.get(codeOf(value));
    if (!room) report('That room code was not found. Check the six digits and try again.');
    else if (room.status !== 'lobby') report('This game has already started.');
    else if (room.players.size >= roomCapacity) report('This room is full.');
    else return room;
    return null;
  };
  const hostRoom = data => {
    const room = rooms.get(socket.data.code);
    return room?.host === socket.id && data?.code === room.code ? room : null;
  };

  socket.on('room:check', (data, ack) => {
    const replies = typeof ack === 'function';
    const room = canJoin(data?.code, replies ? message => ack({ ok: false, message }) : error);
    if (!room) return;
    if (replies) ack({ ok: true, code: room.code });
    else socket.emit('room:check-result', { code: room.code });
  });

  // Keep the existing Socket.IO creation event for earlier text-only clients.
  socket.on('host:create', data => {
    if (socket.data.code) return error('Finish your current room first.');
    try {
      const room = createRoom(data ?? {});
      bindHost(socket, room);
      socket.emit('host:created', { ...hostLobbyDetails(socket, room), token: room.hostToken });
      socket.emit('room:update', publicRoom(room));
    } catch (err) { error(err.message); }
  });

  socket.on('host:resume', data => {
    const room = rooms.get(codeOf(data?.code));
    if (!room || room.hostToken !== data?.token) return socket.emit('host:resume-denied');
    if (socket.data.code && socket.data.code !== room.code) releaseSocket(socket);
    bindHost(socket, room);
    socket.emit('host:resumed', hostLobbyDetails(socket, room));
    socket.emit('room:update', publicRoom(room));
  });

  socket.on('player:join', data => {
    if (socket.data.code) return error('You already have a place in a room.');
    const room = canJoin(data?.code);
    if (!room) return;
    const desired = text(data?.name, 18).replace(/[<>\u0000-\u001f]/g, '').trim();
    if (!desired) return error('Choose a nickname to join.');
    const name = chooseName(room, desired);
    const p = {
      id: randomBytes(12).toString('hex'), name, score: 0, seat: ++room.seat,
      color: colors[(room.seat - 1) % colors.length], resumeToken: token(), expired: false
    };
    room.players.set(p.id, p);
    room.names.add(name.toLowerCase());
    bindPlayer(socket, room, p);
    scheduleLobbyUpdate(room);
  });

  socket.on('player:resume', data => {
    const room = rooms.get(codeOf(data?.code));
    const p = room?.players.get(data?.playerId);
    if (!p || p.expired || p.resumeToken !== data?.token) return socket.emit('player:resume-denied');
    if (socket.data.code && socket.data.code !== room.code) releaseSocket(socket);
    bindPlayer(socket, room, p);
  });

  socket.on('host:start', data => {
    const room = hostRoom(data);
    if (room?.status !== 'lobby') return error('This game cannot be started.');
    startQuestion(room, 0);
  });

  socket.on('player:answer', (data, ack) => {
    const reply = result => { if (typeof ack === 'function') ack(result); };
    const room = rooms.get(socket.data.code);
    const p = room?.players.get(socket.data.playerId);
    if (!p || p.socketId !== socket.id || room.status !== 'question' ||
        (data?.questionIndex !== undefined && data.questionIndex !== room.questionIndex)) {
      return reply({ ok: false, message: 'This question is no longer open.' });
    }
    const now = Date.now();
    if (now >= room.deadline) {
      reply({ ok: false, message: 'Time is up.' });
      return finishQuestion(room);
    }
    const previous = room.answers.get(p.id);
    if (previous) return reply({ ok: true, choice: previous.choice });
    const choice = data?.choice;
    if (!Number.isInteger(choice) || choice < 0 || choice >= rules.optionCount) {
      return reply({ ok: false, message: 'Choose one of the four answers.' });
    }
    const q = room.questions[room.questionIndex];
    const fractionLeft = Math.min(1, (room.deadline - now) / (q.seconds * 1000));
    const base = Math.round(500 + 500 * fractionLeft);
    const points = choice === q.correct ? Math.round(base * q.multiplier) : 0;
    room.answers.set(p.id, { choice, points });
    room.pendingAnswers.delete(p.id);
    reply({ ok: true, choice });
    if (room.pendingAnswers.size === 0) finishQuestion(room);
    else reportProgress(room);
  });

  socket.on('host:force-reveal', data => {
    const room = hostRoom(data);
    if (!room) return error('Only the host can reveal answers.');
    finishQuestion(room);
  });
  socket.on('host:next', data => {
    const room = hostRoom(data);
    if (room?.status !== 'reveal') return error('Wait for the round results first.');
    if (room.questionIndex + 1 < room.questions.length) return startQuestion(room, room.questionIndex + 1);
    room.status = 'finished';
    publish(room);
  });

  socket.on('room:standings-page', (data, ack) => {
    if (typeof ack !== 'function') return;
    const room = rooms.get(socket.data.code);
    if (!room || !['reveal', 'finished'].includes(room.status) || data?.questionIndex !== room.questionIndex) {
      return ack({ ok: false });
    }
    const offset = data.offset;
    if (!Number.isInteger(offset) || offset < 0 || offset >= room.standings.length) return ack({ ok: false });
    ack({ ok: true, offset, rows: room.standings.slice(offset, offset + rules.pageSize) });
  });
  socket.on('room:leave', () => releaseSocket(socket));
  socket.on('disconnect', () => releaseSocket(socket));
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Quiz Night listening on http://localhost:${port}`));
