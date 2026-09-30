// Print an HTML file to PDF with headless Chromium (Playwright).
// Usage: node render.js in.html out.pdf
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const [src, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(src), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
