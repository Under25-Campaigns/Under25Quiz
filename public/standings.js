import { escapeHtml } from './html.js';
import { quizRules } from './quiz-rules.js';

function standingRow(row, playerId, index) {
  const change = row.movement;
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'level';
  let trend = '<span class="trend steady" aria-label="Position unchanged">—</span>';
  if (change) {
    const steps = Math.abs(change);
    trend = `<span class="trend ${direction}" aria-label="Moved ${direction} ${steps} places">
      <span class="flight-icon" aria-hidden="true">${change > 0 ? '🚀' : '🪂'}</span>
      <span>${direction} ${steps}</span></span>`;
  }
  const isMe = row.id === playerId;
  const travel = Math.max(-4, Math.min(4, change)) * 63;
  return `<li class="rank-row ${isMe ? 'is-you' : ''}" data-rank="${row.rank}" data-movement="${direction}"
    style="--rank-travel:${travel}px;--row-delay:${Math.min(index, 6) * 35}ms">
    <span class="rank-number" aria-label="Rank ${row.rank}">${row.rank}</span>
    <span class="rank-name">${escapeHtml(row.name)} ${isMe ? '<small>You</small>' : ''}</span>
    ${trend}
    <span class="rank-score">${row.score.toLocaleString()} <small>pts</small></span>
  </li>`;
}

export function standingsMarkup(room, page, playerId, ownRow, animate) {
  const rows = page.rows ?? room.players;
  const offset = page.offset;
  const total = room.totalPlayers;
  const final = room.status === 'finished';
  const ownIsOutside = ownRow && !rows.some(row => row.id === playerId);
  const title = final ? 'Final leaderboard' : 'Round leaderboard';
  return `<section class="game-panel standings-panel ${animate ? 'animate-ranks' : ''}" aria-label="${title}">
    <div class="standings-heading">
      <div><div class="question-kicker">${final ? 'Game complete' : `Question ${room.questionIndex + 1} of ${room.questionCount}`}</div>
        <h2>${title}</h2></div>
      <span class="field-help">${total.toLocaleString()} player${total === 1 ? '' : 's'}</span>
    </div>
    ${total ? `<ol class="rank-list" start="${offset + 1}">
      ${rows.map((row, i) => standingRow(row, playerId, i)).join('')}</ol>` : '<p class="subtle">No players joined this game.</p>'}
    ${ownIsOutside ? `<div class="personal-standing"><h3>Your position</h3>
      <ol class="rank-list" start="${ownRow.rank}">${standingRow(ownRow, playerId, 0)}</ol></div>` : ''}
    ${total > quizRules.pageSize ? `<nav class="board-pager" aria-label="Leaderboard pages">
      <button type="button" class="btn btn-light" data-action="prev-page" ${offset === 0 ? 'disabled' : ''}>← Previous</button>
      <span>${offset + 1}–${Math.min(total, offset + quizRules.pageSize)} of ${total.toLocaleString()}</span>
      <button type="button" class="btn btn-light" data-action="next-page" ${offset + quizRules.pageSize >= total ? 'disabled' : ''}>Next →</button>
    </nav>` : ''}
  </section>`;
}

export function winnerMarkup(winner, playerId) {
  if (!winner) return '';
  return `<section class="winner-card" aria-label="Quiz winner" data-winner-id="${escapeHtml(winner.id)}">
    <div class="winner-content"><span class="winner-trophy" aria-hidden="true">🏆</span>
      <p class="winner-label">${winner.id === playerId ? 'You won!' : 'First place'}</p>
      <h1 class="winner-name">${escapeHtml(winner.name)}</h1>
      <p class="winner-points">${winner.score.toLocaleString()} points</p></div>
  </section>`;
}

// Two bursts from each side of the winner's card. All particles live in one short-lived canvas.
export function celebrateWinner(card) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!card || motion.matches) return;
  const width = card.clientWidth;
  const height = card.clientHeight;
  if (!width || !height) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'winner-confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.scale(ratio, ratio);
  card.append(canvas);

  const colors = ['#ffe36b', '#d8f56a', '#ff896d', '#b9a6ff', '#55dec1', '#ffffff'];
  const pieces = [];
  for (const delay of [0, 0.46]) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 25; i++) {
        pieces.push({
          delay: delay + Math.random() * 0.11,
          x: width * (side === -1 ? 0.06 : 0.94), y: height * (0.77 + Math.random() * 0.12),
          vx: -side * width * (0.12 + Math.random() * 0.44), vy: -height * (0.95 + Math.random() * 1.18),
          angle: Math.random() * Math.PI, spin: Math.random() * 9 - 4.5,
          size: 3 + Math.random() * 5, color: colors[i % colors.length]
        });
      }
    }
  }
  let started;
  function frame(now) {
    started ??= now;
    const elapsed = (now - started) / 1000;
    if (!card.isConnected || motion.matches || elapsed > 2.8) { canvas.remove(); return; }
    context.clearRect(0, 0, width, height);
    for (const p of pieces) {
      const age = elapsed - p.delay;
      if (age < 0) continue;
      const y = p.y + p.vy * age + height * 0.99 * age * age;
      if (y > height + 10) continue;
      context.save();
      context.translate(p.x + p.vx * age, y);
      context.rotate(p.angle + p.spin * age);
      context.globalAlpha = Math.max(0, Math.min(1, (2.65 - elapsed) * 2));
      context.fillStyle = p.color;
      context.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * (0.45 + 0.4 * Math.abs(Math.cos(age * 6))));
      context.restore();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
