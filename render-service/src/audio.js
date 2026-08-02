import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const { audio } = config;

// Ekstensi yang diterima langsung oleh Whisper API (Groq & OpenAI).
const PASSTHROUGH_EXT = new Set([
  '.flac', '.m4a', '.mp3', '.mp4', '.mpeg', '.mpga', '.oga', '.ogg', '.wav', '.webm',
]);

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function run(bin, args, { timeoutMs = audio.ffmpegTimeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${bin} timeout setelah ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString().slice(0, 4000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        err.code === 'ENOENT'
          ? new Error(`"${bin}" tidak ditemukan di container. Pastikan ffmpeg terpasang.`)
          : err,
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exit ${code}: ${stderr.trim().slice(-800)}`));
    });
  });
}

async function probeDuration(filePath) {
  try {
    const { stdout } = await run(
      audio.ffprobePath,
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      { timeoutMs: 60_000 },
    );
    const seconds = Number.parseFloat(stdout.trim());
    return Number.isFinite(seconds) ? seconds : 0;
  } catch {
    return 0;
  }
}

async function transcodeToOpus(inputPath, outputPath) {
  await run(audio.ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', inputPath,
    '-vn',
    '-map', '0:a:0',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'libopus',
    '-b:a', `${audio.opusBitrateKbps}k`,
    '-application', 'voip',
    outputPath,
  ]);
}

async function segmentOpus(inputPath, dir, segmentSeconds) {
  await run(audio.ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', inputPath,
    '-f', 'segment',
    '-segment_time', String(segmentSeconds),
    '-reset_timestamps', '1',
    '-c', 'copy',
    path.join(dir, 'part-%03d.ogg'),
  ]);
  const files = (await fs.readdir(dir)).filter((f) => /^part-\d{3}\.ogg$/.test(f)).sort();
  if (files.length === 0) throw new Error('ffmpeg tidak menghasilkan potongan audio');
  return files;
}

/**
 * Normalisasi audio agar siap dikirim ke Whisper API:
 * - lolos apa adanya kalau format sudah didukung dan ukurannya di bawah batas
 * - dikompres ke opus 16k mono kalau kebesaran / formatnya tidak didukung
 * - dipotong jadi beberapa part kalau setelah dikompres masih di atas batas
 */
export async function prepareAudio(uploadPath, originalName) {
  const id = randomUUID();
  const dir = path.join(audio.workDir, id);
  await fs.mkdir(dir, { recursive: true });

  try {
    const ext = (path.extname(originalName ?? '') || '.bin').toLowerCase();
    const { size: originalSize } = await fs.stat(uploadPath);
    const durationSec = await probeDuration(uploadPath);

    if (originalSize === 0) {
      throw Object.assign(new Error('file audio kosong'), { status: 400 });
    }

    // 1. Jalur cepat: sudah kecil dan formatnya didukung → tanpa re-encode.
    if (originalSize <= audio.maxPartBytes && PASSTHROUGH_EXT.has(ext)) {
      const dest = path.join(dir, `part-000${ext}`);
      await fs.copyFile(uploadPath, dest);
      return buildResult({ id, durationSec, originalSize, compressed: false, files: [path.basename(dest)], dir, segmentSeconds: durationSec });
    }

    // 2. Kompres ke opus mono 16 kHz.
    const compressedPath = path.join(dir, 'compressed.ogg');
    await transcodeToOpus(uploadPath, compressedPath);
    const { size: compressedSize } = await fs.stat(compressedPath);

    if (compressedSize <= audio.maxPartBytes) {
      const dest = path.join(dir, 'part-000.ogg');
      await fs.rename(compressedPath, dest);
      return buildResult({ id, durationSec, originalSize, compressed: true, files: ['part-000.ogg'], dir, segmentSeconds: durationSec });
    }

    // 3. Masih kebesaran → potong berdasarkan bitrate aktual.
    const bytesPerSecond = durationSec > 0 ? compressedSize / durationSec : audio.opusBitrateKbps * 128;
    const segmentSeconds = Math.max(60, Math.floor((audio.maxPartBytes * 0.92) / bytesPerSecond));
    const files = await segmentOpus(compressedPath, dir, segmentSeconds);
    await fs.rm(compressedPath, { force: true });

    return buildResult({ id, durationSec, originalSize, compressed: true, files, dir, segmentSeconds });
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function buildResult({ id, durationSec, originalSize, compressed, files, dir, segmentSeconds }) {
  const parts = [];
  for (const [index, file] of files.entries()) {
    const { size } = await fs.stat(path.join(dir, file));
    parts.push({
      index,
      fileName: file,
      sizeBytes: size,
      startSec: Math.round(index * (segmentSeconds || 0)),
      url: `${config.publicBaseUrl}/audio/${id}/${index}`,
    });
  }
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ parts }, null, 2));

  return {
    ok: true,
    id,
    totalParts: parts.length,
    durationSec: Math.round(durationSec),
    originalSizeBytes: originalSize,
    compressed,
    parts,
  };
}

/** Ambil path absolut sebuah part untuk dikirim ke klien. */
export async function getPart(id, indexRaw) {
  if (!ID_RE.test(String(id ?? ''))) {
    throw Object.assign(new Error('id tidak valid'), { status: 400 });
  }
  const index = Number.parseInt(indexRaw, 10);
  if (!Number.isInteger(index) || index < 0) {
    throw Object.assign(new Error('index tidak valid'), { status: 400 });
  }

  const dir = path.join(audio.workDir, id);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    throw Object.assign(new Error('part audio sudah kedaluwarsa atau tidak ada'), { status: 404 });
  }

  const part = manifest.parts.find((p) => p.index === index);
  if (!part) throw Object.assign(new Error('part tidak ditemukan'), { status: 404 });

  return { filePath: path.join(dir, part.fileName), fileName: part.fileName };
}

export async function dropBundle(id) {
  if (!ID_RE.test(String(id ?? ''))) {
    throw Object.assign(new Error('id tidak valid'), { status: 400 });
  }
  await fs.rm(path.join(audio.workDir, id), { recursive: true, force: true });
}

/** Hapus bundle audio yang sudah lewat TTL. */
export function startJanitor() {
  const sweep = async () => {
    try {
      const entries = await fs.readdir(audio.workDir, { withFileTypes: true }).catch(() => []);
      const now = Date.now();
      for (const entry of entries) {
        if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue;
        const dir = path.join(audio.workDir, entry.name);
        const stat = await fs.stat(dir).catch(() => null);
        if (stat && now - stat.mtimeMs > audio.ttlMs) {
          await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
      }
    } catch {
      /* janitor tidak boleh menjatuhkan proses */
    }
  };

  sweep();
  const timer = setInterval(sweep, Math.min(audio.ttlMs, 5 * 60 * 1000));
  timer.unref();
  return timer;
}
