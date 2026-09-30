// Render SVG files to PNG (2x) with headless Chromium, using the note fonts.
// Usage: node svg2png.js <out_dir> a.svg b.svg ...
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const [outDir, ...files] = process.argv.slice(2);
  const fonts = 'file://' + path.join(__dirname, 'theme', 'fonts.css');
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  for (const f of files) {
    const svg = fs.readFileSync(f, 'utf8').replace(/<\?xml.*?\?>/, '');
    await page.setContent(`<html><head><link rel="stylesheet" href="${fonts}"><style>body{margin:0;background:#fff}svg{display:block;width:900px;height:auto}</style></head><body>${svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await (await page.$('svg')).screenshot({ path: path.join(outDir, path.basename(f).replace(/\.svg$/, '.png')) });
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
