import { escapeHtml as esc } from './html.js';
import { openBuilder } from './builder.js';
import { openQuizShelf } from './quiz-shelf.js';
import { downloadQuiz } from './quiz-files.js';
import { standingsMarkup, winnerMarkup, celebrateWinner } from './standings.js';
import { quizRules } from './quiz-rules.js';
import { mountRoomInvite } from './room-invite.js';

const socket = window.io({ autoConnect: false });
const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const sessionKey = 'quizNightSession';
let role = null, session = readSession();
let invitation = new URL(location.href).searchParams.get('room');
let joinCode = /^\d{6}$/.test(invitation || '') ? invitation : '';
let screen = session ? 'resuming' : 'home';
if (invitation !== null && session?.code !== joinCode) screen = joinCode ? 'join-invite' : 'join-code';
let room = null, myName = '', playerId = null, choice = null, pendingChoice = null;
let hostInvite = null, lanAddresses = [], checkRequest = 0;
let restoring = false, personal = null, clockEnd = 0, clockInterval = null, toastTimer = null;
let page = { offset: 0, rows: null }, lastScene = '', celebrated = '', pageRequest = 0;

function readSession() {
  try {
    const saved = sessionStorage.getItem(sessionKey);
    if (saved) return JSON.parse(saved);
    // Import an open room from the previous version. New sessions belong to their tab.
    for (const [key, oldRole] of [['quizNightHost', 'host'], ['quizNightPlayer', 'player']]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const previous = { ...JSON.parse(raw), role: oldRole };
      sessionStorage.setItem(sessionKey, JSON.stringify(previous));
      localStorage.removeItem(key);
      return previous;
    }
  } catch { /* A room can still be played when browser storage is unavailable. */ }
  return null;
}

function storeSession(value) {
  session = value;
  try {
    if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
    else sessionStorage.removeItem(sessionKey);
  } catch { /* The current socket remains usable. */ }
}

function resume() {
  if (session && socket.connected) socket.emit(session.role === 'host' ? 'host:resume' : 'player:resume', session);
}

function clearInvitation() {
  if (invitation === null) return;
  invitation = null;
  const url = new URL(location.href);
  url.searchParams.delete('room');
  try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); }
  catch { /* A saved session can still resume when the browser restricts history changes. */ }
}

function checkRoom(code) {
  if (!socket.connected) return;
  const request = ++checkRequest;
  const submit = app.querySelector('[data-form="code"] .wide');
  if (submit) submit.disabled = true;
  socket.timeout(8000).emit('room:check', { code }, (err, reply) => {
    if (request !== checkRequest || !['join-code', 'join-invite'].includes(screen)) return;
    if (err && !socket.connected && screen === 'join-invite') return; // Recheck on reconnect.
    if (err || !reply?.ok) {
      show('join-code', reply?.message || 'Could not reach the room. Check your connection and try again.');
      return;
    }
    joinCode = reply.code;
    show('join-name');
  });
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3300);
}

function home() {
  const returnToSession = session && !room && !role && ['join-invite', 'join-code', 'join-name'].includes(screen);
  clearInvitation();
  checkRequest++;
  hostInvite?.destroy();
  hostInvite = null;
  lanAddresses = [];
  if (room && socket.connected) socket.emit('room:leave');
  clearInterval(clockInterval);
  role = null; room = null; joinCode = ''; myName = ''; playerId = null;
  choice = null; pendingChoice = null; personal = null; restoring = false;
  page = { offset: 0, rows: null }; lastScene = ''; celebrated = ''; pageRequest++;
  if (returnToSession) { show('resuming'); resume(); return; }
  storeSession(null);
  show('home');
}

