const { Router } = require('express');
const { v4: uuid } = require('uuid');
const { mkdir, writeFile, readFile, stat } = require('fs/promises');
const { join, resolve } = require('path');

const { parseVideoId, isUnsupportedTarget, getMetadata, downloadAudio } = require('../lib/ytDlp');
const { transcodeToOpus } = require('../lib/ffmpeg');
const { rm } = require('fs/promises');

const router = Router();
const WORK_DIR = resolve(process.env.WORK_DIR || './work');
const MAX_DURATION = parseInt(process.env.MAX_DURATION_SEC || '14400', 10);
const BASE_URL = process.env.PUBLIC_BASE_URL || `http://${process.env.BIND_ADDRESS}:${process.env.PORT}`;

// Kegagalan setelah folder kerja dibuat harus ikut membersihkannya. Tanpa ini
// sisa run yang gagal menumpuk — dan janitor pun melewatinya karena
// manifest.json belum sempat ditulis.
async function discard(dirPath) {
  if (!dirPath) return;
  try { await rm(dirPath, { recursive: true, force: true }); } catch {}
}

// Disk penuh punya tindak lanjut yang beda dari "gagal download", jadi
// dibedakan sejak di sini.
function isDiskFull(err) {
  return err?.code === 'ENOSPC' || /ENOSPC|no space left/i.test(err?.message || '');
}

