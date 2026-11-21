(() => {
  const LETTERS = 'ABCDEFGHIJ';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
    del(k) { try { sessionStorage.removeItem(k); } catch {} },
  };

  let password = ss.get('quiz.adminPw');
  let state = null;
  let joinUrl = location.origin;
  let peek = false;
  let showScore = false;
  let renderedKey = '';

  fetch('/api/join-url').then((r) => r.json()).then((d) => { joinUrl = d.url; render(true); }).catch(() => {});

  const socket = io({ transports: ['websocket', 'polling'] });

  function auth() {
    socket.emit('admin:auth', password, (res) => {
      if (res && res.ok) {
        ss.set('quiz.adminPw', password);
        $('viewLogin').classList.add('hidden');
        $('viewAdmin').classList.remove('hidden');
      } else {
        ss.del('quiz.adminPw');
        password = null;
        $('viewAdmin').classList.add('hidden');
        $('viewLogin').classList.remove('hidden');
        $('loginError').classList.remove('hidden');
      }
    });
  }

  socket.on('connect', () => { $('conn').classList.remove('off'); if (password) auth(); });
  socket.on('disconnect', () => $('conn').classList.add('off'));
  $('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    password = $('pw').value;
    auth();
  });

  socket.on('admin:state', (s) => {
    state = s;
    render();
  });

  // --- Steuerung ---
  const next = () => socket.emit('admin:next');
  const prev = () => socket.emit('admin:prev');
  $('btnNext').addEventListener('click', next);
  $('btnPrev').addEventListener('click', prev);
  $('btnMenu').addEventListener('click', () => $('menu').classList.toggle('hidden'));
  $('btnPeek').addEventListener('click', togglePeek);
  $('btnFull').addEventListener('click', toggleFull);
  $('btnRestart').addEventListener('click', () => {
    if (confirm('Wirklich von vorne beginnen? Alle Antworten dieser Sitzung werden gelöscht.')) socket.emit('admin:restart');
  });
  $('btnClear').addEventListener('click', () => {
    if (confirm('Alle Teilnehmenden abmelden? Sie müssen ihren Namen neu eingeben.')) socket.emit('admin:clearParticipants');
  });
  $('deckSelect').addEventListener('change', (e) => {
    const id = e.target.value;
    if (state && id === state.deckId) return;
    if (state && state.phase !== 'lobby' && !confirm('Fragensatz wechseln? Die laufende Abfrage wird zurückgesetzt.')) {
      e.target.value = state.deckId || '';
      return;
    }
    socket.emit('admin:loadDeck', id, (res) => { if (res && !res.ok) alert(res.error); });
  });
  $('jumpSelect').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v !== '') socket.emit('admin:jump', Number(v));
  });

  function togglePeek() { peek = !peek; $('btnPeek').classList.toggle('outline', peek); render(true); }
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  document.addEventListener('keydown', (e) => {
    if (!state || $('viewAdmin').classList.contains('hidden')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    // Präsentations-Clicker senden meist PageDown/PageUp oder Pfeiltasten
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prev(); }
    else if (e.key === 'f' || e.key === 'F') toggleFull();
    else if (e.key === 'l' || e.key === 'L') togglePeek();
  });

  // --- Anzeige ---
  function render(force) {
    if (!state) return;
    $('deckTitle').textContent = state.deckTitle || 'Kein Fragensatz';
    $('pCount').textContent = state.participants.length;

    // Fragensatz-Auswahl
    const ds = $('deckSelect');
    const deckKey = JSON.stringify(state.decks) + state.deckId;
    if (ds.dataset.key !== deckKey) {
      ds.dataset.key = deckKey;
      ds.textContent = '';
      if (!state.deckId) ds.appendChild(new Option('– Fragensatz wählen –', ''));
      for (const d of state.decks) {
        const o = new Option(d.error ? `⚠ ${d.id} (fehlerhaft)` : `${d.title} (${d.count})`, d.id);
        o.disabled = !!d.error;
        if (d.error) o.title = d.error;
        ds.appendChild(o);
      }
      ds.value = state.deckId || '';
    }

    // Sprung-Auswahl
    const js = $('jumpSelect');
    const jumpKey = JSON.stringify(state.slides) + state.index + state.phase;
    if (js.dataset.key !== jumpKey) {
      js.dataset.key = jumpKey;
      js.textContent = '';
      js.appendChild(new Option('Springe zu …', ''));
      state.slides.forEach((s) => js.appendChild(new Option(`Frage ${s.index + 1} · Folie ${s.slide}`, s.index)));
      js.value = '';
    }

    const answering = state.phase === 'question' || state.phase === 'reveal';
    $('aCountPill').classList.toggle('hidden', !answering);
    if (answering) $('aCount').textContent = state.answerCount || 0;

    $('btnPrev').disabled = state.phase === 'lobby';
    $('btnNext').disabled = !state.deckId || state.phase === 'end' || (state.total === 0);
    $('btnNext').textContent =
      state.phase === 'lobby' ? 'Start ▶' :
      state.phase === 'question' ? 'Auflösen ▶' :
      state.phase === 'reveal' ? (state.index + 1 < state.total ? 'Nächste Frage ▶' : 'Abschluss ▶') : 'Weiter';
    $('btnPeek').classList.toggle('hidden', state.phase !== 'question');

    const key = `${state.phase}|${state.index}|${state.deckId}|${peek}|${showScore}`;
    if (key === renderedKey && !force) return updateLive();
    renderedKey = key;

    const stage = $('stage');
    stage.textContent = '';
    if (state.phase === 'lobby') stage.appendChild(renderLobby());
    else if (state.phase === 'end') stage.appendChild(renderEnd());
    else if (state.question) stage.appendChild(renderQuestion());
    updateLive();
  }

  function qrImg() {
    const img = el('img');
    img.src = '/qr.svg?t=' + Date.now();
    img.alt = 'QR-Code zur Teilnahme';
    return img;
  }

  function renderLobby() {
    const wrap = el('div', 'lobby');
    const box = el('div', 'qr-box');
    box.appendChild(el('div', 'eyebrow', 'Jetzt teilnehmen'));
    box.appendChild(qrImg());
    box.appendChild(el('div', 'muted', 'QR-Code scannen oder aufrufen:'));
    box.appendChild(el('div', 'qr-url', joinUrl.replace(/^https?:\/\//, '')));
    const right = el('div');
    right.appendChild(el('div', 'eyebrow', state.deckTitle || 'Live-Quiz'));
    right.appendChild(el('h1', null, 'Willkommen! Bitte melden Sie sich an.'));
    if (!state.deckId) right.appendChild(el('p', 'error', 'Bitte oben einen Fragensatz wählen.'));
    else right.appendChild(el('p', 'muted', `${state.total} Fragen · Klicken Sie auf „Start“, wenn alle angemeldet sind.`));
    const count = el('div', 'big-count');
    count.id = 'lobbyCount';
    right.appendChild(count);
    right.appendChild(el('div', 'muted', 'Teilnehmende angemeldet'));
    const names = el('div', 'names');
    names.id = 'lobbyNames';
    right.appendChild(names);
    wrap.append(box, right);
    return wrap;
  }

  function renderQuestion() {
    const q = state.question;
    const reveal = state.phase === 'reveal';
    const frag = document.createDocumentFragment();
    frag.appendChild(el('div', 'eyebrow', `Frage ${state.index + 1} von ${state.total} · Folie ${q.slide}${q.multi ? ' · Mehrfachauswahl' : ''}`));
    frag.appendChild(el('h1', null, q.text));
    const ul = el('ul', 'proj-options');
    ul.id = 'projOptions';
    q.options.forEach((text, i) => {
      const li = el('li', 'proj-option');
      const isCorrect = q.correct.includes(i);
      if (reveal) li.classList.add(isCorrect ? 'correct' : 'dim');
      else if (peek && isCorrect) li.classList.add('secret');
      li.append(el('div', 'bar'), el('span', 'letter', LETTERS[i]), el('span', 'txt', text), el('span', 'num', ''));
      ul.appendChild(li);
    });
    frag.appendChild(ul);
    const prog = el('div', 'answer-progress');
    prog.innerHTML = '<span id="progText"></span><div class="track"><div class="fill" id="progFill"></div></div>';
    frag.appendChild(prog);
    if (reveal && q.explanation) frag.appendChild(el('div', 'proj-expl', q.explanation));
    if (!reveal) {
      const mini = el('div', 'mini-qr');
      mini.append(qrImg(), el('div', null, 'Noch nicht dabei?'));
      frag.appendChild(mini);
    }
    return frag;
  }

  function renderEnd() {
    const wrap = el('div');
    wrap.appendChild(el('div', 'eyebrow', state.deckTitle || ''));
    wrap.appendChild(el('h1', null, 'Geschafft – vielen Dank fürs Mitmachen!'));
    const n = state.participants.length;
    wrap.appendChild(el('p', 'muted', `${n} Teilnehmende · ${state.total} Fragen`));
    const btn = el('button', 'btn outline', showScore ? 'Ergebnisliste ausblenden' : 'Ergebnisliste anzeigen');
    btn.addEventListener('click', () => { showScore = !showScore; render(true); });
    wrap.appendChild(btn);
    if (showScore && state.summary) {
      const t = el('table', 'score');
      t.innerHTML = '<thead><tr><th>Name</th><th>Richtig</th><th>Beantwortet</th></tr></thead>';
      const tb = el('tbody');
      for (const r of state.summary) {
        const tr = el('tr');
        tr.append(el('td', null, r.name), el('td', null, `${r.right} / ${state.total}`), el('td', null, String(r.answered)));
        tb.appendChild(tr);
      }
      t.appendChild(tb);
      wrap.appendChild(t);
      wrap.appendChild(el('p', 'muted', 'Diese Liste existiert nur im Arbeitsspeicher und verschwindet beim Neustart.'));
    }
    return wrap;
  }

  // Werte, die sich ständig ändern, ohne alles neu zu zeichnen
  function updateLive() {
    const n = state.participants.length;
    const lc = $('lobbyCount');
    if (lc) lc.textContent = n;
    const ln = $('lobbyNames');
    if (ln) {
      const names = state.participants.map((p) => p.name);
      if (ln.dataset.key !== names.join('\u0000')) {
        ln.dataset.key = names.join('\u0000');
        ln.textContent = '';
        names.forEach((nm) => ln.appendChild(el('span', null, nm)));
      }
    }
    const pt = $('progText');
    if (pt && state.question) {
      const a = state.answerCount || 0;
      pt.textContent = `${a} von ${n} haben geantwortet`;
      $('progFill').style.width = n ? `${Math.min(100, (a / n) * 100)}%` : '0%';
      if (state.phase === 'reveal') {
        const items = $('projOptions').children;
        const total = Math.max(1, a);
        state.counts.forEach((c, i) => {
          const pct = Math.round((c / total) * 100);
          items[i].querySelector('.bar').style.width = `${pct}%`;
          items[i].querySelector('.num').textContent = `${c} · ${pct} %`;
        });
      }
    }
  }
})();
