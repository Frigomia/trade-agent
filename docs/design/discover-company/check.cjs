// Usage: node check.cjs <installed playwright or playwright-core module directory>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { chromium } = require(path.resolve(process.argv[2]));

async function check() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(__dirname, 'overview.html')).href);
    const states = await page.locator('#state option').evaluateAll(options => options.map(o => o.value));
    for (const theme of ['light', 'dark']) {
      await page.selectOption('#theme', theme);
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        for (const state of states) {
          await page.selectOption('#state', state);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
            `${theme}/${width}/${state} overflows`);
          assert.match(await page.locator('#allowance').textContent(), /used \u00b7 \d+ remaining/);
          assert.equal(await page.locator('#report').isVisible(), state === 'report');
          assert.equal(await page.locator('#account').isVisible(), state === 'key');
          const saved = ['report', 'no-opportunity'].includes(state);
          assert.equal(await page.locator('#analyze').isVisible(), !saved);
          assert.equal(await page.locator('#allowance').isVisible(), !saved);
          assert.equal(await page.locator('#analyze').isDisabled(), ['running', 'excluded', 'key', 'quota'].includes(state));
          assert.equal(await page.locator('svg').isVisible(), state !== 'missing');
          if (state === 'failed') assert.match(await page.locator('#message').textContent(), /timed out.*refunded/);
          if (state === 'excluded') assert.match(await page.locator('#message').textContent(), /No research ran/);
          if (state === 'no-opportunity') assert.equal(await page.locator('#status').textContent(), 'AI analyzed');
        }
        await page.selectOption('#state', 'ready');
        await page.locator('h1').evaluate(e => { e.textContent = 'HaldenInternationalInfrastructureSystemsWithoutSpaces'; });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Long name overflows');
        await page.locator('h1').evaluate(e => { e.textContent = 'Halden Systems'; });
        await page.locator('#state').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.matches('main > a')), true);
        assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid');
        await page.locator('#analyze').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#state').inputValue(), 'running');
        await page.selectOption('#state', 'ready');
        await page.locator('#analyze').blur();
        fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
        await page.screenshot({ path: path.join(__dirname, 'shots', `ready-${theme}-${width}.png`), fullPage: true });
      }
    }
    const links = await page.locator('a').evaluateAll(nodes => nodes.map(a => a.href));
    for (const link of links) assert.ok(fs.existsSync(fileURLToPath(link)), `Missing local link: ${link}`);
    assert.deepEqual(errors, []);
    process.stdout.write(`Passed ${states.length * 6} state/theme/viewport cases, long names, keyboard actions and links; saved six screenshots.\n`);
  } finally {
    await browser.close();
  }
}
check().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
