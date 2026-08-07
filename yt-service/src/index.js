require('dotenv').config();
const express = require('express');
const { resolve } = require('path');
const fs = require('fs');

const authMiddleware = require('./middleware/auth');
const youtubeRouter = require('./routes/youtube');
const { startJanitor } = require('./lib/janitor');

const app = express();

// ── Config ──────────────────────────────────────────────────────────
const BIND = process.env.BIND_ADDRESS;
const PORT = parseInt(process.env.PORT || '8080', 10);

if (!BIND) {
  console.error('FATAL: BIND_ADDRESS wajib diisi di .env');
  process.exit(1);
}

if (!process.env.SERVICE_TOKEN) {
  console.error('FATAL: SERVICE_TOKEN wajib diisi di .env');
  process.exit(1);
}

// ── Middleware ───────────────────────────────────────────────────────
app.use(express.json());

// ── Health (tanpa auth) ─────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const { getVersion } = require('./lib/ytDlp');
  const { checkFfmpeg } = require('./lib/ffmpeg');

  const [ytVer, ffOk] = await Promise.all([getVersion(), checkFfmpeg()]);

  res.json({
    ok: true,
    service: 'yt-service',
    ytDlp: ytVer || 'not found',
    ffmpeg: ffOk ? 'available' : 'not found',
    uptime: Math.floor(process.uptime()),
  });
});

// ── YouTube routes (pakai auth) ─────────────────────────────────────
app.use('/youtube', authMiddleware, youtubeRouter);

// ── 404 ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan' });
});

// ── Error handler ───────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Kesalahan server internal' });
});

// ── Start ───────────────────────────────────────────────────────────
const workDir = resolve(process.env.WORK_DIR || './work');
if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

app.listen(PORT, BIND, () => {
  console.log(`[yt-service] listening on ${BIND}:${PORT}`);
  console.log(`[yt-service] work dir: ${workDir}`);
  startJanitor(workDir);
});
