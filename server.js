// Live-Quiz-Server: hält den gesamten Zustand nur im Arbeitsspeicher.
// Nichts wird auf Platte oder in einer Datenbank gespeichert – ein Neustart löscht alles.
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { loadAllDecks, loadDeck } = require('./decks');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  if (process.env.NODE_ENV === 'production') {
    ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
    console.warn(`⚠ ADMIN_PASSWORD ist nicht gesetzt. Einmal-Passwort für diesen Start: ${ADMIN_PASSWORD}`);
  } else {
    ADMIN_PASSWORD = 'admin';
    console.warn('⚠ ADMIN_PASSWORD ist nicht gesetzt – lokal gilt das Passwort "admin".');
  }
}

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e4 });

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
// Schrift Lato lokal ausliefern (keine Anfragen an Google)
app.use('/fonts', express.static(path.join(__dirname, 'node_modules/@fontsource/lato/files'), { maxAge: '30d' }));
app.get('/healthz', (_req, res) => res.send('ok'));

function joinUrl(req) {
  return PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
}
app.get('/api/join-url', (req, res) => res.json({ url: joinUrl(req) }));
app.get('/qr.svg', async (req, res) => {
  const svg = await QRCode.toString(joinUrl(req), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
});

// ---------------------------------------------------------------------------
// Zustand der Live-Session (nur im Speicher)
// phase: 'lobby' → 'question' → 'reveal' → 'question' → … → 'end'
const state = {
  deck: null,
  phase: 'lobby',
  index: -1,
  participants: new Map(), // clientId -> { name, sockets: Set<socketId> }
  answers: new Map(), // questionIndex -> Map<clientId, number[]>
};

const timingSafeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

const currentQuestion = () =>
  state.deck && state.index >= 0 && state.index < state.deck.questions.length ? state.deck.questions[state.index] : null;

function publicState() {
  const q = currentQuestion();
  const s = {
    phase: state.phase,
    deckTitle: state.deck ? state.deck.title : null,
    index: state.index,
    total: state.deck ? state.deck.questions.length : 0,
    question: null,
  };
  if (q && (state.phase === 'question' || state.phase === 'reveal')) {
    s.question = { slide: q.slide, text: q.text, options: q.options, multi: q.multi };
    if (state.phase === 'reveal') {
      s.question.correct = q.correct;
      s.question.explanation = q.explanation;
    }
  }
  return s;
}

function connectedParticipants() {
  return [...state.participants.entries()]
    .filter(([, p]) => p.sockets.size > 0)
    .map(([id, p]) => ({ id, name: p.name }));
}

function adminState() {
  const q = currentQuestion();
  const s = publicState();
  s.participants = connectedParticipants().sort((a, b) => a.name.localeCompare(b.name, 'de'));
  s.decks = loadAllDecks().map((d) => ({ id: d.id, title: d.title, count: d.questions.length, error: d.error || null }));
  s.deckId = state.deck ? state.deck.id : null;
  s.slides = state.deck ? state.deck.questions.map((x, i) => ({ index: i, slide: x.slide })) : [];
  if (q) {
    // Admin sieht die richtige Antwort immer (für die Vorbereitung), der Beamer erst beim Aufdecken
    s.question = { ...s.question, slide: q.slide, text: q.text, options: q.options, multi: q.multi, correct: q.correct, explanation: q.explanation };
    const answers = state.answers.get(state.index) || new Map();
    const counts = q.options.map(() => 0);
    for (const choice of answers.values()) for (const c of choice) counts[c]++;
    s.answerCount = answers.size;
    s.counts = counts;
  }
  if (state.phase === 'end' && state.deck) s.summary = scoreboard();
  return s;
}

// Ergebnis pro Person – wird nur im Speicher berechnet und nur dem Admin gezeigt
function scoreboard() {
  const rows = [];
  for (const [id, p] of state.participants) {
    let right = 0;
    let answered = 0;
    state.deck.questions.forEach((q, i) => {
      const a = state.answers.get(i)?.get(id);
      if (!a) return;
      answered++;
      if (a.length === q.correct.length && a.every((x, k) => x === q.correct[k])) right++;
    });
    rows.push({ name: p.name, right, answered });
  }
  return rows.sort((a, b) => b.right - a.right || a.name.localeCompare(b.name, 'de'));
}

let adminTimer = null;
function pushAdmin() {
  // kleine Bündelung, damit viele gleichzeitige Klicks nicht zu viele Updates erzeugen
  if (adminTimer) return;
  adminTimer = setTimeout(() => {
    adminTimer = null;
    io.to('admins').emit('admin:state', adminState());
  }, 150);
}

function myAnswer(clientId) {
  return state.answers.get(state.index)?.get(clientId) || null;
}

function broadcast() {
  const pub = publicState();
  for (const [id, p] of state.participants) {
    for (const sid of p.sockets) io.to(sid).emit('state', { ...pub, myAnswer: myAnswer(id) });
  }
  io.to('admins').emit('admin:state', adminState());
}

function goTo(index, phase) {
  state.index = index;
  state.phase = phase;
  broadcast();
}

function next() {
  if (!state.deck) return;
  const total = state.deck.questions.length;
  if (state.phase === 'lobby') return goTo(0, 'question');
  if (state.phase === 'question') return goTo(state.index, 'reveal');
  if (state.phase === 'reveal') return state.index + 1 < total ? goTo(state.index + 1, 'question') : goTo(state.index, 'end');
}

function prev() {
  if (!state.deck) return;
  if (state.phase === 'end') return goTo(state.deck.questions.length - 1, 'reveal');
  if (state.phase === 'reveal') return goTo(state.index, 'question');
  if (state.phase === 'question') return state.index > 0 ? goTo(state.index - 1, 'reveal') : goTo(-1, 'lobby');
}

const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 40);
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);

