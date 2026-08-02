import puppeteer from 'puppeteer';
import { Transformer } from 'markmap-lib';
import { config } from './config.js';
import { browserAssets } from './assets.js';

const transformer = new Transformer();

let browserPromise = null;

async function getBrowser() {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    if (browser?.connected) return browser;
    browserPromise = null;
  }
  browserPromise = puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
      '--force-color-profile=srgb',
    ],
  });
  return browserPromise;
}

export async function shutdownBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close().catch(() => {});
}

// Batasi jumlah tab yang render bersamaan supaya VPS kecil tidak kehabisan RAM.
let active = 0;
const waiting = [];
const MAX_CONCURRENT = 2;

async function withSlot(fn) {
  if (active >= MAX_CONCURRENT) {
    await new Promise((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

const THEMES = {
  light: { bg: '#ffffff', fg: '#1b1f24', codeBg: '#f0f0f0' },
  dark: { bg: '#0f1115', fg: '#e8eaed', codeBg: '#22262d' },
};

function buildHtml(root, { theme }) {
  const assets = browserAssets();
  const palette = THEMES[theme] ?? THEMES.light;
  const data = JSON.stringify(root).replace(/</g, '\\u003c');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: ${palette.bg}; }
  svg#mindmap {
    display: block;
    width: 100vw;
    height: 100vh;
    --markmap-font: 400 16px/1.4 "Noto Sans", "Liberation Sans", system-ui, sans-serif;
    --markmap-text-color: ${palette.fg};
    --markmap-code-bg: ${palette.codeBg};
    --markmap-code-color: ${palette.fg};
  }
  svg#mindmap .markmap-foreign { color: ${palette.fg}; }
  svg#mindmap .markmap-foreign div { white-space: normal; }
  svg#mindmap circle { cursor: default; }
</style>
<script>${assets.d3}</script>
<script>${assets.markmapView}</script>
</head>
<body>
<svg id="mindmap"></svg>
<script>
  window.__ready = false;
  window.__error = null;
  var mm = null;
  var rootData = JSON.parse(${JSON.stringify(data)});

  // markmap mengukur ukuran node secara asinkron, jadi setData/fit wajib di-await
  // sebelum getBBox() — kalau tidak, bbox-nya masih 0x0.
  window.__init = async function () {
    try {
      var svg = document.querySelector('#mindmap');
      var jsonOptions = {
        colorFreezeLevel: 2,
        maxWidth: 340,
        initialExpandLevel: -1,
        spacingVertical: 10,
        spacingHorizontal: 90,
        duration: 0,
      };
      var derived =
        typeof markmap.deriveOptions === 'function' ? markmap.deriveOptions(jsonOptions) : jsonOptions;
      var options = Object.assign({}, derived, { duration: 0, autoFit: false, fitRatio: 0.92 });
      mm = new markmap.Markmap(svg, options);
      await mm.setData(rootData);
      await mm.fit();
      var box = svg.querySelector('g').getBBox();
      window.__ready = true;
      return { width: box.width, height: box.height };
    } catch (err) {
      window.__error = String((err && err.stack) || err);
      throw err;
    }
  };

  window.__refit = function () {
    return mm.fit();
  };
</script>
</body>
</html>`;
}

/**
 * Render markdown jadi PNG mind map.
 * @returns {Promise<{ png: Buffer, width: number, height: number }>}
 */
export async function renderMindmap(markdown, opts = {}) {
  const source = String(markdown ?? '').trim();
  if (!source) throw Object.assign(new Error('markdown kosong'), { status: 400 });

  const width = Math.min(Math.max(Number(opts.width) || config.render.defaultWidth, 600), 3200);
  const scale = Math.min(Math.max(Number(opts.scale) || config.render.defaultScale, 1), 3);
  const theme = opts.theme === 'dark' ? 'dark' : 'light';

  const { root } = transformer.transform(source);
  const html = buildHtml(root, { theme });

  return withSlot(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      page.setDefaultTimeout(config.render.timeoutMs);
      await page.setViewport({ width, height: 1000, deviceScaleFactor: scale });
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: config.render.timeoutMs });

      const natural = await page.evaluate(() => window.__init());
      if (!natural?.width || !natural?.height) {
        throw Object.assign(new Error('markmap tidak menghasilkan konten'), { status: 422 });
      }

      // Samakan aspect ratio kanvas dengan aspect ratio konten supaya tidak ada
      // area kosong besar dan teks tidak mengecil berlebihan.
      const height = Math.round(
        Math.min(
          Math.max((width * natural.height) / natural.width + 80, config.render.minHeight),
          config.render.maxHeight,
        ),
      );

      await page.setViewport({ width, height, deviceScaleFactor: scale });
      await page.evaluate(() => window.__refit());
      await new Promise((resolve) => setTimeout(resolve, 120));

      const png = await page.screenshot({ type: 'png', captureBeyondViewport: false });
      return { png: Buffer.from(png), width, height };
    } finally {
      await page.close().catch(() => {});
    }
  });
}
