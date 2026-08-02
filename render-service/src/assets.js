import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Cari file di dalam sebuah package npm tanpa bergantung pada field `exports`
 * (d3 & markmap-view tidak meng-export path `dist/...` secara eksplisit).
 */
function resolvePackageFile(pkg, relPath) {
  const tried = [];

  try {
    return require.resolve(`${pkg}/${relPath}`);
  } catch {
    tried.push(`${pkg}/${relPath} (exports)`);
  }

  let dir = here;
  while (true) {
    const candidate = path.join(dir, 'node_modules', pkg, relPath);
    tried.push(candidate);
    if (existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `Tidak menemukan aset "${pkg}/${relPath}". Jalankan "npm install" di render-service. Lokasi yang dicoba:\n  - ${tried.join('\n  - ')}`,
  );
}

function loadFirst(pkg, relPaths) {
  const errors = [];
  for (const rel of relPaths) {
    try {
      return readFileSync(resolvePackageFile(pkg, rel), 'utf8');
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(errors.join('\n'));
}

let cache = null;

/** Bundle browser d3 + markmap-view, dibaca dari node_modules (tanpa CDN). */
export function browserAssets() {
  if (cache) return cache;
  cache = {
    d3: loadFirst('d3', ['dist/d3.min.js', 'dist/d3.js']),
    markmapView: loadFirst('markmap-view', [
      'dist/browser/index.js',
      'dist/browser/index.iife.js',
      'dist/index.js',
    ]),
  };
  return cache;
}