io.on('connection', (socket) => {
  let clientId = null;
  let isAdmin = false;

  // --- Teilnehmende ---
  socket.on('join', (data, ack) => {
    const name = cleanName(data && data.name);
    if (!validId(data && data.clientId) || !name) return ack && ack({ ok: false, error: 'Bitte einen Namen eingeben.' });
    clientId = data.clientId;
    let p = state.participants.get(clientId);
    if (!p) {
      p = { name, sockets: new Set() };
      state.participants.set(clientId, p);
    }
    p.name = name;
    p.sockets.add(socket.id);
    ack && ack({ ok: true });
    socket.emit('state', { ...publicState(), myAnswer: myAnswer(clientId) });
    pushAdmin();
  });

  socket.on('answer', (choice, ack) => {
    const q = currentQuestion();
    if (!clientId || !q || state.phase !== 'question') return ack && ack({ ok: false });
    let list = Array.isArray(choice) ? choice : [choice];
    list = [...new Set(list.filter((c) => Number.isInteger(c) && c >= 0 && c < q.options.length))].sort((a, b) => a - b);
    if (!q.multi) list = list.slice(0, 1);
    if (!state.answers.has(state.index)) state.answers.set(state.index, new Map());
    const map = state.answers.get(state.index);
    if (list.length === 0) map.delete(clientId);
    else map.set(clientId, list);
    ack && ack({ ok: true, myAnswer: list.length ? list : null });
    pushAdmin();
  });

  socket.on('leave', () => {
    if (clientId) state.participants.delete(clientId);
    clientId = null;
    pushAdmin();
  });

  // --- Admin ---
  socket.on('admin:auth', (password, ack) => {
    if (!timingSafeEqual(password || '', ADMIN_PASSWORD)) return ack && ack({ ok: false });
    isAdmin = true;
    socket.join('admins');
    ack && ack({ ok: true });
    socket.emit('admin:state', adminState());
  });

  const adminOnly = (fn) => (...args) => {
    const ack = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    if (!isAdmin) return ack && ack({ ok: false, error: 'Nicht angemeldet' });
    try {
      fn(...args);
    } catch (err) {
      if (ack) ack({ ok: false, error: err.message });
    }
  };

  socket.on('admin:loadDeck', adminOnly((id, ack) => {
    state.deck = loadDeck(String(id));
    state.answers.clear();
    goTo(-1, 'lobby');
    ack && ack({ ok: true });
  }));
  socket.on('admin:next', adminOnly(() => next()));
  socket.on('admin:prev', adminOnly(() => prev()));
  socket.on('admin:jump', adminOnly((index) => {
    if (!state.deck || !Number.isInteger(index) || index < 0 || index >= state.deck.questions.length) return;
    goTo(index, 'question');
  }));
  socket.on('admin:restart', adminOnly(() => {
    state.answers.clear();
    goTo(-1, 'lobby');
  }));
  socket.on('admin:clearParticipants', adminOnly(() => {
    // alle abmelden – die Geräte landen wieder auf der Namenseingabe
    io.emit('kicked');
    state.participants.clear();
    state.answers.clear();
    broadcast();
  }));
  socket.on('admin:refresh', adminOnly(() => socket.emit('admin:state', adminState())));

  socket.on('disconnect', () => {
    if (clientId) {
      const p = state.participants.get(clientId);
      if (p) p.sockets.delete(socket.id);
    }
    if (clientId) pushAdmin();
  });
});

// Beim Start den ersten fehlerfreien Fragensatz laden
const first = loadAllDecks().find((d) => !d.error);
if (first) state.deck = first;

server.listen(PORT, () => {
  console.log(`Quiz läuft auf http://localhost:${PORT}  (Admin: /admin)`);
});
