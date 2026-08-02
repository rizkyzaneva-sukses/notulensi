const MAX_DEPTH = 3;

/**
 * Rapikan label node: satu baris, tanpa marker markdown di awal
 * (biar teks dari LLM tidak pernah "bocor" jadi heading/list tambahan).
 */
function clean(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s>#*+-]+/, '')
    .replace(/^\d+\.\s+/, '')
    .trim();
}

/**
 * Konversi outline JSON `[{ title, children: [...] }]` menjadi markdown heading.
 * Level 1..3 jadi `#`/`##`/`###`; kalau LLM tetap mengirim level 4+, sisanya
 * dilipat jadi bullet bertingkat supaya tidak ada node yang hilang.
 *
 * @param {Array} outline
 * @param {string} [title] Judul opsional yang dipakai sebagai node akar (`#`).
 */
export function outlineToMarkdown(outline, title) {
  /** @type {{ kind: 'heading' | 'bullet', text: string }[]} */
  const entries = [];
  const rootTitle = clean(title);
  if (rootTitle) entries.push({ kind: 'heading', text: `# ${rootTitle}` });

  const offset = rootTitle ? 1 : 0;

  const walk = (nodes, depth) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      const label = clean(typeof node === 'string' ? node : (node?.title ?? node?.name));
      if (!label) continue;

      const level = depth + offset;
      if (level <= MAX_DEPTH) {
        entries.push({ kind: 'heading', text: `${'#'.repeat(level)} ${label}` });
      } else {
        entries.push({ kind: 'bullet', text: `${'  '.repeat(level - MAX_DEPTH - 1)}- ${label}` });
      }
      walk(typeof node === 'string' ? null : node?.children, depth + 1);
    }
  };

  walk(outline, 1);

  const lines = [];
  for (const [i, entry] of entries.entries()) {
    // Heading butuh baris kosong pemisah; bullet berurutan tidak boleh dipisah
    // supaya tetap terbaca sebagai satu list bertingkat.
    if (i > 0 && (entry.kind === 'heading' || entries[i - 1].kind === 'heading')) lines.push('');
    lines.push(entry.text);
  }

  return lines.join('\n').trim();
}
