/* Two-browser reproduction of the "stuck at rating" bug against the live stack */
const { chromium } = require('playwright-core');

const EXEC = '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell';
const UI = 'https://ask-me-game-iota.vercel.app/';

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  const errors = [];

  const mk = async (name) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.stack || e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] console: ${m.text()}`));
    await page.goto(UI, { waitUntil: 'networkidle' });
    return page;
  };

  const A = await mk('asker');
  const B = await mk('answerer');

  await A.fill('#name-input', 'Asker');
  await A.click('#create-btn');
  await A.waitForSelector('#screen-lobby:not(.hidden)');
  const code = await A.textContent('#room-code-display');
  console.log('room code:', code);

  await B.fill('#name-input', 'Answerer');
  await B.fill('#join-code', code.trim());
  await B.click('#join-btn');
  await B.waitForSelector('#screen-lobby:not(.hidden)');
  await A.waitForFunction(() => document.querySelectorAll('#lobby-players .player').length === 2);

  await A.click('#start-btn');
  await A.waitForSelector('#screen-game:not(.hidden)');

  // asker picks a category
  await A.waitForSelector('#main-panel [data-cat]', { timeout: 5000 });
  await A.click('#main-panel [data-cat]');

  // answerer reacts to the question
  await B.waitForSelector('[data-action="like-question"]', { timeout: 5000 });
  await B.click('[data-action="like-question"]');

  // answerer types the answer
  await B.waitForSelector('#answer-text', { timeout: 5000 });
  await B.fill('#answer-text', 'This is my answer.');
  await B.click('[data-action="submit-answer"]');

  // ASKER should now see like/dislike answer buttons
  console.log('--- first-round asker screen check (rate buttons) ---');
  const hasRateBtns = await A.$('[data-action="like-answer"]');
  console.log('asker has like-answer button:', !!hasRateBtns);

  if (hasRateBtns) {
    await A.click('[data-action="like-answer"]');
    await A.waitForTimeout(1200);
    const phase = await A.evaluate(() => App.state && App.state.phase);
    console.log('after clicking like-answer, phase:', phase);
  }

  console.log('--- errors ---');
  console.log(errors.length ? errors.join('\n---\n') : '(none)');

  // play 3 full rounds, alternating who asks each round
  let asker = A;
  let answerer = B;
  for (let round = 1; round <= 3; round++) {
    console.log(`\n=== ROUND ${round} (asker = ${asker === A ? 'A/Asker' : 'B/Answerer'}) ===`);
    for (const step of ['ask', 'react', 'answer', 'rate']) {
      const who = step === 'ask' || step === 'rate' ? asker : answerer;
      const sel =
        step === 'ask'
          ? '#main-panel [data-cat]'
          : step === 'react'
            ? '[data-action="like-question"], [data-action="reject-question"]'
            : step === 'answer'
              ? '[data-action="submit-answer"]'
              : '[data-action="like-answer"], [data-action="dislike-answer"]';
      try {
        await who.waitForSelector(sel, { timeout: 8000 });
        if (step === 'answer') await who.fill('#answer-text', `Round ${round} answer`);
        await who.click(sel);
        console.log(`  ${step}: OK`);
      } catch (e) {
        console.log(`  ${step}: FAILED -> ${e.message.split('\n')[0]}`);
        console.log('  panel:', (await who.innerHTML('#main-panel')).slice(0, 200).replace(/\s+/g, ' '));
      }
      await who.waitForTimeout(700);
    }
    const phase = await A.evaluate(() => App.state && App.state.phase);
    console.log(`  round ${round} done, phase:`, phase);
    [asker, answerer] = [answerer, asker];
  }

  console.log('\n--- errors ---');
  console.log(errors.length ? errors.join('\n---\n') : '(none)');

  await browser.close();
})().catch((e) => {
  console.error('REPRO CRASH', e);
  process.exit(1);
});
