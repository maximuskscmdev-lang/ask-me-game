/* Simulate a real network drop mid-game and verify both players recover */
const { chromium } = require('playwright-core');

const EXEC = '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell';
const UI = process.env.UI_URL || 'https://ask-me-game-iota.vercel.app/';

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  const errors = [];
  const mk = async (name) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] ${m.text()}`));
    await page.goto(UI, { waitUntil: 'networkidle' });
    return { page, ctx, name };
  };

  const A = await mk('asker');
  const B = await mk('answerer');

  await A.page.fill('#name-input', 'DropA');
  await A.page.click('#create-btn');
  await A.page.waitForSelector('#screen-lobby:not(.hidden)');
  const code = (await A.page.textContent('#room-code-display')).trim();
  await B.page.fill('#name-input', 'DropB');
  await B.page.fill('#join-code', code);
  await B.page.click('#join-btn');
  await B.page.waitForSelector('#screen-lobby:not(.hidden)');
  await A.page.waitForTimeout(400);

  await A.page.click('#start-btn');
  await A.page.waitForSelector('#main-panel [data-cat]');
  await A.page.click('#main-panel [data-cat]');
  await B.page.waitForSelector('[data-action="like-question"]');
  await B.page.click('[data-action="like-question"]');
  await B.page.waitForSelector('#answer-text');
  console.log('[setup] game in progress, phase =', await A.page.evaluate(() => App.state.phase));

  // ---- kill B's network mid-answer ----
  await B.ctx.setOffline(true);
  await A.page.waitForTimeout(600);
  console.log('[offline] A sees B as:', await A.page.evaluate(() =>
    JSON.stringify(App.state.players.map((p) => p.name + ':' + p.connected))));
  console.log('[offline] B banner visible:', await B.page.isVisible('#net-status'));

  // A keeps playing solo-ish: nothing works until B is back
  await B.ctx.setOffline(false);
  await A.page.waitForTimeout(1500);
  console.log('[back]   A sees B as:', await A.page.evaluate(() =>
    JSON.stringify(App.state.players.map((p) => p.name + ':' + p.connected))));

  // B's page should auto-rejoin (new socket id) and resume
  const rejoined = await B.page.evaluate(() => App.state && App.state.players.length === 2);
  console.log('[back]   B page recovered both players:', rejoined);
  await B.page.waitForTimeout(500);
  console.log('[back]   B phase:', await B.page.evaluate(() => App.state.phase));

  // finish the round with buttons on the recovered page
  await B.page.fill('#answer-text', 'Recovered answer.');
  const submitVisible = await B.page.isVisible('[data-action="submit-answer"]');
  await B.page.click('[data-action="submit-answer"]');
  console.log('[finish] B submit-answer button worked:', submitVisible);
  await A.page.waitForTimeout(800);

  const rateBtn = !!(await A.page.$('[data-action="like-answer"]'));
  console.log('[finish] A got like/dislike buttons after reconnect:', rateBtn);
  if (rateBtn) await A.page.click('[data-action="like-answer"]');
  await A.page.waitForTimeout(600);
  console.log('[result] phase after rating:', await A.page.evaluate(() => App.state.phase));

  console.log('errors:', errors.length ? errors.join(' | ') : '(none)');
  await browser.close();
  process.exit(rateBtn && errors.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('CRASH', e.message);
  process.exit(1);
});
