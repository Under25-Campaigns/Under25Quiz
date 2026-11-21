import { escapeHtml as esc } from './html.js';
import { isLocalOnlyHost, roomJoinUrl } from './room-links.js';

async function makeQrPng(link) {
  // Load the bundled uqr 0.1.2 encoder only for the host's invitation.
  const { encode } = await import('./vendor/uqr/index.js');
  const { data } = encode(link, { ecc: 'M', border: 4 });
  const scale = Math.ceil(1024 / data.length);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = data.length * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not draw the QR code.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  data.forEach((row, y) => {
    row.forEach((dark, x) => { if (dark) ctx.fillRect(x * scale, y * scale, scale, scale); });
  });
  return canvas.toDataURL('image/png');
}

function phoneOrigin(input) {
  try {
    const url = new URL(input);
    if (['http:', 'https:'].includes(url.protocol) && !isLocalOnlyHost(url.hostname) &&
        !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) return url.origin;
  } catch { /* Show the local address form if the URL is invalid. */ }
  return '';
}

export function mountRoomInvite(panel, room, addresses, savedOrigin, onChooseOrigin) {
  const local = isLocalOnlyHost(location.hostname);
  const suggestions = addresses.map(ip => {
    const url = new URL(location.origin);
    url.hostname = ip;
    return url.origin;
  });
  let origin = local ? phoneOrigin(savedOrigin) || suggestions[0] || '' : location.origin;
  let png = '', link = '', revision = 0, total = room.totalPlayers;
  let dialog = null, enteredFullscreen = false;

  panel.innerHTML = `<h2 id="invite-title">Join by QR code</h2>
    <p class="subtle">Scan with your phone’s camera, then enter your nickname.</p>
    <div class="invite-picture" hidden><img class="qr-image" alt="Scan to join room ${esc(room.code)}"></div>
    <p class="invite-status" role="status"></p>
    <div class="invite-tools" hidden>
      <button type="button" class="btn btn-dark" data-project>Project QR code</button>
      <a class="btn btn-light" data-download-qr download="quiz-night-${esc(room.code)}.png">Download QR</a>
    </div>
    <a class="invite-link" hidden target="_blank" rel="noopener noreferrer"></a>
    ${local ? `<details class="invite-address" ${origin ? '' : 'open'}>
      <summary>Wi-Fi join address</summary>
      <form><label for="invite-origin">Game address on your Wi-Fi</label>
        <p>Connect players to the same Wi-Fi as your Mac.</p>
        <div><input id="invite-origin" class="field" type="url" list="invite-addresses" required
          placeholder="http://192.168.1.10:3000" value="${esc(origin)}">
          <button class="btn btn-light" type="submit">Update QR</button></div>
        <datalist id="invite-addresses">${suggestions.map(url => `<option value="${esc(url)}"></option>`).join('')}</datalist>
        <p class="form-error" role="alert"></p>
      </form></details>` : ''}`;

  const picture = panel.querySelector('.invite-picture');
  const status = panel.querySelector('.invite-status');
  const tools = panel.querySelector('.invite-tools');
  const download = panel.querySelector('[data-download-qr]');
  const addressLink = panel.querySelector('.invite-link');
  const project = panel.querySelector('[data-project]');

  async function draw() {
    const request = ++revision;
    png = '';
    picture.hidden = tools.hidden = addressLink.hidden = true;
    picture.querySelector('img').removeAttribute('src');
    download.removeAttribute('href');
    if (!origin) { status.textContent = 'Enter your Mac’s Wi-Fi address below to make the QR code.'; return; }
    link = roomJoinUrl(origin, room.code);
    addressLink.href = link;
    addressLink.textContent = link;
    addressLink.hidden = false;
    status.textContent = 'Preparing QR code…';
    try {
      const image = await makeQrPng(link);
      if (request !== revision) return;
      png = image;
      picture.querySelector('img').src = image;
      download.href = image;
      picture.hidden = tools.hidden = false;
      status.textContent = '';
    } catch {
      if (request === revision) status.textContent = 'The QR image could not be drawn. Share the join link below.';
    }
  }

  function setCount(n) {
    total = n;
    const counter = dialog?.querySelector('.projector-count');
    if (counter) counter.textContent = n.toLocaleString() + (n === 1 ? ' player joined' : ' players joined');
  }

  function closeProjector() {
    if (!dialog) return;
    const previous = dialog;
    dialog = null;
    enteredFullscreen = false;
    document.removeEventListener('fullscreenchange', fullscreenChanged);
    if (document.fullscreenElement && previous.contains(document.fullscreenElement)) {
      document.exitFullscreen().catch(() => {});
    }
    if (previous.open && typeof previous.close === 'function') previous.close();
    previous.remove();
    if (project.isConnected) project.focus();
  }

  function fullscreenChanged() {
    if (!dialog) return;
    if (document.fullscreenElement && dialog.contains(document.fullscreenElement)) enteredFullscreen = true;
    else if (enteredFullscreen) closeProjector();
  }

  project.addEventListener('click', () => {
    if (dialog || !png) return;
    dialog = document.createElement('dialog');
    dialog.className = 'projector-dialog';
    dialog.setAttribute('aria-labelledby', 'projector-title');
    dialog.innerHTML = `<section class="projector-stage">
      <button type="button" class="projector-exit">← Back to lobby</button>
      <div class="projector-grid">
        <img class="qr-image projector-qr" alt="Scan to join room ${esc(room.code)}">
        <div class="projector-instructions"><p class="projector-game">${esc(room.title)}</p>
          <h1 id="projector-title">Scan to join</h1>
          <p>Open your camera, scan the code, and enter your nickname.</p>
          <div class="projector-manual"><span>Room code</span><strong>${esc(room.code)}</strong>
            <small>${esc(new URL(link).host)}</small></div>
          <p class="projector-count"></p>
        </div>
      </div></section>`;
    dialog.querySelector('img').src = png;
    dialog.querySelector('.projector-exit').addEventListener('click', closeProjector);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeProjector(); });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeProjector(); }
    });
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.setAttribute('aria-modal', 'true'); }
    dialog.querySelector('.projector-exit').focus();
    setCount(total);
    const stage = dialog.querySelector('.projector-stage');
    if (document.fullscreenEnabled && !document.fullscreenElement && stage.requestFullscreen) {
      document.addEventListener('fullscreenchange', fullscreenChanged);
      stage.requestFullscreen().catch(() => {}); // The dialog also fills the viewport without native fullscreen.
    }
  });

  const localForm = panel.querySelector('form');
  localForm?.addEventListener('submit', event => {
    event.preventDefault();
    const input = localForm.querySelector('input');
    const next = phoneOrigin(input.value.trim());
    const error = localForm.querySelector('[role="alert"]');
    if (!next) {
      error.textContent = 'Enter the full Wi-Fi or public website address, including http or https.';
      input.focus();
      return;
    }
    origin = next;
    input.value = next;
    onChooseOrigin(next);
    error.textContent = '';
    localForm.closest('details').open = false;
    void draw();
  });
  void draw();
  return { setCount, destroy() { revision++; closeProjector(); } };
}
