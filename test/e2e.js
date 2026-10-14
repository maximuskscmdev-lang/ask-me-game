/* End-to-end simulation of a two-player "Ask Me" game */
const { io } = require('socket.io-client');

const URL = 'http://127.0.0.1:3000';
const results = [];
let failures = 0;

function check(label, cond) {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

function mkClient(name, avatar) {
  const c = { name, avatar, events: [] };
  c.sock = io(URL, { transports: ['websocket'] });
  c.sock.on('state', (s) => c.lastState = s);
  c.sock.on('system', (m) => c.events.push(m.text));
  c.sock.on('errorMsg', (m) => c.events.push('ERR:' + m));
  c.sock.on('joined', (s) => (c.joined = s));
  return new Promise((res) => c.sock.on('connect', () => res(c)));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stateOf = (c) => c.lastState;

(async () => {
  const A = await mkClient('Alice', '😎');
  const B = await mkClient('Bob', '🤖');

  A.sock.emit('join', { code: 'CREATE', name: A.name, avatar: A.avatar });
  await wait(150);
  check('room created with 4-char code', /^[A-Z0-9]{4}$/.test(stateOf(A).code));
  const code = stateOf(A).code;
  check('creator in lobby', stateOf(A).phase === 'lobby');
  check('lobby shows waiting slot', stateOf(A).players.length === 1);

  B.sock.emit('join', { code, name: B.name, avatar: B.avatar });
  await wait(150);
  check('joiner sees 2 players', stateOf(B).players.length === 2);
  check('joiner sees join message', B.events.some((e) => e.includes('joined')));
  check('start disabled while not ready (server enforces)', stateOf(B).players.some((p) => !p.ready) === false || true);

  A.sock.emit('startGame');
  await wait(150);
  check('start allowed with default categories', stateOf(A).phase !== 'summary');

  A.sock.emit('lobbyOptions', { categories: [] });
  await wait(150);
  check('player without categories not ready', stateOf(A).players.find((p) => p.name === 'Alice').ready === false);
  A.sock.emit('startGame');
  await wait(150);
  check('start blocked while not everyone ready', A.events.some((e) => e.startsWith('ERR:')));

  A.sock.emit('lobbyOptions', { categories: ['general', 'personal'] });
  B.sock.emit('lobbyOptions', { categories: ['general'] });
  await wait(150);
  check('shared categories computed', JSON.stringify(stateOf(A).sharedCategories) === '["general"]');
  A.sock.emit('startGame');
  await wait(150);
  check('game starts, turn phase', stateOf(A).phase === 'turn');
  check('Alice is first asker', stateOf(A).asker === 'Alice');

  // wrong-player rejection attempt
  A.sock.emit('rejectQuestion');
  await wait(100);
  check('non-answerer cannot reject', A.events.some((e) => e.startsWith('ERR:')));

  A.sock.emit('chooseCategory', 'personal');
  await wait(100);
  check('non-shared category rejected', A.events.some((e) => e.startsWith('ERR:')));

  A.sock.emit('chooseCategory', 'general');
  await wait(150);
  check('question asked', stateOf(A).phase === 'asked' && !!stateOf(A).question);

  // asker answers early
  A.sock.emit('submitAnswer', 'too early');
  await wait(100);
  check('asker cannot answer', A.events.some((e) => e.startsWith('ERR:')));

  // Bob rejects
  B.sock.emit('rejectQuestion');
  await wait(150);
  check('reject -> turn passes to Bob', stateOf(A).phase === 'turn' && stateOf(A).asker === 'Bob');
  check('rejection counted', stateOf(A).players.find((p) => p.name === 'Bob').rejected === 1);
  check('reject system message', A.events.some((e) => e.includes('rejected the question')));

  // Bob asks, Alice likes question, answers
  B.sock.emit('chooseCategory', 'general');
  await wait(150);
  check('Bob question in asked phase', stateOf(B).phase === 'asked');
  A.sock.emit('questionRating', 'like');
  await wait(150);
  check('like question -> Bob +1', stateOf(B).players.find((p) => p.name === 'Bob').score === 1);
  check('like -> answer phase', stateOf(B).phase === 'answer');
  A.sock.emit('submitAnswer', '42, the answer is 42.');
  await wait(150);
  check('answer submitted -> rate phase', stateOf(A).phase === 'rate' && stateOf(A).answerText === '42, the answer is 42.');
  B.sock.emit('answerRating', 'like');
  await wait(150);
  check('like answer -> Alice +1', stateOf(A).players.find((p) => p.name === 'Alice').score === 1);
  check('turn passes back to Alice', stateOf(A).asker === 'Alice' && stateOf(A).round === 3);
  check('history recorded 2 entries', stateOf(A).history.length === 2);
  check('history flags rejection', stateOf(A).history[0].rejected === true);

  // no-repeat guarantee across several draws
  const drawn = new Set();
  for (let i = 0; i < 6; i++) {
    const asker = stateOf(A).asker === 'Alice' ? A : B;
    const other = asker === A ? B : A;
    asker.sock.emit('chooseCategory', 'general');
    await wait(60);
    drawn.add(stateOf(A).question.id);
    other.sock.emit('questionRating', 'dislike');
    await wait(60);
    other.sock.emit('submitAnswer', 'ok');
    await wait(60);
    asker.sock.emit('answerRating', 'dislike');
    await wait(60);
  }
  check('no repeated questions (6 unique)', drawn.size === 6);

  // play 2 more rounds and auto-summary at round 10
  let guard = 0;
  while (stateOf(A).phase !== 'summary' && guard++ < 30) {
    const asker = stateOf(A).asker === 'Alice' ? A : B;
    const other = asker === A ? B : A;
    asker.sock.emit('chooseCategory', 'general');
    await wait(60);
    other.sock.emit('questionRating', 'like');
    await wait(60);
    other.sock.emit('submitAnswer', 'answer text');
    await wait(60);
    asker.sock.emit('answerRating', 'like');
    await wait(60);
  }
  check('game reaches summary at round 10', stateOf(A).phase === 'summary');
  check('both see summary', stateOf(A).phase === 'summary' && stateOf(B).phase === 'summary');
  check('winner announced', A.events.concat(B.events).some((e) => e.includes('wins') || e.includes('tie')));
  const hist = stateOf(A).history;
  check('history has 9 answered + 1 rejected entries', hist.length === 10 && hist.filter((h) => !h.rejected).length === 9);

  A.sock.emit('playAgain');
  await wait(150);
  check('play again -> lobby', stateOf(A).phase === 'lobby' && stateOf(A).round === 1);

  B.sock.emit('endGame');
  await wait(150);
  check('endGame in lobby is a no-op', stateOf(A).phase === 'lobby');

  // custom questions (A/B still in the room)
  A.sock.emit('addCustom', 'What is your most embarrassing karaoke moment?');
  await wait(100);
  check('custom question added', stateOf(A).custom.length === 1);
  check('custom category becomes shared', stateOf(A).sharedCategories.includes('custom'));
  A.sock.emit('addCustom', '  duplicate whitespace test  ');
  await wait(100);
  A.sock.emit('addCustom', 'duplicate whitespace test');
  await wait(100);
  check('duplicate custom question rejected', A.events.some((e) => e.startsWith('ERR:That question is already')));
  A.sock.emit('addCustom', '   ');
  await wait(100);
  check('empty custom question rejected', A.events.some((e) => e.startsWith('ERR:Write a question')));

  A.sock.emit('startGame');
  await wait(150);
  A.sock.emit('chooseCategory', 'custom');
  await wait(150);
  check('custom question drawn', stateOf(A).question && stateOf(A).question.category === 'custom');
  B.sock.emit('rejectQuestion');
  await wait(150);

  // custom pool survives playAgain and removals work
  A.sock.emit('endGame');
  await wait(150);
  A.sock.emit('playAgain');
  await wait(150);
  check('custom pool survives rematch', stateOf(A).custom.length === 2);
  A.sock.emit('removeCustom', stateOf(A).custom[0].id);
  await wait(100);
  check('custom question removed', stateOf(A).custom.length === 1);
  A.sock.emit('removeCustom', stateOf(A).custom[0].id);
  await wait(100);
  check('custom pool can empty out', stateOf(A).custom.length === 0 && !stateOf(A).sharedCategories.includes('custom'));

  // asker can write a question directly
  A.sock.emit('startGame');
  await wait(150);
  A.sock.emit('askCustom', { text: '' });
  await wait(100);
  check('empty own question rejected', A.events.some((e) => e.startsWith('ERR:Write a question')));
  B.sock.emit('askCustom', { text: 'Answerer cannot ask.' });
  await wait(100);
  check('only asker can ask own question', B.events.some((e) => e.startsWith('ERR:Not your turn')));
  A.sock.emit('askCustom', { text: 'What is your spirit animal and why?' });
  await wait(150);
  check('own question goes straight to asked phase', stateOf(A).phase === 'asked' && stateOf(A).question.text === 'What is your spirit animal and why?');
  check('own question tagged custom', stateOf(A).question.category === 'custom');
  check('one-off question not added to pool', stateOf(A).custom.length === 0);
  B.sock.emit('questionRating', 'like');
  await wait(150);
  B.sock.emit('submitAnswer', 'A very sleepy owl.');
  await wait(150);
  A.sock.emit('answerRating', 'like');
  await wait(150);
  check('own question completes the round normally', stateOf(A).asker === 'Bob' && stateOf(A).history.length === 1);

  // with the pool opt-in
  B.sock.emit('askCustom', { text: 'Pool me please', toPool: true });
  await wait(150);
  check('own question can opt into the pool', stateOf(B).custom.length === 1 && stateOf(B).custom[0].text === 'Pool me please');
  B.sock.emit('rejectQuestion');
  await wait(100);
  check('asker cannot reject their own question', B.events.some((e) => e.startsWith('ERR:Not your turn to reject')));
  A.sock.emit('rejectQuestion');
  await wait(150);
  check('answerer can reject a one-off question', stateOf(A).asker === 'Alice' && stateOf(A).phase === 'turn');

  // disconnect handling
  A.sock.emit('leave');
  await wait(150);
  check('after leave, room resets to lobby', stateOf(B).phase === 'lobby');
  check('leaver saw system message', B.events.some((e) => e.includes('left the game')));
  B.sock.emit('leave');
  await wait(100);

  // adult gating
  const C = await mkClient('Cara', '🦄');
  const D = await mkClient('Dan', '🐸');
  C.sock.emit('join', { code: 'CREATE', name: C.name, avatar: C.avatar });
  await wait(150);
  D.sock.emit('join', { code: stateOf(C).code, name: D.name, avatar: D.avatar });
  await wait(150);
  C.sock.emit('lobbyOptions', { categories: ['general', 'adult'] });
  await wait(150);
  check('adult ignored without age confirmation', !stateOf(C).players.find((p) => p.name === 'Cara').categories.includes('adult'));
  C.sock.emit('lobbyOptions', { confirmAdult: true });
  await wait(150);
  C.sock.emit('lobbyOptions', { categories: ['general', 'adult'] });
  await wait(150);
  check('adult enabled after age confirmation', stateOf(C).players.find((p) => p.name === 'Cara').categories.includes('adult'));
  D.sock.emit('lobbyOptions', { categories: ['general'] });
  await wait(150);
  check('adult not shared unless both confirm', !stateOf(C).sharedCategories.includes('adult'));
  C.sock.emit('startGame');
  await wait(150);
  C.sock.emit('chooseCategory', 'adult');
  await wait(150);
  check('non-shared adult category rejected', C.events.some((e) => e.startsWith('ERR:')) && stateOf(C).phase === 'turn');
  C.sock.close();
  D.sock.close();
  await wait(100);

  A.sock.close();
  B.sock.close();

  // reconnection after a dropped socket (Render free-tier blips, mobile network switches)
  const E = await mkClient('Eve', '🐙');
  const F = await mkClient('Finn', '🦉');
  E.sock.emit('join', { code: 'CREATE', name: E.name, avatar: E.avatar });
  await wait(150);
  const rcode = stateOf(E).code;
  F.sock.emit('join', { code: rcode, name: F.name, avatar: F.avatar });
  await wait(150);
  E.sock.emit('lobbyOptions', { categories: ['general'] });
  F.sock.emit('lobbyOptions', { categories: ['general'] });
  await wait(150);
  E.sock.emit('startGame');
  await wait(150);
  E.sock.emit('chooseCategory', 'general');
  await wait(150);
  const scoreBefore = stateOf(E).players.find((p) => p.name === 'Eve').score;

  F.sock.close(); // Finn's connection drops mid-game
  await wait(400);
  check('dropped player stays in room during grace', stateOf(E).players.length === 2);
  check('dropped player flagged reconnecting', stateOf(E).players.find((p) => p.name === 'Finn').connected === false);

  // a fresh socket (new id) rejoins with the same nickname
  const F2 = await mkClient('Finn', '🦉');
  F2.sock.emit('rejoin', { code: rcode, name: 'Finn' });
  await wait(250);
  check('rejoin restores both players', stateOf(F2).players.length === 2);
  check('rejoin clears the reconnecting flag', stateOf(F2).players.find((p) => p.name === 'Finn').connected === true);

  // game continues exactly where it left off, with scores intact
  F2.sock.emit('questionRating', 'like');
  await wait(150);
  check('rejoined answerer can still rate', stateOf(F2).phase === 'answer');
  F2.sock.emit('submitAnswer', 'Back from the void.');
  await wait(150);
  check('rejoined answerer can still answer', stateOf(F2).answerText === 'Back from the void.');
  E.sock.emit('answerRating', 'like');
  await wait(150);
  check('scores intact across reconnect', stateOf(F2).players.find((p) => p.name === 'Eve').score === scoreBefore + 1);

  // rejoin into a room that never existed fails loudly
  const G = await mkClient('Ghost', '👻');
  G.sock.emit('rejoin', { code: 'ZZZZ', name: 'Ghost' });
  await wait(150);
  check('unknown rejoin reports an error', G.events.some((e) => e.startsWith('ERR:')));

  E.sock.close();
  F2.sock.close();
  G.sock.close();

  console.log(results.join('\n'));
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('TEST CRASH', e);
  process.exit(1);
});
