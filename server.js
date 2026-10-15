const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const DECK = require('./deck');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || /^\/[A-Z]{4}$/i.test(p)) p = '/index.html'; // /ABCD -> page de la room
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
const io = new Server(server);

/* ---------- Règles ---------- */
const Z4 = 1.8, Z3 = 5.4, Z2 = 9;
const zone = d => (d <= Z4 ? 4 : d <= Z3 ? 3 : d <= Z2 ? 2 : 0);
const COLORS = ['#ff7a59', '#ffd23f', '#3bceac', '#c4a7ff', '#f472b6', '#6cb6ff', '#ffffff', '#9ae66e', '#ff9f1c', '#2ec4b6', '#e0aaff', '#cbf3f0'];
const MAX_PLAYERS = 12;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const rooms = new Map();

function newCode() {
  let code;
  do { code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function createRoom() {
  const room = {
    code: newCode(), hostId: null, players: [], laps: 2, phase: 'lobby',
    round: 0, totalRounds: 0, psychicId: null, card: null, target: 50, clue: '',
    guesses: {}, results: null, deck: shuffle(DECK.map((_, i) => i)), deckPos: 0, emptySince: null,
  };
  rooms.set(room.code, room);
  return room;
}

const connected = room => room.players.filter(p => p.connected);
const player = (room, id) => room.players.find(p => p.id === id);
const guessers = room => room.players.filter(p => p.id !== room.psychicId && p.inRound);

function drawCard(room) {
  if (room.deckPos >= room.deck.length) { room.deck = shuffle(room.deck); room.deckPos = 0; }
  room.card = DECK[room.deck[room.deckPos++]].slice();
}

function nextPsychic(room) {
  const list = room.players;
  const i = list.findIndex(p => p.id === room.psychicId);
  for (let k = 1; k <= list.length; k++) {
    const p = list[(i + k + list.length) % list.length];
    if (p.connected) return p.id;
  }
  return list[0].id;
}

function startRound(room) {
  room.psychicId = room.round === 0 ? room.players[0].id : nextPsychic(room);
  room.players.forEach(p => { p.inRound = p.connected; });
  drawCard(room);
  room.target = Z2 + Math.random() * (100 - 2 * Z2);
  room.clue = ''; room.guesses = {}; room.results = null;
  room.phase = 'clue';
}

function maybeReveal(room) {
  if (room.phase !== 'guess') return;
  const waiting = guessers(room).filter(p => p.connected && !(p.id in room.guesses));
  if (waiting.length === 0 && Object.keys(room.guesses).length > 0) reveal(room);
}

function reveal(room) {
  const rows = Object.entries(room.guesses).map(([id, v]) => {
    const d = Math.abs(v - room.target);
    return { id, v, d, pts: zone(d), bonus: 0 };
  });
  const scoring = rows.filter(r => r.pts > 0);
  if (rows.length > 1 && scoring.length) {
    const best = Math.min(...scoring.map(r => r.d));
    scoring.forEach(r => { if (r.d - best < 0.05) r.bonus = 1; });
  }
  const psyPts = Math.ceil(Math.max(0, ...rows.map(r => r.pts)) / 2);
  rows.forEach(r => { const p = player(room, r.id); if (p) p.score += r.pts + r.bonus; });
  const psy = player(room, room.psychicId);
  if (psy) psy.score += psyPts;
  room.results = { rows: rows.sort((a, b) => a.d - b.d), psyPts };
  room.phase = 'reveal';
}

/* Chaque joueur reçoit sa propre vue : la cible n'est envoyée qu'au meneur avant la révélation. */
function viewFor(room, id) {
  const isPsy = id === room.psychicId;
  const showTarget = room.phase === 'reveal' || room.phase === 'end' || (isPsy && (room.phase === 'clue' || room.phase === 'guess'));
  return {
    code: room.code, you: id, hostId: room.hostId, phase: room.phase, laps: room.laps,
    round: room.round, totalRounds: room.totalRounds, psychicId: room.psychicId,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score, connected: p.connected, inRound: !!p.inRound })),
    card: room.card, clue: room.clue,
    target: showTarget ? room.target : null,
    locked: Object.keys(room.guesses),
    myGuess: room.guesses[id] ?? null,
    results: room.phase === 'reveal' ? room.results : null,
  };
}

function broadcast(room) {
  for (const p of room.players) {
    if (p.connected && p.socketId) io.to(p.socketId).emit('state', viewFor(room, p.id));
  }
}

function fixHost(room) {
  const host = player(room, room.hostId);
  if (!host || !host.connected) {
    const c = connected(room)[0];
    if (c) room.hostId = c.id;
  }
}