function show(view, entry = null) {
  screen = view;
  if (view === 'builder') {
    return openBuilder(app, entry ? () => show('saved') : home, createQuiz, entry);
  }
  if (view === 'saved') return openQuizShelf(app, saved => show('builder', saved));
  if (view === 'resuming') {
    app.innerHTML = '<section class="join-wrap"><div class="join-card"><h2>Opening your room…</h2></div></section>';
    return;
  }
  if (view === 'join-invite') {
    app.innerHTML = `<section class="join-wrap"><div class="join-card"><h2>Opening room ${esc(joinCode)}…</h2>
      <button class="back" data-action="join">Enter a different code</button></div></section>`;
    return;
  }
  if (view === 'home') {
    app.innerHTML = `<section class="hero"><div><div class="eyebrow">Quiz Night</div>
      <h1>Bring your<br>people. <em>Play.</em></h1>
      <p class="intro">Host a live quiz or join one with a room code.</p>
      <div class="buttons"><button class="btn btn-dark" data-action="create">Create a quiz ↗</button>
        <button class="btn btn-light" data-action="join">I have a code</button></div>
      <button class="text-btn saved-home-link" data-action="saved">My quizzes →</button></div>
      <div class="art" aria-hidden="true"><div class="blob"></div><div class="floating float-a">⚡ +850 points</div>
        <div class="quiz-card"><div class="card-top"><span>QUESTION 02 / 10</span><span class="pill">00:18</span></div>
          <div class="card-title">What makes a great game?</div>
          <div class="answer-row"><i>A</i>The people you play with</div><div class="answer-row"><i>B</i>A little luck</div>
          <div class="answer-row"><i>C</i>Asking good questions</div><div class="answer-row"><i>D</i>All of the above</div>
        </div></div></section>`;
    return;
  }
  if (view === 'join-code') {
    app.innerHTML = `<section class="join-wrap"><form class="join-card" data-form="code">
      <button type="button" class="back" data-action="home">← Back</button><h2>Join a game</h2>
      <label class="field-label" for="room-code">Room code</label>
      <input class="field code-input" id="room-code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}"
        autocomplete="one-time-code" placeholder="000000" value="${esc(joinCode)}" required>
      <p class="form-error" role="alert">${esc(entry || '')}</p>
      <button class="btn btn-dark wide">Continue →</button></form></section>`;
    app.querySelector('input').focus();
    return;
  }
  if (view === 'join-name') {
    app.innerHTML = `<section class="join-wrap"><form class="join-card" data-form="name">
      <button type="button" class="back" data-action="join">← Change room code</button>
      <div class="eyebrow">Room ${esc(joinCode)}</div><h2>Pick a nickname</h2>
      <label class="field-label" for="nickname">Your nickname</label>
      <input class="field" id="nickname" maxlength="18" autocomplete="nickname" required>
      <p class="form-error" role="alert"></p>
      <button class="btn btn-dark wide">Let’s play →</button></form></section>`;
    app.querySelector('input').focus();
  }
}

async function createQuiz(quiz, saveWarning) {
  const response = await fetch('/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(quiz)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.code || !result.token) {
    throw new Error(result.error || 'The room could not be created. Please try again.');
  }
  storeSession({ role: 'host', code: result.code, token: result.token, quizSaved: !saveWarning, saveWarning });
  show('resuming');
  resume();
}

function questionPicture(q) {
  if (!q.imageUrl) return '';
  return `<figure class="question-picture"><img src="${esc(q.imageUrl)}" alt="${esc(q.imageAlt || 'Picture for this question')}"
    fetchpriority="high"></figure>`;
}

function questionTitle(q) {
  return `<h2 class="question">${esc(q.prompt || 'Picture question')}</h2>`;
}

function roomHeader() {
  return `<div class="game-head"><div class="game-brand">✳ ${esc(room.title)}</div>
    <div class="room-code"><small>ROOM CODE</small><strong>${esc(room.code)}</strong></div></div>
    ${role === 'host' && ['lobby', 'finished'].includes(room.status) ? `<div class="host-quiz-copy">
      <span>${esc(session?.saveWarning || (session?.quizSaved ? 'Saved in My quizzes.' : ''))}</span>
      <button type="button" class="text-btn" data-action="download-room">Download quiz file</button>
    </div>` : ''}`;
}

async function downloadRoomQuiz(button) {
  if (role !== 'host' || !room || !session?.token) return;
  button.disabled = true;
  try {
    const response = await fetch('/api/rooms/' + room.code + '/quiz', {
      headers: { Authorization: 'Bearer ' + session.token }, cache: 'no-store'
    });
    if (!response.ok) throw new Error('Could not download the quiz. Reopen it from My quizzes or try again.');
    downloadQuiz(await response.json());
  } catch (err) { notify(err.message); }
  finally { button.disabled = false; }
}

