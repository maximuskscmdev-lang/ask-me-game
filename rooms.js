const { QUESTIONS } = require('./questions');

const ROUNDS_PER_GAME = 10;

class Room {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = [];
    this.phase = 'lobby';
    this.questionUsed = {};
    this.q = null;
    this.qRating = null;
    this.answerText = null;
    this.aRating = null;
    this.turn = 0;
    this.round = 1;
    this.history = [];
    this.custom = [];
  }

  playerList() {
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      answered: p.answered,
      rejected: p.rejected,
      categories: p.categories,
      confirmAdult: p.confirmAdult,
      connected: p.connected !== false,
      ready: this.isReady(p),
    }));
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  asker() {
    return this.players[this.turn % 2];
  }

  answerer() {
    return this.players[(this.turn + 1) % 2];
  }

  sharedCategories() {
    if (this.players.length !== 2 || !this.everyoneReady()) return [];
    const [a, b] = this.players;
    const cats = a.categories.filter((c) => b.categories.includes(c));
    if (this.custom.length) cats.push('custom');
    return cats;
  }

  isReady(p) {
    const hasAny = p.categories.length > 0 || this.custom.length > 0;
    const adultOk = !p.categories.includes('adult') || p.confirmAdult;
    return hasAny && adultOk;
  }

  everyoneReady() {
    return this.players.length === 2 && this.players.every((p) => this.isReady(p));
  }

  emitToBoth(event, payload) {
    this.players.forEach((p) => this.io.to(p.id).emit(event, payload));
  }

  broadcast() {
    this.io.to(this.code).emit('state', this.wide());
  }

  join({ id, name, avatar }) {
    this.players.push({
      id,
      name,
      avatar,
      score: 0,
      answered: 0,
      rejected: 0,
      categories: ['spicy', 'personal', 'general'],
      confirmAdult: false,
      connected: true,
    });
    this.emitToBoth('system', { text: `${name} joined the room.` });
  }

  leave(socketId) {
    this.players = this.players.filter((p) => p.id !== socketId);
    if (this.phase !== 'lobby') this.phase = 'lobby';
  }

  startGame() {
    if (this.players.length !== 2) throw new Error('Waiting for the second player.');
    if (!this.everyoneReady()) throw new Error('Both players must pick categories (and confirm 18+ if enabled).');
    this.turn = 0;
    this.round = 1;
    this.history = [];
    this.players.forEach((p) => {
      p.score = 0;
      p.answered = 0;
      p.rejected = 0;
    });
    this.questionUsed = {};
    this.q = null;
    this.qRating = null;
    this.answerText = null;
    this.aRating = null;
    this.phase = 'turn';
    this.emitToBoth('system', { text: `${this.asker().name} asks the first question!` });
  }

  chooseCategory(category) {
    if (this.phase !== 'turn') throw new Error('Not your turn to ask.');
    const shared = this.sharedCategories();
    if (!shared.length) throw new Error('No shared categories.');
    const chosenLabel = category === 'random' ? 'random' : category;
    if (category === 'random') {
      category = shared[Math.floor(Math.random() * shared.length)];
    }
    if (!shared.includes(category)) throw new Error('Pick a shared category.');
    this.q = this.drawQuestion(category);
    this.qRating = null;
    this.answerText = null;
    this.aRating = null;
    this.phase = 'asked';
    this.emitToBoth('system', { text: `${this.asker().name} asks a ${chosenLabel} question.` });
  }

  drawQuestion(category) {
    if (category === 'custom') {
      const used = this.questionUsed.custom || [];
      const pool = this.custom.filter((q) => !used.includes(q.id));
      if (!pool.length) this.questionUsed.custom = [];
      const list = pool.length ? pool : this.custom;
      const pick = list[Math.floor(Math.random() * list.length)];
      this.questionUsed.custom = [...used, pick.id];
      return { id: pick.id, text: pick.text, category: 'custom', askedBy: this.asker().name };
    }
    const used = this.questionUsed[category] || [];
    const pool = QUESTIONS[category].filter((q) => !used.includes(q.id));
    if (!pool.length) this.questionUsed[category] = [];
    const list = pool.length ? pool : QUESTIONS[category];
    const pick = list[Math.floor(Math.random() * list.length)];
    this.questionUsed[category] = [...used, pick.id];
    return { id: pick.id, text: pick.text, category, askedBy: this.asker().name };
  }

  askCustom(socketId, text, toPool) {
    if (this.phase !== 'turn' || socketId !== this.asker().id) throw new Error('Not your turn to ask.');
    const t = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 500);
    if (!t) throw new Error('Write a question first.');
    const asker = this.asker();
    const q = {
      id: `x${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
      text: t,
      category: 'custom',
      askedBy: asker.name,
      oneOff: true,
    };
    if (toPool) {
      const dup = this.custom.some((c) => c.text.toLowerCase() === t.toLowerCase());
      if (!dup && this.custom.length < 100) {
        this.custom.push({ id: q.id, text: t, addedBy: asker.name });
      }
    }
    this.q = q;
    this.qRating = null;
    this.answerText = null;
    this.aRating = null;
    this.phase = 'asked';
    this.emitToBoth('system', { text: `${asker.name} asks a custom question.` });
  }

  addCustom(socketId, text) {
    const t = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!t) throw new Error('Write a question first.');
    if (this.custom.length >= 100) throw new Error('Custom pool is full (100).');
    if (this.custom.some((q) => q.text.toLowerCase() === t.toLowerCase())) {
      throw new Error('That question is already in the pool.');
    }
    const q = { id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, text: t, addedBy: this.player(socketId).name };
    this.custom.push(q);
    this.emitToBoth('system', { text: `${q.addedBy} added a custom question.` });
    return q;
  }

  removeCustom(socketId, qid) {
    const idx = this.custom.findIndex((q) => q.id === qid);
    if (idx === -1) throw new Error('Question not found.');
    const [removed] = this.custom.splice(idx, 1);
    this.emitToBoth('system', { text: `${this.player(socketId).name} removed a custom question.` });
    return removed;
  }

  questionRating(socketId, value) {
    if (this.phase !== 'asked' || socketId !== this.answerer().id) throw new Error('Not your turn to rate.');
    if (!['like', 'dislike'].includes(value)) throw new Error('Bad rating.');
    this.qRating = value;
    if (value === 'like') this.asker().score += 1;
    this.phase = 'answer';
    this.emitToBoth('system', {
      text: `${this.answerer().name} ${value === 'like' ? 'liked' : 'disliked'} the question.`,
    });
  }

  rejectQuestion(socketId) {
    if (this.phase !== 'asked' || socketId !== this.answerer().id) throw new Error('Not your turn to reject.');
    this.answerer().rejected += 1;
    this.history.push({
      round: this.round,
      category: this.q.category,
      question: this.q.text,
      askedBy: this.q.askedBy,
      answeredBy: this.answerer().name,
      answer: null,
      questionRating: null,
      answerRating: null,
      rejected: true,
    });
    this.emitToBoth('system', { text: `${this.answerer().name} rejected the question.` });
    this.endTurn();
  }

  submitAnswer(socketId, text) {
    if (this.phase !== 'answer' || socketId !== this.answerer().id) throw new Error('Not your turn to answer.');
    const t = String(text || '').trim().slice(0, 500);
    if (!t) throw new Error('Answer cannot be empty.');
    this.answerText = t;
    this.answerer().answered += 1;
    this.phase = 'rate';
    this.emitToBoth('system', { text: `${this.answerer().name} answered!` });
  }

  answerRating(socketId, value) {
    if (this.phase !== 'rate' || socketId !== this.asker().id) throw new Error('Not your turn to rate.');
    if (!['like', 'dislike'].includes(value)) throw new Error('Bad rating.');
    this.aRating = value;
    if (value === 'like') this.answerer().score += 1;
    this.history.push({
      round: this.round,
      category: this.q.category,
      question: this.q.text,
      askedBy: this.q.askedBy,
      answeredBy: this.answerer().name,
      answer: this.answerText,
      questionRating: this.qRating,
      answerRating: this.aRating,
      rejected: false,
    });
    this.emitToBoth('system', {
      text: `${this.asker().name} ${value === 'like' ? 'liked' : 'disliked'} the answer.`,
    });
    this.endTurn();
  }

  endTurn() {
    if (this.round >= ROUNDS_PER_GAME) {
      this.phase = 'summary';
      const winner =
        this.players[0].score === this.players[1].score
          ? null
          : this.players.reduce((a, b) => (a.score >= b.score ? a : b));
      this.emitToBoth('system', {
        text: winner ? `${winner.name} wins the game!` : "It's a tie!",
      });
      return;
    }
    this.round += 1;
    this.turn += 1;
    this.q = null;
    this.qRating = null;
    this.answerText = null;
    this.aRating = null;
    this.phase = 'turn';
  }

  playAgain() {
    this.phase = 'lobby';
    this.turn = 0;
    this.round = 1;
    this.history = [];
    this.players.forEach((p) => {
      p.score = 0;
      p.answered = 0;
      p.rejected = 0;
    });
    this.questionUsed = {};
    this.q = null;
    this.qRating = null;
    this.answerText = null;
    this.aRating = null;
  }

  endGame() {
    if (this.phase === 'lobby' || this.phase === 'summary') return;
    this.phase = 'summary';
    this.emitToBoth('system', { text: 'The game was ended early. Here are the results!' });
  }

  wide() {
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      maxRounds: ROUNDS_PER_GAME,
      players: this.playerList(),
      sharedCategories: this.sharedCategories(),
      custom: this.custom,
      asker: this.phase === 'lobby' || this.phase === 'summary' ? null : this.asker().name,
      question: this.q,
      questionRating: this.qRating,
      answerText: this.answerText,
      answerRating: this.aRating,
      history: this.history,
    };
  }
}

module.exports = Room;
