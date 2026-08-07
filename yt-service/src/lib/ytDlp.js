const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileP = promisify(execFile);

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const TIMEOUT = parseInt(process.env.DOWNLOAD_TIMEOUT_MS || '900000', 10);
const COOKIES = process.env.COOKIES_FILE || '';

// ── URL validation ──────────────────────────────────────────────────
const YT_REGEX = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;

function parseVideoId(url) {
  const m = url.match(YT_REGEX);
  return m ? m[1] : null;
}

function isPlaylistOnly(url) {
  // playlist without video (list=PL... & no v=)
  return /[?&]list=PL/i.test(url) && !/[?&]v=/i.test(url);
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
    '-o', outPath,
  ];
  if (COOKIES) args.push('--cookies', COOKIES);
  args.push(url);

  await execFileP(YTDLP, args, {
    timeout: TIMEOUT,
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

module.exports = { parseVideoId, isPlaylistOnly, getMetadata, downloadAudio, getVersion };