function lobbyNames() {
  return room.players.map(p => `<span class="avatar-chip">${esc(p.name)}</span>`).join('');
}

function lobbyView() {
  const lobby = `<section class="game-panel center lobby-panel"><span class="status-badge">Room open</span>
    <h2>${role === 'host' ? 'Ready to play?' : `You’re in, ${esc(myName)}!`}</h2>
    <p class="subtle">${role === 'host' ? 'Start when your players are ready.' : 'Your host will start the quiz.'}</p>
    <div class="player-count">${room.totalPlayers.toLocaleString()}</div><div class="subtle">players joined</div>
    <div class="avatars">${lobbyNames()}</div>
    ${role === 'host' ? '<button class="btn btn-dark" data-action="start">Start the quiz →</button>' : ''}
  </section>`;
  return role === 'host' ? `<div class="host-lobby">${lobby}
    <section class="game-panel invite-card" id="room-invite" aria-labelledby="invite-title"></section></div>` : lobby;
}

function secondsLeft() {
  return Math.max(0, Math.ceil((clockEnd - performance.now()) / 1000));
}

function answerButtons() {
  const selection = choice ?? pendingChoice;
  const locked = role !== 'player' || selection !== null || secondsLeft() === 0;
  return room.question.options.map((option, i) => `
    <button type="button" class="choice ${selection === i ? 'selected' : ''}" data-action="answer" data-choice="${i}"
      ${locked ? 'disabled' : ''}><span class="answer-letter">${String.fromCharCode(65 + i)}</span>${esc(option)}</button>`).join('');
}

function questionView() {
  const q = room.question;
  const leaders = room.players.slice(0, 5).map(p => `
    <div class="leader"><span><span class="rank">${p.rank}.</span> <b>${esc(p.name)}</b></span>
      <strong>${p.score.toLocaleString()}</strong></div>`).join('');
  return `<div class="game-grid"><section class="game-panel">
    <div class="question-meta"><span class="question-kicker">Question ${room.questionIndex + 1} of ${room.questionCount}</span>
      <span class="points-chip">${q.multiplier}× points</span>
      <div id="timer" class="timer" role="timer" aria-label="Seconds remaining">${secondsLeft()}</div></div>
    ${questionTitle(q)}${questionPicture(q)}
    <div class="choices">${answerButtons()}</div><p class="answer-state subtle" role="status">
      ${choice !== null ? 'Answer locked in ✓' : pendingChoice !== null ? 'Sending answer…' : ''}</p>
    ${role === 'host' ? `<div class="host-actions"><span class="answer-count">${room.answerCount} / ${room.totalPlayers} answered</span>
      <button class="btn btn-light" data-action="reveal">Reveal answers</button></div>` : ''}
    </section><aside><div class="side-box"><h3>Top players</h3>${leaders || '<p class="subtle">No scores yet.</p>'}</div></aside></div>`;
}

function refreshChoices() {
  if (room?.status !== 'question') return;
  const buttons = app.querySelector('.choices');
  if (buttons) buttons.innerHTML = answerButtons();
  const feedback = app.querySelector('.answer-state');
  if (feedback) feedback.textContent = choice !== null ? 'Answer locked in ✓' : pendingChoice !== null ? 'Sending answer…' : '';
}

function resultPanel() {
  const q = room.question;
  const correct = room.reveal.correct;
  const answers = q.options.map((option, i) => `
    <li class="result-option ${i === correct ? 'correct' : ''}">
      <span>${i === correct ? '✓ ' : ''}${esc(option)}</span><span>${room.reveal.counts[i]}</span></li>`).join('');
  const earned = personal?.roundPoints ?? 0;
  const verdict = choice === null ? 'No answer this round' : choice === correct ? 'Correct answer' : 'Incorrect answer';
  return `<section class="game-panel result-panel">
    <h2>Answer breakdown</h2>
    ${role === 'player' ? `<p class="result ${choice === correct ? 'ok' : 'no'}">${verdict} · +${earned.toLocaleString()} pts</p>` : ''}
    ${questionTitle(q)}${questionPicture(q)}
    <p class="subtle">${q.seconds} seconds · ${q.multiplier}× points · ${room.answerCount} answered</p>
    <ul class="result-options">${answers}</ul>
  </section>`;
}

