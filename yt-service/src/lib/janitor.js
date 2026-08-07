const { readdir, stat, unlink, readFile, rm } = require('fs/promises');
const { join } = require('path');

const TTL = parseInt(process.env.FILE_TTL_MS || '7200000', 10); // default 2 jam
const CHECK_INTERVAL = 60_000; // cek tiap 1 menit

async function cleanOnce(workDir) {
  let cleaned = 0;

  try {
    const entries = await readdir(workDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dirPath = join(workDir, entry.name);
      const manifestPath = join(dirPath, 'manifest.json');

      try {
        let age;
        try {
          const data = JSON.parse(await readFile(manifestPath, 'utf-8'));
          age = Date.now() - data.createdAt;
        } catch {
          // Tanpa manifest — justru inilah sisa run yang gagal. Kalau dilewati,
          // folder seperti ini menumpuk selamanya. Umurnya diambil dari mtime.
          const info = await stat(dirPath);
          age = Date.now() - info.mtimeMs;
        }

        if (age > TTL) {
          await rm(dirPath, { recursive: true, force: true });
          cleaned++;
          console.log(`[janitor] cleaned: ${entry.name} (age: ${Math.round(age / 60000)}m)`);
        }
      } catch (err) {
        console.error(`[janitor] lewati ${entry.name}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[janitor] error:', err.message);
  }

  return cleaned;
}

function startJanitor(workDir) {
  console.log(`[janitor] started (TTL: ${Math.round(TTL / 60000)}min, check: ${CHECK_INTERVAL / 1000}s)`);

  setInterval(() => cleanOnce(workDir), CHECK_INTERVAL);

  // bersihkan sekali saat start
  cleanOnce(workDir);
}

module.exports = { startJanitor, cleanOnce };