/* ---------- Sockets ---------- */
io.on('connection', socket => {
  let room = null, me = null;
  const fail = msg => socket.emit('fail', msg);
  const isHost = () => room && me && room.hostId === me.id;
  const isPsy = () => room && me && room.psychicId === me.id;

  function enter(r, id, name) {
    let p = player(r, id);
    if (!p && r.players.length >= MAX_PLAYERS) return fail('La room est pleine (12 joueurs max).');
    if (room && room !== r) detach();
    if (!p) {
      const used = new Set(r.players.map(x => x.color));
      p = { id, name, color: COLORS.find(c => !used.has(c)) || COLORS[r.players.length % COLORS.length], score: 0, connected: true, inRound: false };
      r.players.push(p);
    }
    if (name) p.name = name;
    p.connected = true; p.socketId = socket.id;
    r.emptySince = null;
    room = r; me = p;
    socket.join(r.code);
    if (!r.hostId) r.hostId = p.id;
    fixHost(r);
    broadcast(r);
  }

  socket.on('create', ({ id, name }) => {
    name = clean(name, 18); id = clean(id, 40);
    if (!name || !id) return fail('Choisis un pseudo.');
    enter(createRoom(), id, name);
  });

  socket.on('join', ({ id, name, code }) => {
    name = clean(name, 18); id = clean(id, 40); code = clean(code, 4).toUpperCase();
    const r = rooms.get(code);
    if (!r) return fail(`La room ${code || '?'} n'existe pas (ou plus).`);
    if (!id) return fail('Identifiant manquant, recharge la page.');
    if (!name && !player(r, id)) return fail('Choisis un pseudo.');
    enter(r, id, name);
  });

  // Retire le joueur de sa room actuelle (bouton Quitter, ou quand il rejoint/crée une autre room)
  function detach() {
    if (!room || !me) return;
    const r = room, id = me.id;
    room = null; me = null;
    socket.leave(r.code);
    r.players = r.players.filter(p => p.id !== id);
    delete r.guesses[id];
    if (!r.players.length) { rooms.delete(r.code); return; }
    if (r.hostId === id) r.hostId = null;
    if (r.psychicId === id && (r.phase === 'clue' || r.phase === 'guess')) startRound(r);
    fixHost(r); maybeReveal(r); broadcast(r);
  }

  socket.on('leave', detach);

  socket.on('settings', ({ laps }) => {
    if (!isHost() || room.phase !== 'lobby') return;
    room.laps = Math.max(1, Math.min(5, laps | 0));
    broadcast(room);
  });

  socket.on('start', () => {
    if (!isHost() || !(room.phase === 'lobby' || room.phase === 'end')) return;
    if (connected(room).length < 2) return fail('Il faut au moins 2 joueurs connectés.');
    room.players = room.players.filter(p => p.connected);
    room.players.forEach(p => { p.score = 0; });
    room.round = 0; room.totalRounds = room.players.length * room.laps;
    startRound(room); broadcast(room);
  });

  socket.on('reroll', () => {
    if (!isPsy() || room.phase !== 'clue') return;
    drawCard(room); broadcast(room);
  });

  socket.on('clue', ({ clue, left, right }) => {
    if (!isPsy() || room.phase !== 'clue') return;
    left = clean(left, 30); right = clean(right, 30);
    if (left && right) room.card = [left, right];
    room.clue = clean(clue, 60);
    room.phase = 'guess';
    broadcast(room);
  });

  socket.on('guess', ({ value }) => {
    if (!room || room.phase !== 'guess' || isPsy() || !me.inRound) return;
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    room.guesses[me.id] = Math.max(0, Math.min(100, v));
    maybeReveal(room); broadcast(room);
  });

  socket.on('forceReveal', () => {
    if (!(isHost() || isPsy()) || room.phase !== 'guess' || !Object.keys(room.guesses).length) return;
    reveal(room); broadcast(room);
  });

  socket.on('skip', () => {
    if (!isHost() || !(room.phase === 'clue' || room.phase === 'guess')) return;
    startRound(room); broadcast(room);
  });

  socket.on('next', () => {
    if (!(isHost() || isPsy()) || room.phase !== 'reveal') return;
    room.round++;
    if (room.round >= room.totalRounds) room.phase = 'end';
    else startRound(room);
    broadcast(room);
  });

  socket.on('lobby', () => {
    if (!isHost() || room.phase !== 'end') return;
    room.phase = 'lobby'; room.players.forEach(p => { p.score = 0; });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    if (!room || !me || me.socketId !== socket.id) return;
    me.connected = false;
    if (!connected(room).length) { room.emptySince = Date.now(); return; }
    fixHost(room); maybeReveal(room); broadcast(room);
  });
});

// Supprime les rooms vides depuis plus de 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) if (r.emptySince && now - r.emptySince > 30 * 60 * 1000) rooms.delete(code);
}, 60 * 1000);

server.listen(PORT, () => console.log(`Longueur d'onde → http://localhost:${PORT}`));
