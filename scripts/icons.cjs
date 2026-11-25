const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
(async()=>{const svg = readFileSync('public/icons/icon.svg', 'utf8').replace('rx="14"', 'rx="0"');
const b = await chromium.launch();
for (const [n, s] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const p = await b.newPage({ viewport: { width: s, height: s } });
  await p.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
  await p.screenshot({ path: `public/icons/${n}`, omitBackground: false });
}
await b.close();
})();