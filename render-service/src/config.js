import os from 'node:os';
import path from 'node:path';

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: int(process.env.PORT, 3000),

  // Token bersama yang dipakai n8n (Authorization: Bearer <token>).
  // Kalau kosong, service menolak start supaya tidak pernah terbuka tanpa auth.
  serviceToken: process.env.SERVICE_TOKEN ?? '',

  // Base URL publik service ini — dipakai untuk menyusun URL part audio
  // yang dikembalikan ke n8n. Contoh: https://notulensi-render.example.com
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, ''),

  render: {
    defaultWidth: int(process.env.RENDER_WIDTH, 1600),
    defaultScale: int(process.env.RENDER_SCALE, 2),
    minHeight: int(process.env.RENDER_MIN_HEIGHT, 500),
    maxHeight: int(process.env.RENDER_MAX_HEIGHT, 4000),
    timeoutMs: int(process.env.RENDER_TIMEOUT_MS, 45_000),
  },

  audio: {
    // Batas ukuran per file yang diterima Whisper API (Groq/OpenAI = 25MB).
    // Disisakan margin supaya overhead multipart tidak melewati batas.
    maxPartBytes: int(process.env.MAX_PART_BYTES, 24 * 1024 * 1024),
    // Batas ukuran upload yang diterima endpoint /audio/prepare.
    maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 512 * 1024 * 1024),
    // Bitrate target saat audio perlu dikompres (opus 16 kbps mono @16kHz
    // cukup untuk speech dan memuat ~3 jam audio dalam 24MB).
    opusBitrateKbps: int(process.env.OPUS_BITRATE_KBPS, 16),
    // Umur simpan part audio sebelum dihapus otomatis.
    ttlMs: int(process.env.AUDIO_TTL_MS, 30 * 60 * 1000),
    workDir: process.env.AUDIO_WORK_DIR ?? path.join(os.tmpdir(), 'notulensi-audio'),
    ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
    ffmpegTimeoutMs: int(process.env.FFMPEG_TIMEOUT_MS, 10 * 60 * 1000),
  },
};

export function assertConfig() {
  if (!config.serviceToken) {
    throw new Error(
      'SERVICE_TOKEN wajib diisi. Set env SERVICE_TOKEN dengan token acak yang sama seperti di credential n8n "Render Service".',
    );
  }
  if (config.serviceToken.length < 16) {
    throw new Error('SERVICE_TOKEN terlalu pendek — pakai minimal 16 karakter acak.');
  }
}
