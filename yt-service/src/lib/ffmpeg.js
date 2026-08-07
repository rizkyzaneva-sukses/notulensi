const { execFile } = require('child_process');
const { promisify } = require('util');
const { existsSync } = require('fs');

const execFileP = promisify(execFile);

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

// ── Transcode to Opus 16kHz mono ────────────────────────────────────
// Identik dengan transcodeToOpus() di render-service/src/audio.js
async function transcodeToOpus(inputPath, outputPath) {
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const args = [
    '-i', inputPath,
    '-vn',
    '-map', '0:a:0',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'libopus',
    '-b:a', '24k',
    '-application', 'voip',
    '-y',
    outputPath,
  ];

  await execFileP(FFMPEG, args, {
    timeout: 120000,
    windowsHide: true,
  });

  if (!existsSync(outputPath)) {
    throw new Error('ffmpeg produced no output file');
  }
}

// ── Probe audio ─────────────────────────────────────────────────────
async function probeAudio(filePath) {
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  const { stdout } = await execFileP(FFPROBE, args, {
    timeout: 10000,
    windowsHide: true,
  });

  return JSON.parse(stdout);
}

// ── Check ffmpeg available ──────────────────────────────────────────
async function checkFfmpeg() {
  try {
    await execFileP(FFMPEG, ['-version'], { timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

module.exports = { transcodeToOpus, probeAudio, checkFfmpeg };
