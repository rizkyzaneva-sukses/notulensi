import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, assertConfig } from './config.js';
import { requireToken } from './auth.js';
import { renderMindmap, shutdownBrowser } from './render.js';
import { prepareAudio, getPart, dropBundle, startJanitor } from './audio.js';
import { outlineToMarkdown } from './outline.js';

assertConfig();

const uploadDir = path.join(config.audio.workDir, '_uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: config.audio.maxUploadBytes, files: 1 },
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '4mb' }));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'notulensi-render-service', uptimeSec: Math.round(process.uptime()) });
});

app.use(requireToken);

/**
 * POST /render
 * Body: { markdown?, outline?, title?, width?, scale?, theme? }
 * Response: image/png
 */
app.post('/render', async (req, res, next) => {
  try {
    const { markdown, outline, title, width, scale, theme } = req.body ?? {};
    const source =
      typeof markdown === 'string' && markdown.trim()
        ? markdown
        : outlineToMarkdown(outline, title);

    const result = await renderMindmap(source, { width, scale, theme });
    res
      .status(200)
      .set({
        'Content-Type': 'image/png',
        'Content-Length': String(result.png.length),
        'Content-Disposition': 'inline; filename="mindmap.png"',
        'X-Render-Width': String(result.width),
        'X-Render-Height': String(result.height),
      })
      .end(result.png);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /audio/prepare  (multipart/form-data, field "file")
 * Response: { id, totalParts, durationSec, compressed, parts: [{ index, url, sizeBytes }] }
 */
app.post('/audio/prepare', upload.single('file'), async (req, res, next) => {
  if (!req.file) {
    next(Object.assign(new Error('field "file" wajib diisi (multipart/form-data)'), { status: 400 }));
    return;
  }
  try {
    const result = await prepareAudio(req.file.path, req.file.originalname);
    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    await fsp.rm(req.file.path, { force: true }).catch(() => {});
  }
});

app.get('/audio/:id/:index', async (req, res, next) => {
  try {
    const { filePath, fileName } = await getPart(req.params.id, req.params.index);
    res.download(filePath, fileName, (err) => {
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    next(err);
  }
});

app.delete('/audio/:id', async (req, res, next) => {
  try {
    await dropBundle(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'not found' });
});

// eslint-disable-next-line no-unused-vars -- Express mengenali error handler dari 4 argumen
app.use((err, _req, res, _next) => {
  const status = err.status ?? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error('[render-service]', err);
  if (res.headersSent) return;
  res.status(status).json({ ok: false, error: err.message ?? 'internal error' });
});

startJanitor();

const server = app.listen(config.port, () => {
  console.log(`[render-service] listening on :${config.port}`);
  if (!config.publicBaseUrl) {
    console.warn('[render-service] PUBLIC_BASE_URL kosong — URL part audio akan berupa path relatif.');
  }
});
server.requestTimeout = 15 * 60 * 1000;
server.headersTimeout = 15 * 60 * 1000 + 5000;

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(async () => {
      await shutdownBrowser();
      process.exit(0);
    });
  });
}
