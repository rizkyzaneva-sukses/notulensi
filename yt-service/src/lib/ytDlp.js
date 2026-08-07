const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileP = promisify(execFile);

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const TIMEOUT = parseInt(process.env.DOWNLOAD_TIMEOUT_MS || '900000', 10);
const COOKIES = process.env.COOKIES_FILE || '';

// ── URL validation ──────────────────────────────────────────────────
// Diurai lewat URL API, bukan satu regex besar. Regex sebelumnya mensyaratkan
// "v=" persis setelah "?", jadi link sah seperti youtube.com/watch?app=desktop&v=ID
// ditolak sebagai URL tidak valid — dan itu bentuk yang sering keluar dari
// tombol share ponsel.
const YT_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtu.be', 'www.youtu.be',
]);
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
// Jalur yang menaruh id video di segmen kedua, bukan di query.
const PATH_PREFIXES = new Set(['shorts', 'live', 'embed', 'v']);

function toUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

function parseVideoId(input) {
  const u = toUrl(input);
  if (!u || !YT_HOSTS.has(u.hostname.toLowerCase())) return null;

  const segments = u.pathname.split('/').filter(Boolean);

  // youtu.be/<id>
  if (u.hostname.toLowerCase().endsWith('youtu.be')) {
    return VIDEO_ID.test(segments[0] || '') ? segments[0] : null;
  }

  // youtube.com/watch?...&v=<id> — posisi parameter tidak lagi penting
  const v = u.searchParams.get('v');
  if (v && VIDEO_ID.test(v)) return v;

  // youtube.com/{shorts,live,embed,v}/<id>
  if (segments.length >= 2 && PATH_PREFIXES.has(segments[0].toLowerCase())) {
    return VIDEO_ID.test(segments[1]) ? segments[1] : null;
  }

  return null;
}

/**
 * URL YouTube yang sah tapi bukan satu video: playlist, channel, handle.
 * Dipakai untuk membedakan "tidak didukung" dari "bukan URL YouTube", supaya
 * pesan yang sampai ke Telegram menjelaskan apa yang harus dilakukan.
 */
function isUnsupportedTarget(input) {
  const u = toUrl(input);
  if (!u || !YT_HOSTS.has(u.hostname.toLowerCase())) return false;

  const segments = u.pathname.split('/').filter(Boolean);
  const first = (segments[0] || '').toLowerCase();

  // Playlist apa pun awalannya (PL, RD, UU, LL, OL, …), bukan cuma PL.
  if (u.searchParams.has('list') && !u.searchParams.has('v')) return true;
  if (first === 'playlist') return true;
  if (first.startsWith('@')) return true;
  if (['channel', 'c', 'user', 'results', 'feed'].includes(first)) return true;

  return false;
}

// ── Metadata fetch ──────────────────────────────────────────────────
async function getMetadata(url) {
  const args = ['-J', '--no-playlist', '--no-warnings'];
  if (COOKIES) args.push('--cookies', COOKIES);
  args.push(url);

  const { stdout } = await execFileP(YTDLP, args, {
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });

  return JSON.parse(stdout);
}

// ── Download bestaudio ──────────────────────────────────────────────
async function downloadAudio(url, outPath) {
  const args = [
    '-f', 'bestaudio',
    '--no-playlist',
    '--no-warnings',
    // Progress ditulis terus-menerus ke stdout. Dengan maxBuffer default 1 MB,
    // unduhan panjang bisa mati sendiri karena ENOBUFS — bukan karena YouTube.
    '--no-progress',
    '-o', outPath,
  ];
  if (COOKIES) args.push('--cookies', COOKIES);
  args.push(url);

  await execFileP(YTDLP, args, {
    timeout: TIMEOUT,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
}

// ── Version ─────────────────────────────────────────────────────────
async function getVersion() {
  try {
    const { stdout } = await execFileP(YTDLP, ['--version'], {
      timeout: 5000,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

module.exports = { parseVideoId, isUnsupportedTarget, getMetadata, downloadAudio, getVersion };
