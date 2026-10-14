/* Ask Me - app.js : socket, screen routing, home + lobby */

const CATEGORY_META = {
  spicy: { label: 'Spicy', icon: '\u{1F336}\uFE0F', note: 'Flirty & teasing, safe for parties' },
  personal: { label: 'Personal', icon: '\u{1F9ED}', note: 'Deeper questions' },
  general: { label: 'General', icon: '\u{1F389}', note: 'Fun & light' },
  adult: { label: 'Adult 18+', icon: '\u{1F525}', note: 'Explicit - adults only' },
  custom: { label: 'Custom', icon: '\u270F\uFE0F', note: 'Questions you both added' },
};

const AVATARS = [
  '\u{1F60E}', '\u{1F608}', '\u{1F920}', '\u{1F973}', '\u{1F607}', '\u{1F916}',
  '\u{1F47B}', '\u{1F984}', '\u{1F431}', '\u{1F436}', '\u{1F98A}', '\u{1F43C}',
  '\u{1F981}', '\u{1F438}', '\u{1F435}', '\u{1F42F}', '\u{1F9DA}', '\u{1F575}\uFE0F',
];

const SERVER_URL = (window.ASKME_SERVER_URL || '').replace(/\/+$/, '') || undefined;
const SOCKET_OPTS = { transports: ['websocket', 'polling'] };

const App = {
  socket: null,
  state: null,
  me: { name: '', avatar: AVATARS[0] },
  log: [],
};

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function connectSocket(done) {
  if (location.protocol === 'https:' && SERVER_URL && !/^https:\/\//i.test(SERVER_URL)) {
    return done(null, 'Game server URL must use https:// when this page is served over https (browsers block mixed content).');
  }
  if (typeof window.io === 'function') return done(window.io(SERVER_URL, SOCKET_OPTS));
  if (!SERVER_URL) {
    return done(null, 'No game server configured. Set window.ASKME_SERVER_URL in config.js to your deployed server URL.');
  }
  const s = document.createElement('script');
  s.src = `${SERVER_URL}/socket.io/socket.io.js`;
  s.onload = () => done(window.io(SERVER_URL, SOCKET_OPTS));
  s.onerror = () => done(null, `Could not reach the game server at ${SERVER_URL}. Is it deployed and awake?`);
  document.head.appendChild(s);
}

connectSocket((socket, err) => {
  App.socket = socket;
  if (socket) {
    wireSocket();
  } else {
    const msg = err || 'Could not load the game client.';
    document.addEventListener('DOMContentLoaded', () => {
      showHomeError(msg);
      toast(msg);
    });
  }
});