function boardContent(animate = false) {
  return standingsMarkup(room, page, playerId, role === 'player' ? personal : null, animate);
}

function renderRoom() {
  if (!room) return;
  screen = 'room';
  const scene = room.code + '/' + room.questionIndex + '/' + room.status;
  const fresh = lastScene !== scene;
  lastScene = scene;
  if (!fresh && room.status === 'lobby' && app.querySelector('.lobby-panel')) {
    app.querySelector('.player-count').textContent = room.totalPlayers.toLocaleString();
    app.querySelector('.avatars').innerHTML = lobbyNames();
    hostInvite?.setCount(room.totalPlayers);
    return;
  }
  hostInvite?.destroy();
  hostInvite = null;
  if (fresh) {
    page = { offset: 0, rows: null };
    pageRequest++;
  }
  let view;
  if (room.status === 'lobby') view = lobbyView();
  else if (room.status === 'question') view = questionView();
  else if (room.status === 'reveal') {
    const next = room.questionIndex + 1 === room.questionCount ? 'See the winners →' : 'Next question →';
    view = `<div class="round-layout"><div>
      <div id="board">${boardContent(fresh)}</div>
      <div class="round-actions">${role === 'host' ? `<button class="btn btn-dark" data-action="next">${next}</button>`
        : '<p class="subtle">Waiting for the host to continue…</p>'}</div>
      </div>${resultPanel()}</div>`;
  } else {
    view = `${winnerMarkup(room.players[0], playerId)}
      <div id="board">${boardContent(false)}</div>
      <div class="round-actions"><button class="btn btn-dark" data-action="home">Back to home</button></div>`;
  }
  app.innerHTML = `<section class="game-shell">${roomHeader()}${view}</section>`;
  if (role === 'host' && room.status === 'lobby') {
    hostInvite = mountRoomInvite(app.querySelector('#room-invite'), room, lanAddresses, session?.inviteOrigin,
      origin => storeSession({ ...session, inviteOrigin: origin }));
  }
  if (room.status === 'finished' && room.players.length && celebrated !== room.code) {
    celebrated = room.code;
    celebrateWinner(app.querySelector('.winner-card'));
  }
}

function applyRoom(data) {
  const changedRound = room?.questionIndex !== data.questionIndex || room?.code !== data.code;
  if (data.status === 'question' && changedRound && !restoring) {
    choice = null;
    pendingChoice = null;
  }
  restoring = false;
  room = data;
  clearInterval(clockInterval);
  if (room.status === 'question') {
    // Use the server's remaining time on receipt, independent of the device clock.
    clockEnd = performance.now() + Math.max(0, data.deadline - (data.serverNow ?? Date.now()));
    clockInterval = setInterval(() => {
      const timer = app.querySelector('#timer');
      if (!timer) return;
      const seconds = secondsLeft();
      if (timer.textContent !== String(seconds)) timer.textContent = String(seconds);
      if (seconds === 0) { clearInterval(clockInterval); refreshChoices(); }
    }, 150);
  }
  renderRoom();
}

function submitAnswer(index) {
  if (!socket.connected) return notify('Reconnecting. Try again when you’re back online.');
  if (role !== 'player' || room?.status !== 'question' || choice !== null || pendingChoice !== null || !secondsLeft()) return;
  const questionIndex = room.questionIndex;
  const code = room.code;
  pendingChoice = index;
  refreshChoices();
  socket.timeout(6000).emit('player:answer', { choice: index, questionIndex }, (err, reply) => {
    if (room?.code !== code || room.questionIndex !== questionIndex || room.status !== 'question') return;
    pendingChoice = null;
    if (!err && reply?.ok) choice = reply.choice;
    else notify(reply?.message || 'Could not confirm your answer. Please try again.');
    refreshChoices();
  });
}

