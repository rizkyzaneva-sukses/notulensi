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

// Kode keluar 2 = jangan dicoba ulang oleh pembungkus start-yt-service.cmd.
// Salah konfigurasi tidak akan membaik dengan diulang.
const EXIT_FATAL = 2;

if (!BIND) {
  console.error('FATAL: BIND_ADDRESS wajib diisi di .env');
  process.exit(EXIT_FATAL);
}

if (!process.env.SERVICE_TOKEN) {
  console.error('FATAL: SERVICE_TOKEN wajib diisi di .env');
  process.exit(EXIT_FATAL);
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

// Saat PC baru menyala, service bisa start sebelum Tailscale sempat memasang
// alamatnya. listen() ke IP yang belum ada gagal EADDRNOTAVAIL dan prosesnya
// mati — persis skenario auto-start. Jadi ditunggu dulu, bukan langsung menyerah.
const BIND_RETRY_MS = parseInt(process.env.BIND_RETRY_MS || '5000', 10);
const BIND_MAX_WAIT_MS = parseInt(process.env.BIND_MAX_WAIT_MS || '180000', 10);
const bootAt = Date.now();

function listen() {
  const server = app.listen(PORT, BIND, () => {
    console.log(`[yt-service] ${new Date().toISOString()} listening on ${BIND}:${PORT}`);
    console.log(`[yt-service] work dir: ${workDir}`);
    startJanitor(workDir);
  });

  server.on('error', (err) => {
    // Port sudah dipakai = instance lain hidup. Mengulang hanya akan
    // menghasilkan loop tanpa akhir, jadi berhenti dengan kode fatal.
    if (err.code === 'EADDRINUSE') {
      console.error(`[yt-service] ${BIND}:${PORT} sudah dipakai instance lain`);
      process.exit(EXIT_FATAL);
    }

    const waited = Date.now() - bootAt;
    if (err.code === 'EADDRNOTAVAIL' && waited < BIND_MAX_WAIT_MS) {
      console.warn(
        `[yt-service] ${BIND} belum tersedia (Tailscale belum siap?), ulangi dalam ${BIND_RETRY_MS / 1000}s`,
      );
      setTimeout(listen, BIND_RETRY_MS);
      return;
    }

    console.error(`[yt-service] gagal listen di ${BIND}:${PORT} — ${err.code || err.message}`);
    process.exit(1);
  });
}

listen();