function showScreen(name) {
  ['home', 'lobby', 'game', 'summary'].forEach((s) => {
    $('screen-' + s).classList.toggle('hidden', s !== name);
  });
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

function myPlayer() {
  if (!App.state) return null;
  return App.state.players.find((p) => p.name === App.me.name) || null;
}

function addLog(text, mine) {
  App.log.push({ text, mine });
  renderLog();
}

function renderLog() {
  renderLobbyLog();
  const el = $('log');
  if (!el) return;
  el.innerHTML = App.log.map((m) => `<div class="${m.mine ? 'me' : ''}">${esc(m.text)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

function renderLobbyLog() {
  const el = $('lobby-log');
  if (!el) return;
  const recent = App.log.slice(-4);
  el.innerHTML = recent.map((m) => `<div>${esc(m.text)}</div>`).join('');
}

/* ---------- home ---------- */

function buildAvatarGrid() {
  const grid = $('avatar-grid');
  grid.innerHTML = '';
  AVATARS.forEach((av) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = av;
    b.className = av === App.me.avatar ? 'selected' : '';
    b.onclick = () => {
      App.me.avatar = av;
      localStorage.setItem('askme.avatar', av);
      buildAvatarGrid();
    };
    grid.appendChild(b);
  });
}

function doJoin() {
  const name = $('name-input').value.trim();
  const code = $('join-code').value.trim().toUpperCase();
  if (!name) return showHomeError('Pick a nickname first.');
  if (code.length !== 4) return showHomeError('Room codes are 4 letters/digits.');
  showHomeError('');
  App.me.name = name;
  localStorage.setItem('askme.name', name);
  App.socket.emit('join', { code, name, avatar: App.me.avatar });
}

function doCreate() {
  const name = $('name-input').value.trim();
  if (!name) return showHomeError('Pick a nickname first.');
  showHomeError('');
  App.me.name = name;
  localStorage.setItem('askme.name', name);
  App.socket.emit('join', { code: 'CREATE', name, avatar: App.me.avatar });
}

function showHomeError(msg) {
  $('home-error').textContent = msg;
}

/* ---------- lobby ---------- */

function renderLobby() {
  const s = App.state;
  $('room-code-display').textContent = s.code;
  $('room-chip').classList.remove('hidden');

  const me = myPlayer();
  const players = s.players.map((p) => {
    const isMe = me && p.id === me.id;
    return `<div class="player">
      <div class="av">${esc(p.avatar)}</div>
      <div class="meta">
        <span class="pname">${esc(p.name)}${isMe ? ' <span class="badge">you</span>' : ''}</span>
        <span class="pscore">${p.ready ? 'Ready \u2713' : 'Picking categories\u2026'}</span>
      </div>
    </div>`;
  });
  players.push(s.players.length < 2 ? `<div class="player" style="border-style:dashed;opacity:.5">
      <div class="av">\u23F3</div><div class="meta"><span class="pname">Waiting\u2026</span>
      <span class="pscore">share the code ${esc(s.code)}</span></div>
    </div>` : '');

  $('lobby-players').innerHTML = players.join('');

  const list = $('category-list');
  if (list.dataset.built === '1') {
    document.querySelectorAll('#category-list .cat').forEach((el) => {
      const on = me.categories.includes(el.dataset.cat);
      el.classList.toggle('selected', on);
      el.querySelector('input').checked = on;
      if (el.dataset.cat === 'adult') el.classList.toggle('locked', !me.confirmAdult);
    });
    $('confirm-adult').checked = !!me.confirmAdult;
  } else {
    list.innerHTML = '';
    Object.entries(CATEGORY_META).forEach(([id, meta]) => {
      if (id === 'custom') return;
      const row = document.createElement('div');
      row.className = 'cat';
      row.dataset.cat = id;
      const checked = me.categories.includes(id) ? 'checked' : '';
      row.innerHTML = `
        <input type="checkbox" id="cat-${id}" ${checked} />
        <div class="cat-icon">${meta.icon}</div>
        <div>
          <div class="cat-label">${meta.label}</div>
          <div class="cat-note">${meta.note}</div>
          ${id === 'adult' ? '<div class="adult-warn">Requires age confirmation</div>' : ''}
        </div>`;
      row.querySelector('input').onchange = () => toggleCategory(id);
      row.querySelector('input').onclick = (e) => {
        const fresh = myPlayer();
        if (id === 'adult' && (!fresh || !fresh.confirmAdult)) e.preventDefault();
      };
      list.appendChild(row);
      const after = document.createElement('div');
      if (id === 'adult') {
        after.innerHTML = `<label class="muted" style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:.85rem;margin:-4px 0 8px">
          <input type="checkbox" id="confirm-adult" style="accent-color:var(--accent)" ${me.confirmAdult ? 'checked' : ''} />
          I am 18 years or older</label>`;
        after.querySelector('input').onchange = (e) => {
          App.socket.emit('lobbyOptions', { confirmAdult: e.target.checked });
          if (!e.target.checked) {
            const fresh = myPlayer();
            App.socket.emit('lobbyOptions', {
              categories: (fresh ? fresh.categories : []).filter((c) => c !== 'adult'),
            });
          }
        };
      }
      list.appendChild(after);
    });
    list.dataset.built = '1';
  }

  $('start-btn').disabled = !(s.players.length === 2 && s.sharedCategories.length > 0 && s.phase === 'lobby');
  renderCustomList(s);
  renderLobbyLog();
}

function renderCustomList(s) {
  const list = $('custom-list');
  if (!list) return;
  const count = $('custom-count');
  if (count) count.textContent = s.custom.length;
  if (!s.custom.length) {
    list.innerHTML = '<p class="muted">No custom questions yet. Add one and it joins the shared pool.</p>';
    return;
  }
  list.innerHTML = s.custom.map((q) => `
    <div class="custom-q">
      <span class="custom-q-text">${esc(q.text)}</span>
      <span class="custom-q-by">by ${esc(q.addedBy)}</span>
      <button class="chip-btn danger" data-rm="${q.id}" title="Remove">\u2715</button>
    </div>`).join('');
  list.querySelectorAll('[data-rm]').forEach((b) => {
    b.onclick = () => App.socket.emit('removeCustom', b.dataset.rm);
  });
}

function toggleCategory(id) {
  const me = myPlayer();
  if (!me) return;
  if (id === 'adult' && !me.confirmAdult) {
    toast('Confirm you are 18 or older first.');
    return;
  }
  let cats = me.categories.includes(id) ? me.categories.filter((c) => c !== id) : [...me.categories, id];
  if (!cats.length) return toast('Pick at least one category.');
  App.socket.emit('lobbyOptions', { categories: cats });
}

/* ---------- socket routing ---------- */

function wireSocket() {
  App.socket.on('joined', (state) => {
    App.state = state;
    showScreen(state.phase === 'lobby' ? 'lobby' : 'game');
    const s = state;
    if (s.phase === 'lobby') {
      renderLobby();
    } else {
      renderLog();
      window.RoomUI.renderGame();
    }
  });

  App.socket.on('state', (state) => {
    const prevPhase = App.state && App.state.phase;
    App.state = state;
    if (state.phase === 'lobby') {
      showScreen('lobby');
      renderLobby();
    } else if (state.phase === 'summary') {
      showScreen('summary');
      window.RoomUI.renderSummary();
    } else {
      showScreen('game');
      renderLog();
      window.RoomUI.renderGame(prevPhase);
    }
  });

  App.socket.on('system', ({ text }) => addLog(text));
  App.socket.on('errorMsg', (msg) => toast(msg));
}

connectSocket((socket) => {
  App.socket = socket;
  if (socket) wireSocket();
  else document.addEventListener('DOMContentLoaded', () => toast('Could not load the game client.'));
});

/* ---------- wiring ---------- */

function bindUi() {
  buildAvatarGrid();

  const savedName = localStorage.getItem('askme.name');
  const savedAvatar = localStorage.getItem('askme.avatar');
  if (savedName) $('name-input').value = savedName;
  if (savedAvatar && AVATARS.includes(savedAvatar)) App.me.avatar = savedAvatar;

  const params = new URLSearchParams(location.search);
  const hash = location.hash.match(/join=([A-Za-z0-9]{4})/);
  const code = (params.get('code') || (hash && hash[1]) || '').toUpperCase();
  if (code) $('join-code').value = code;

  $('create-btn').onclick = doCreate;
  $('join-btn').onclick = doJoin;
  $('join-code').addEventListener('keydown', (e) => e.key === 'Enter' && doJoin());
  $('name-input').addEventListener('keydown', (e) => e.key === 'Enter' && doJoin());

  $('start-btn').onclick = () => App.socket.emit('startGame');
  $('leave-room-btn').onclick = () => App.socket.emit('leave');
  $('leave-final-btn').onclick = () => App.socket.emit('leave');
  $('end-game-btn').onclick = () => App.socket.emit('endGame');
  $('play-again-btn').onclick = () => App.socket.emit('playAgain');

  const bindAdd = (inputId, btnId) => {
    const inp = $(inputId);
    const btn = $(btnId);
    const send = () => {
      const v = inp.value.trim();
      if (!v) return toast('Write a question first.');
      App.socket.emit('addCustom', v);
      inp.value = '';
    };
    btn.onclick = send;
    inp.addEventListener('keydown', (e) => e.key === 'Enter' && send());
  };
  bindAdd('custom-input', 'custom-add');
  bindAdd('custom-input-game', 'custom-add-game');

  const copy = (get, msg) => () => {
    navigator.clipboard.writeText(get()).then(() => toast(msg), () => toast('Copy failed'));
  };
  $('copy-room').onclick = copy(() => (App.state ? App.state.code : ''), 'Room code copied!');
  $('share-link').onclick = copy(
    () => `${location.origin}/?code=${App.state ? App.state.code : ''}`,
    'Invite link copied!'
  );
}

document.addEventListener('DOMContentLoaded', bindUi);
