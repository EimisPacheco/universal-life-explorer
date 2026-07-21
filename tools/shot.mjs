// Headless screenshot harness for the anatomy viewer.
// Usage: node tools/shot.mjs <outDir> [baseURL]
// Drives the page through window.__ANATOMY_DEBUG__ to capture reproducible
// organ views (full body + close-ups) for visual auditing.

import puppeteer from '/tmp/anatomy-shot/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = resolve(process.argv[2] || 'tools/shots');
const baseURL = process.argv[3] || 'http://127.0.0.1:8099/index.html';
mkdirSync(outDir, { recursive: true });

const W = 1400, H = 1600;

// [name, targetY, distance, azimuth(rad), elevation(rad)]
const VIEWS = [
  ['01-front-full',      5.58, 19.2, 0,            0],
  ['02-thorax',          8.00,  7.5, 0,            0.05],
  ['03-heart-lungs',     8.05,  5.2, 0,            0.05],
  ['04-abdomen',         6.20,  7.0, 0,            0.05],
  ['05-liver-stomach',   6.55,  5.0, 0.35,         0.05],
  ['06-lower-abdomen',   5.35,  6.0, 0,            0.05],
  ['07-three-quarter',   6.00, 13.0, 0.7,          0.05],
  ['08-side',            6.00, 13.0, Math.PI / 2,  0.02],
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    `--window-size=${W},${H}`,
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(baseURL, { waitUntil: 'networkidle2', timeout: 60000 });

  // Wait for the rig + organs to be built.
  await page.waitForFunction(() => {
    const d = window.__ANATOMY_DEBUG__;
    return d && d.organs && Object.keys(d.organs).length > 8 && d.camera;
  }, { timeout: 60000 });

  // Let materials/shadows settle.
  await sleep(2500);

  for (const [name, ty, dist, az, el] of VIEWS) {
    await page.evaluate((ty, dist, az, el) => {
      window.__ANATOMY_DEBUG__.frameView(ty, dist, az, el);
    }, ty, dist, az, el);
    await sleep(900);
    const path = `${outDir}/${name}.png`;
    await page.screenshot({ path });
    console.log('shot', path);
  }

  if (errors.length) {
    console.log('PAGE ERRORS:\n' + errors.slice(0, 20).join('\n'));
  } else {
    console.log('no page errors');
  }
} finally {
  await browser.close();
}