// ── POST /youtube/prepare ───────────────────────────────────────────
router.post('/prepare', async (req, res) => {
  const { url } = req.body || {};

  // 1. Validasi URL dasar
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_URL', message: 'URL tidak diberikan' });
  }

  const videoId = parseVideoId(url.trim());
  if (!videoId) {
    // URL YouTube yang sah tapi bukan satu video — pesannya harus beda.
    if (isUnsupportedTarget(url)) {
      return res.status(400).json({ ok: false, code: 'UNSUPPORTED_URL', message: 'Playlist/channel tidak didukung, kirim link satu video' });
    }
    return res.status(400).json({ ok: false, code: 'INVALID_URL', message: 'Bukan URL YouTube yang valid' });
  }

  // 2. Bersihkan URL (buang parameter list=)
  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Dideklarasikan di luar try supaya catch terluar juga bisa membersihkannya.
  let dirPath = null;

  try {
    // 3. Ambil metadata
    let meta;
    try {
      meta = await getMetadata(cleanUrl);
    } catch (err) {
      const msg = err.stderr || err.message || '';
      if (msg.includes('Sign in') || msg.includes('bot')) {
        return res.status(502).json({ ok: false, code: 'BOT_CHECK', message: 'YouTube meminta verifikasi bot. Coba gunakan cookies.' });
      }
      if (msg.includes('Video unavailable') || msg.includes('Private video')) {
        return res.status(404).json({ ok: false, code: 'VIDEO_UNAVAILABLE', message: 'Video tidak tersedia (privat/dihapus/dibatasi wilayah)' });
      }
      return res.status(502).json({ ok: false, code: 'DOWNLOAD_FAILED', message: `Gagal mengambil metadata: ${msg.slice(0, 200)}` });
    }

    // 4. Validasi metadata
    if (meta.is_live) {
      return res.status(400).json({ ok: false, code: 'LIVE_NOT_SUPPORTED', message: 'Live stream tidak didukung' });
    }

    const duration = meta.duration || 0;
    if (duration === 0) {
      // Bukan "terlalu panjang" — kalau dikirim sebagai TOO_LONG, pesan di
      // Telegram akan bilang videonya kepanjangan padahal durasinya cuma
      // tidak terbaca, dan Rizky tidak tahu harus berbuat apa.
      return res.status(400).json({ ok: false, code: 'DURATION_UNKNOWN', message: 'Durasi video tidak terbaca, kemungkinan premiere atau siaran langsung' });
    }
    if (duration > MAX_DURATION) {
      return res.status(400).json({ ok: false, code: 'TOO_LONG', message: `Video terlalu panjang (${Math.round(duration / 3600)} jam, maks ${MAX_DURATION / 3600} jam)` });
    }

    // 5. Sanitasi judul (anti prompt injection)
    const title = (meta.title || 'Untitled').replace(/[\r\n]+/g, ' ').slice(0, 200);
    const channel = (meta.channel || meta.uploader || 'Unknown').replace(/[\r\n]+/g, ' ').slice(0, 100);

    // 6. Siapkan folder kerja
    const id = uuid();
    dirPath = join(WORK_DIR, id);
    await mkdir(dirPath, { recursive: true });

    const rawPath = join(dirPath, 'raw_audio');
    const oggPath = join(dirPath, 'audio.ogg');

    // 7. Download bestaudio
    try {
      await downloadAudio(cleanUrl, rawPath);
    } catch (err) {
      const msg = err.stderr || err.message || '';
      await discard(dirPath);
      if (isDiskFull(err)) {
        return res.status(507).json({ ok: false, code: 'STORAGE_FULL', message: 'Ruang disk di PC habis' });
      }
      if (msg.includes('Sign in') || msg.includes('bot')) {
        return res.status(502).json({ ok: false, code: 'BOT_CHECK', message: 'YouTube meminta verifikasi bot saat download. Coba gunakan cookies.' });
      }
      return res.status(502).json({ ok: false, code: 'DOWNLOAD_FAILED', message: `Gagal download audio: ${msg.slice(0, 200)}` });
    }

    // 8. Cek file hasil download
    let rawStat;
    try {
      rawStat = await stat(rawPath);
    } catch {
      // yt-dlp kadang menambahkan ekstensi, cari file di folder
      const { readdir } = require('fs/promises');
      const files = await readdir(dirPath);
      const audioFile = files.find(f => f.startsWith('raw_audio'));
      if (audioFile) {
        const renamed = join(dirPath, audioFile);
        const { rename } = require('fs/promises');
        await rename(renamed, rawPath);
        rawStat = await stat(rawPath);
      }
    }

    if (!rawStat || rawStat.size === 0) {
      await discard(dirPath);
      return res.status(502).json({ ok: false, code: 'DOWNLOAD_FAILED', message: 'File audio kosong setelah download' });
    }

    // 9. Transcode ke Opus 16kHz mono
    try {
      await transcodeToOpus(rawPath, oggPath);
    } catch (err) {
      await discard(dirPath);
      if (isDiskFull(err)) {
        return res.status(507).json({ ok: false, code: 'STORAGE_FULL', message: 'Ruang disk di PC habis' });
      }
      return res.status(500).json({ ok: false, code: 'TRANSCODE_FAILED', message: `Gagal mengkonversi audio: ${(err.message || '').slice(0, 200)}` });
    }

    // 10. Cek hasil transcode
    const oggStat = await stat(oggPath);
    if (oggStat.size === 0) {
      await discard(dirPath);
      return res.status(500).json({ ok: false, code: 'TRANSCODE_FAILED', message: 'File hasil konversi kosong' });
    }

    // 11. Simpan manifest
    const manifest = {
      id,
      videoId,
      title,
      channel,
      durationSec: duration,
      sizeBytes: oggStat.size,
      createdAt: Date.now(),
    };
    await writeFile(join(dirPath, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 12. Hapus file mentah (hemat disk)
    const { unlink: unlinkFile } = require('fs/promises');
    try { await unlinkFile(rawPath); } catch {}

    // 13. Balas
    return res.json({
      ok: true,
      id,
      videoId,
      title,
      channel,
      durationSec: duration,
      sizeBytes: oggStat.size,
      audioUrl: `${BASE_URL}/youtube/${id}/audio`,
    });

  } catch (err) {
    console.error('[prepare] unexpected error:', err);
    await discard(dirPath);
    if (isDiskFull(err)) {
      return res.status(507).json({ ok: false, code: 'STORAGE_FULL', message: 'Ruang disk di PC habis' });
    }
    return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Kesalahan tak terduga' });
  }
});

// ── GET /youtube/:id/audio ──────────────────────────────────────────
router.get('/:id/audio', async (req, res) => {
  const { id } = req.params;

  // Validasi UUID format
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ ok: false, code: 'INVALID_URL', message: 'ID tidak valid' });
  }

  const oggPath = join(WORK_DIR, id, 'audio.ogg');

  try {
    await stat(oggPath);
  } catch {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'File audio tidak ditemukan (mungkin sudah kedaluwarsa)' });
  }

  res.setHeader('Content-Type', 'audio/ogg');
  res.setHeader('Content-Disposition', `attachment; filename="${id}.ogg"`);
  res.sendFile(oggPath);
});

module.exports = router;
