/* Trace every state transition on both browser pages to find the desync */
const { chromium } = require('playwright-core');

const EXEC = '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell';
const UI = 'https://ask-me-game-iota.vercel.app/';

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  const trace = [];
  const errors = [];

  const mk = async (name) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[${name}] ${e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] console: ${m.text()}`));
    page.on('framenavigated', () => {});
    await page.goto(UI, { waitUntil: 'networkidle' });
    await page.evaluate((who) => {
      window.__trace = [];
      App.socket.on('state', (s) => window.__trace.push('state phase=' + s.phase + ' asker=' + s.asker + ' q=' + (s.question && s.question.id) + ' answer=' + JSON.stringify(s.answerText) + ' aRating=' + s.answerRating + ' shared=' + JSON.stringify(s.sharedCategories)));
      App.socket.on('errorMsg', (m) => window.__trace.push('errorMsg: ' + m));
      App.socket.on('system', (m) => window.__trace.push('system: ' + m.text));
      ['like-question', 'dislike-question', 'reject-question', 'submit-answer', 'like-answer', 'dislike-answer'].forEach((a) => {
        document.addEventListener('click', (e) => {
          const b = e.target.closest('[data-action="' + a + '"]');
          if (b) window.__trace.push('CLICK ' + a);
        }, true);
      });
    }, name);
    return page;
  };

  const A = await mk('A');
  const B = await mk('B');

  await A.fill('#name-input', 'TraceA');
  await A.click('#create-btn');
  await A.waitForSelector('#screen-lobby:not(.hidden)');
  const code = (await A.textContent('#room-code-display')).trim();

  await B.fill('#name-input', 'TraceB');
  await B.fill('#join-code', code);
  await B.click('#join-btn');
  await B.waitForSelector('#screen-lobby:not(.hidden)');
  await A.waitForTimeout(500);

  await A.click('#start-btn');
  await A.waitForSelector('#screen-game:not(.hidden)');
  await A.waitForSelector('#main-panel [data-cat]');
  await A.click('#main-panel [data-cat]');

  await B.waitForSelector('[data-action="like-question"]', { timeout: 8000 });
  await B.click('[data-action="like-question"]');
  await B.waitForTimeout(400);

  await B.waitForSelector('#answer-text', { timeout: 8000 });
  console.log('answer form visible on B:', !!await B.$('#answer-text'));
  await B.fill('#answer-text', 'My traced answer.');
  await B.click('[data-action="submit-answer"]');

  // poll the asker's panel every 300ms for 6s right after submission
  for (let i = 0; i < 20; i++) {
    const has = !!(await A.$('[data-action="like-answer"]'));
    const phase = await A.evaluate(() => App.state && App.state.phase);
    const sig = await A.evaluate(() => window.RoomUI && window.RoomUI._sig);
    console.log(`t+${i * 300}ms  asker hasRateBtn=${has}  clientPhase=${phase}  sig=${sig}`);
    if (has) break;
    await A.waitForTimeout(300);
  }
  console.log('A trace:', await A.evaluate(() => window.__trace.join('\n  ')));
  console.log('B trace:', await B.evaluate(() => window.__trace.join('\n  ')));
  console.log('A panel:', (await A.innerHTML('#main-panel')).replace(/\s+/g, ' ').slice(0, 260));
  console.log('B panel:', (await B.innerHTML('#main-panel')).replace(/\s+/g, ' ').slice(0, 260));
  console.log('A has like-answer btn:', !!(await A.$('[data-action="like-answer"]')));
  console.log('errors:', errors.length ? errors.join('\n') : '(none)');
  await browser.close();
})().catch((e) => {
  console.error('CRASH', e.message);
  process.exit(1);
});
