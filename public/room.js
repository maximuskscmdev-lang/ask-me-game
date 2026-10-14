/* Ask Me - room.js : game + summary rendering */

const RoomUI = {
  renderGame(prevPhase) {
    try {
      RoomUI._render(prevPhase);
    } catch (e) {
      console.error('renderGame failed:', e);
      const panel = $('main-panel');
      if (panel && !panel.querySelector('.render-error')) {
        const err = document.createElement('p');
        err.className = 'error render-error';
        err.textContent = 'Display hiccup - if the screen stays stuck, reload the page.';
        panel.prepend(err);
      }
    }
  },

  _render(prevPhase) {
    const s = App.state;
    if (!s) return;
    const me = myPlayer();
    if (!me) return;

    renderGameHeader(s, me);
    const panel = $('main-panel');
    const html = [];

    if (s.question) html.push(questionCard(s, me));

    const phase = s.phase;
    const iAmAsker = s.asker === me.name;

    if (phase === 'turn') {
      html.push(iAmAsker ? askerTurnCard(s) : waitingCard(`${s.asker} is picking a category\u2026`));
    } else if (phase === 'asked') {
      html.push(
        iAmAsker
          ? waitingCard(`Waiting for your question to be answered\u2026`)
          : askedActions(s)
      );
    } else if (phase === 'answer') {
      html.push(
        iAmAsker
          ? waitingCard('Your question was accepted \u2014 they are writing an answer\u2026')
          : answerForm()
      );
    } else if (phase === 'rate') {
      html.push(
        iAmAsker
          ? [answerCard(s), ratingActions()].join('')
          : waitingCard('Waiting for the asker to rate your answer\u2026')
      );
    }

    const sig = [phase, s.question && s.question.id, s.questionRating, s.answerText, s.answerRating, s.sharedCategories.join(',')].join('|');
    const keepText = $('answer-text') || $('own-question');
    const kept = keepText ? keepText.value : '';
    const keptSel = keepText ? keepText.selectionStart : 0;
    const hadFocus = keepText && document.activeElement === keepText;
    if (sig !== RoomUI._sig) {
      RoomUI._sig = sig;
      panel.innerHTML = html.join('');
      bindPanel();
    } else if (keepText) {
      keepText.value = kept;
      keepText.selectionStart = keepText.selectionEnd = keptSel;
      if (hadFocus) keepText.focus();
    }
  },

  renderSummary() {
    const s = App.state;
    const me = myPlayer();
    const players = s.players;
    const [a, b] = players;
    let title = 'Results';
    if (a.score !== b.score) {
      const w = a.score > b.score ? a : b;
      title = `${w.avatar} ${w.name} wins!`;
    } else {
      title = "It's a tie \u2014 well played!";
    }

    const stats = players.map((p) => `
      <div class="stat">
        <div class="num">${p.score}</div>
        <div class="lbl">${esc(p.avatar)} ${esc(p.name)} \u2014 likes received</div>
      </div>
      <div class="stat">
        <div class="num">${p.answered}</div>
        <div class="lbl">${esc(p.avatar)} ${esc(p.name)} \u2014 answered</div>
      </div>
      <div class="stat">
        <div class="num">${p.rejected}</div>
        <div class="lbl">${esc(p.avatar)} ${esc(p.name)} \u2014 rejected</div>
      </div>`).join('');

    const history = s.history.length
      ? s.history.map((h) => historyItem(h)).join('')
      : '<p class="muted">No completed questions yet.</p>';

    $('summary-card').innerHTML = `
      <h1 class="summary-title">${title}</h1>
      <div class="stat-grid">${stats}</div>
      <h2>Game history</h2>
      <div class="history">${history}</div>`;
  },
};

window.RoomUI = RoomUI;

/* ---------- pieces ---------- */

function renderGameHeader(s, me) {
  const iAmAsker = s.asker === me.name;
  const cards = s.players.map((p) => {
    const isMe = p.name === me.name;
    const isAsker = s.asker === p.name && s.phase !== 'summary';
    return `<div class="player ${isAsker ? 'active' : ''}">
      <div class="av">${esc(p.avatar)}</div>
      <div class="meta">
        <span class="pname">${esc(p.name)}${isMe ? ' <span class="badge">you</span>' : ''}${p.connected ? '' : ' <span class="badge warn">reconnecting\u2026</span>'}</span>
        <span class="pscore">${p.score} \u2764\uFE0F \u00B7 ${p.answered} answered \u00B7 ${p.rejected} rejected</span>
      </div>
    </div>`;
  }).join('');
  $('game-header').innerHTML = `
    <div class="players">${cards}</div>
    <div class="round-chip">Round ${s.round} of ${s.maxRounds} \u00B7 ${s.phase === 'turn' ? 'choosing category' : s.phase === 'asked' ? 'reaction' : s.phase === 'answer' ? 'answering' : s.phase === 'rate' ? 'rating answer' : ''}</div>
    <div class="turn-banner">${s.asker ? (iAmAsker ? `Your turn to ask \u2014 pick a category` : `${esc(s.asker)} is asking you`) : ''}</div>`;
}

