(() => {
  const LETTERS = 'ABCDEFGHIJ';
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  let clientId = store.get('quiz.clientId');
  if (!clientId) {
    clientId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/[^A-Za-z0-9_-]/g, '');
    store.set('quiz.clientId', clientId);
  }
  let name = store.get('quiz.name') || '';
  let joined = false;
  let state = null;
  let myAnswer = null; // Array der gewählten Indizes
  let pending = null; // Auswahl bei Mehrfachantwort, noch nicht abgeschickt

  const socket = io({ transports: ['websocket', 'polling'] });

  function show(view) {
    for (const v of ['viewJoin', 'viewWait', 'viewQuestion', 'viewEnd']) $(v).classList.toggle('hidden', v !== view);
  }

  function join() {
    socket.emit('join', { clientId, name }, (res) => {
      if (!res || !res.ok) {
        joined = false;
        $('joinError').textContent = (res && res.error) || 'Anmeldung fehlgeschlagen.';
        $('joinError').classList.remove('hidden');
        show('viewJoin');
        return;
      }
      joined = true;
      $('whoami').textContent = name;
      $('whoami').classList.remove('hidden');
    });
  }

  socket.on('connect', () => {
    $('conn').classList.remove('off');
    if (name) join();
    else show('viewJoin');
  });
  socket.on('disconnect', () => $('conn').classList.add('off'));

  socket.on('kicked', () => {
    joined = false;
    $('whoami').classList.add('hidden');
    show('viewJoin');
  });

  $('nameInput').value = name;
  $('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    name = $('nameInput').value.replace(/\s+/g, ' ').trim();
    if (!name) return;
    store.set('quiz.name', name);
    $('joinError').classList.add('hidden');
    join();
  });

  socket.on('state', (s) => {
    const sameQuestion = state && state.index === s.index && s.phase === 'question' && state.phase === 'question';
    state = s;
    myAnswer = s.myAnswer;
    if (!sameQuestion) pending = myAnswer ? [...myAnswer] : [];
    if (s.deckTitle) { $('deckTitle').textContent = s.deckTitle; document.title = `${s.deckTitle} · Live-Quiz`; }
    render();
  });

  function render() {
    if (!joined || !state) return;
    if (state.phase === 'lobby' || !state.question) {
      if (state.phase === 'end') {
        $('endText').textContent = 'Die Abfrage ist beendet.';
        return show('viewEnd');
      }
      $('waitTitle').textContent = `Hallo ${name}, Sie sind angemeldet`;
      $('waitText').textContent = 'Gleich geht es los – die erste Frage erscheint hier automatisch.';
      return show('viewWait');
    }
    if (state.phase === 'end') {
      $('endText').textContent = 'Die Abfrage ist beendet.';
      return show('viewEnd');
    }
    renderQuestion();
    show('viewQuestion');
  }

  function renderQuestion() {
    const q = state.question;
    const reveal = state.phase === 'reveal';
    $('qMeta').textContent = `Frage ${state.index + 1} von ${state.total}`;
    $('qText').textContent = q.text;
    $('qHint').textContent = reveal ? '' : q.multi ? 'Mehrere Antworten können richtig sein.' : 'Tippen Sie auf die Antwort, die Sie für richtig halten.';

    const chosen = q.multi && !reveal ? pending : myAnswer || [];
    const ul = $('qOptions');
    ul.textContent = '';
    q.options.forEach((text, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'option';
      const letter = document.createElement('span');
      letter.className = 'letter';
      letter.textContent = LETTERS[i];
      const label = document.createElement('span');
      label.textContent = text;
      b.append(letter, label);
      const isChosen = chosen.includes(i);
      if (reveal) {
        b.disabled = true;
        const isCorrect = q.correct.includes(i);
        if (isCorrect) b.classList.add('correct');
        else if (isChosen) b.classList.add('wrong');
        else b.classList.add('dim');
      } else {
        if (isChosen) b.classList.add('selected');
        b.addEventListener('click', () => choose(i));
      }
      li.appendChild(b);
      ul.appendChild(li);
    });

    const status = $('qStatus');
    status.textContent = '';
    if (reveal) {
      const fb = document.createElement('div');
      const mine = myAnswer || [];
      const right = mine.length === q.correct.length && mine.every((x, k) => x === q.correct[k]);
      fb.className = 'feedback ' + (!myAnswer ? 'none' : right ? 'ok' : 'no');
      fb.textContent = !myAnswer ? 'Sie haben diesmal nicht geantwortet.' : right ? '✓ Richtig!' : '✗ Leider nicht richtig.';
      status.appendChild(fb);
      if (q.explanation) {
        const ex = document.createElement('div');
        ex.className = 'explanation';
        ex.textContent = q.explanation;
        status.appendChild(ex);
      }
    } else if (q.multi) {
      const btn = document.createElement('button');
      btn.className = 'btn block';
      btn.style.marginTop = '1.25rem';
      const same = myAnswer && pending.length === myAnswer.length && pending.every((x, k) => x === myAnswer[k]);
      btn.textContent = same ? '✓ Antwort abgegeben' : 'Antwort abgeben';
      btn.disabled = pending.length === 0 || same;
      btn.addEventListener('click', () => send(pending));
      status.appendChild(btn);
      if (myAnswer && !same) status.appendChild(note('Ihre Änderung ist noch nicht abgegeben.'));
    } else if (myAnswer) {
      status.appendChild(note('✓ Antwort gespeichert – Sie können sie bis zur Auflösung noch ändern.'));
    }
  }

  function note(text) {
    const p = document.createElement('p');
    p.className = 'muted center';
    p.textContent = text;
    return p;
  }

  function choose(i) {
    const q = state.question;
    if (q.multi) {
      pending = pending.includes(i) ? pending.filter((x) => x !== i) : [...pending, i].sort((a, b) => a - b);
      renderQuestion();
    } else {
      send([i]);
    }
  }

  function send(list) {
    socket.emit('answer', list, (res) => {
      if (res && res.ok) {
        myAnswer = res.myAnswer;
        pending = myAnswer ? [...myAnswer] : [];
        renderQuestion();
      }
    });
  }
})();