function changePage(step) {
  if (!room || !socket.connected) return;
  const offset = page.offset + step * quizRules.pageSize;
  if (offset < 0 || offset >= room.totalPlayers) return;
  const request = ++pageRequest;
  socket.timeout(4500).emit('room:standings-page', { questionIndex: room.questionIndex, offset }, (err, data) => {
    if (request !== pageRequest) return;
    if (err || !data?.ok) return notify('The leaderboard page could not be loaded.');
    page = { offset: data.offset, rows: data.rows };
    const board = app.querySelector('#board');
    if (board) board.innerHTML = boardContent(false);
  });
}

app.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  switch (button.dataset.action) {
    case 'home': return home();
    case 'saved': return show('saved');
    case 'download-room': return downloadRoomQuiz(button);
    case 'create': return show('builder');
    case 'join':
      checkRequest++;
      clearInvitation();
      return show('join-code');
    case 'answer': return submitAnswer(Number(button.dataset.choice));
    case 'prev-page': return changePage(-1);
    case 'next-page': return changePage(1);
    case 'start':
    case 'reveal':
    case 'next': {
      if (role !== 'host' || !room || !socket.connected) return;
      const eventName = { start: 'host:start', reveal: 'host:force-reveal', next: 'host:next' }[button.dataset.action];
      button.disabled = true;
      socket.emit(eventName, { code: room.code });
    }
  }
});

app.addEventListener('submit', event => {
  const kind = event.target.dataset.form;
  if (!kind) return;
  event.preventDefault();
  if (!socket.connected) return notify('Waiting for a connection. Try again in a moment.');
  if (kind === 'code') {
    joinCode = app.querySelector('#room-code').value.trim();
    return checkRoom(joinCode);
  }
  if (kind === 'name') {
    const name = app.querySelector('#nickname').value.trim();
    if (!name) return notify('Choose a nickname to join.');
    event.target.querySelector('button[type="submit"], .wide').disabled = true;
    socket.emit('player:join', { code: joinCode, name });
  }
});

socket.on('connect', () => {
  if (screen === 'join-invite') checkRoom(joinCode);
  else if (screen === 'resuming' || screen === 'room') resume();
});
socket.on('connect_error', () => notify('The game server is unavailable. Reconnecting…'));
socket.on('disconnect', () => { pendingChoice = null; notify('Connection lost. Reconnecting…'); });
socket.on('host:created', data => {
  role = 'host';
  lanAddresses = data.lanAddresses || [];
  clearInvitation();
  storeSession({ role, code: data.code, token: data.token });
});
socket.on('host:resumed', data => {
  role = 'host'; restoring = true; lanAddresses = data.lanAddresses || [];
  clearInvitation();
});
socket.on('player:joined', data => {
  clearInvitation();
  role = 'player'; playerId = data.playerId; myName = data.name;
  choice = data.answerChoice ?? null; pendingChoice = null; personal = data.standing ?? null; restoring = true;
  storeSession({ role, code: data.code, playerId, token: data.token });
});
socket.on('player:standing', data => {
  if (session?.code !== data.code) return;
  personal = data.row;
  choice = data.choice ?? null;
  pendingChoice = null;
});
socket.on('room:update', data => { if (session?.code === data.code) applyRoom(data); });
socket.on('room:answer-count', count => {
  if (room?.status !== 'question') return;
  room.answerCount = count;
  const label = app.querySelector('.answer-count');
  if (label) label.textContent = `${count} / ${room.totalPlayers} answered`;
});
for (const event of ['player:resume-denied', 'host:resume-denied']) {
  socket.on(event, () => {
    if (invitation && /^\d{6}$/.test(invitation)) {
      storeSession(null);
      joinCode = invitation;
      show('join-invite');
      checkRoom(joinCode);
    } else { home(); notify('That room session has expired.'); }
  });
}
socket.on('app:error', message => {
  app.querySelectorAll('button[data-action="start"], button[data-action="next"], button[data-action="reveal"], form[data-form="name"] .wide')
    .forEach(button => { button.disabled = false; });
  if (screen === 'join-name') {
    app.querySelector('[role="alert"]').textContent = message;
    return;
  }
  notify(message);
});
socket.on('room:closed', () => { home(); notify('This room has closed.'); });

show(screen, invitation !== null && !joinCode ? 'This invite needs a six-digit room code.' : null);
socket.connect();