function questionCard(s, me) {
  const meta = CATEGORY_META[s.question.category] || { label: s.question.category, icon: '\u2753' };
  let tag = '';
  if (s.questionRating) {
    const good = s.questionRating === 'like';
    tag = `<span class="tag ${good ? 'good' : 'bad'}">question ${good ? 'liked' : 'disliked'}</span>`;
  }
  return `<div class="qcard">
    <span class="qtag">${meta.icon} ${meta.label}</span>
    <div class="qtext">${esc(s.question.text)}</div>
    <div class="answered-by">asked by ${esc(s.question.askedBy)}</div>
    ${tag ? `<div class="htags">${tag}</div>` : ''}
  </div>`;
}

function askerTurnCard(s) {
  const cats = s.sharedCategories
    .map(
      (id) =>
        `<button class="btn secondary" data-cat="${id}">
          <span>${CATEGORY_META[id].icon}</span>${CATEGORY_META[id].label}
        </button>`
    )
    .join('');
  const random = s.sharedCategories.length > 1 ? '<button class="btn secondary" data-cat="random"><span>\u{1F3B2}</span>Random</button>' : '';
  return `<h2>Pick a question category</h2>
    <div class="choices">${cats}${random}</div>
    <div class="composer">
      <h3>Or write your own question</h3>
      <textarea id="own-question" rows="3" maxlength="500" placeholder="Type any question you want to ask..."></textarea>
      <label class="pool-check">
        <input type="checkbox" id="own-pool" />
        also save it to the shared pool
      </label>
      <button class="btn primary" data-action="ask-own">Ask this question</button>
    </div>
    <p class="muted">You ask, they answer \u2014 then they react to your question.</p>`;
}

function askedActions() {
  return `<div class="choices">
      <button class="btn like" data-action="like-question"><span>\u{1F44D}</span>Like</button>
      <button class="btn dislike" data-action="dislike-question"><span>\u{1F44E}</span>Dislike</button>
      <button class="btn reject" data-action="reject-question"><span>\u270B</span>Reject</button>
    </div>
    <p class="muted">Reject to skip this question \u2014 no points for anyone.</p>`;
}

function answerForm() {
  return `<h2>Your answer</h2>
    <textarea id="answer-text" rows="4" maxlength="500" placeholder="Type your answer\u2026"></textarea>
    <button class="btn primary" data-action="submit-answer">Send answer</button>`;
}

function answerCard(s) {
  return `<h2>Their answer</h2>
    <div class="acard">${esc(s.answerText || '')}</div>
    <div class="answered-by">answered by the other player</div>`;
}

function ratingActions() {
  return `<div class="rate-choices">
      <button class="btn like" data-action="like-answer"><span>\u{1F44D}</span>Like answer</button>
      <button class="btn dislike" data-action="dislike-answer"><span>\u{1F44E}</span>Dislike answer</button>
    </div>
    <p class="muted">A like gives them a point.</p>`;
}

function waitingCard(text) {
  return `<div class="waiting">\u23F3 ${esc(text)}</div>`;
}

function historyItem(h) {
  const tags = [];
  tags.push(`<span class="tag">${CATEGORY_META[h.category] ? CATEGORY_META[h.category].icon : ''} ${h.category}</span>`);
  if (h.rejected) tags.push('<span class="tag rej">rejected</span>');
  if (h.questionRating) tags.push(`<span class="tag ${h.questionRating === 'like' ? 'good' : 'bad'}">Q ${h.questionRating}</span>`);
  if (h.answerRating) tags.push(`<span class="tag ${h.answerRating === 'like' ? 'good' : 'bad'}">A ${h.answerRating}</span>`);
  return `<div class="hitem">
    <div class="htags"><span class="tag">R${h.round}</span>${tags.join('')}</div>
    <div class="hq">${esc(h.question)}</div>
    <div class="answered-by">asked by ${esc(h.askedBy)}</div>
    ${h.answer ? `<div class="ha acard">${esc(h.answer)}</div>` : (h.rejected ? '<div class="answered-by">not answered</div>' : '')}
  </div>`;
}

/* ---------- panel actions ---------- */

function bindPanel() {
  const s = App.state;

  document.querySelectorAll('[data-cat]').forEach((b) => {
    b.onclick = () => emit('chooseCategory', b.dataset.cat);
  });

  document.querySelectorAll('[data-action]').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.action;
      if (a === 'like-question') emit('questionRating', 'like');
      if (a === 'dislike-question') emit('questionRating', 'dislike');
      if (a === 'reject-question') emit('rejectQuestion');
      if (a === 'submit-answer') {
        const v = $('answer-text') ? $('answer-text').value : '';
        if (v.trim()) emit('submitAnswer', v);
        else toast('Write something first.');
      }
      if (a === 'like-answer') emit('answerRating', 'like');
      if (a === 'dislike-answer') emit('answerRating', 'dislike');
      if (a === 'ask-own') {
        const inp = $('own-question');
        const toPool = $('own-pool') && $('own-pool').checked;
        const v = inp ? inp.value : '';
        if (v.trim()) emit('askCustom', { text: v, toPool });
        else toast('Write a question first.');
      }
    };
  });

  const ta = $('answer-text');
  if (ta) {
    ta.focus();
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (ta.value.trim()) emit('submitAnswer', ta.value);
      }
    });
  }

  const own = $('own-question');
  if (own) {
    own.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (own.value.trim()) {
          const toPool = $('own-pool') && $('own-pool').checked;
          emit('askCustom', { text: own.value, toPool });
        }
      }
    });
  }
}
