// Smoke test lokal: render markdown contoh jadi PNG tanpa menyalakan server.
//   node scripts/smoke.mjs [output.png]
import fs from 'node:fs/promises';
import path from 'node:path';

process.env.SERVICE_TOKEN ||= 'smoke-test-token-1234567890';

const { renderMindmap, shutdownBrowser } = await import('../src/render.js');
const { outlineToMarkdown } = await import('../src/outline.js');

const outline = [
  {
    title: 'Rapat Zaneva — Rencana Q3',
    children: [
      {
        title: 'Performa Iklan',
        children: [{ title: 'ROAS turun ke 2,1' }, { title: 'HPP naik 8% karena bahan' }],
      },
      {
        title: 'Produk Baru',
        children: [{ title: 'Muslimah Swimwear seri Oberbe' }, { title: 'Sampling minggu depan' }],
      },
      {
        title: 'Action Item',
        children: [{ title: 'Audit creative Be.Syari' }, { title: 'Negosiasi ulang supplier Elyasr' }],
      },
    ],
  },
];

const markdown = outlineToMarkdown(outline);
console.log('--- markdown ---\n' + markdown + '\n----------------');

const outPath = path.resolve(process.argv[2] ?? 'out/sample.png');
await fs.mkdir(path.dirname(outPath), { recursive: true });

const started = Date.now();
const { png, width, height } = await renderMindmap(markdown);
await fs.writeFile(outPath, png);
await shutdownBrowser();

console.log(`OK — ${outPath} (${width}x${height}, ${png.length} bytes, ${Date.now() - started}ms)`);
