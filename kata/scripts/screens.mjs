// Captures the install-sheet screenshots referenced by the web app manifest.
// Uses a Kata Sim instrument, so every price shown is labelled as simulated.
//   node scripts/screens.mjs http://localhost:5173
import { chromium, devices } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = new URL('../public/screens/', import.meta.url).pathname;

async function shoot(ctxOpts, file, mobile) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...ctxOpts, locale: 'en-US' });
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('kata.ui.v1'))
      localStorage.setItem('kata.ui.v1', JSON.stringify({ state: { theme: 'dark', symbol: 'ALPHA.SIM', interval: '5m', indicators: ['volume', 'ema20', 'ema50'] }, version: 0 }));
  });
  const p = await ctx.newPage();
  await p.route(/binance\.(com|vision|us)/, (r) => r.abort());
  await p.goto(base);
  await p.getByTestId('open-account').click();
  await p.waitForTimeout(1500);
  if (mobile) await p.getByTestId('m-buy').click();
  await p.getByTestId('tk-size').fill('12');
  await p.locator('#tk-sl-on').click();
  await p.locator('#tk-tp-on').click();
  await p.getByTestId('tk-submit').click();
  await p.waitForTimeout(5000);
  await p.screenshot({ path: out + file });
  await b.close();
}

await shoot({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 }, 'wide-trade.png', false);
await shoot({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }, 'narrow-trade.png', true);
console.log('screens ok');
