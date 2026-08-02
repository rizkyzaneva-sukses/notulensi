// Ubah outline JSON jadi markdown heading (#, ##, ###) lalu rakit body request
// untuk render service. Body di-JSON.stringify() di sini dan dikirim sebagai
// Raw body karena isinya teks bebas dari LLM.
const MAX_DEPTH = 3;

const config = $('Config').first().json;
const source = $input.first().json;

function cleanLabel(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s>#*+-]+/, '')
    .replace(/^\d+\.\s+/, '')
    .trim();
}

const entries = [];

function walk(nodes, depth) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const label = cleanLabel(typeof node === 'string' ? node : (node?.title ?? node?.name));
    if (!label) continue;

    if (depth <= MAX_DEPTH) {
      entries.push({ kind: 'heading', text: `${'#'.repeat(depth)} ${label}` });
    } else {
      // Pengaman kalau LLM tetap mengirim level 4+: turunkan jadi bullet
      // supaya tidak ada poin yang hilang dari mind map.
      entries.push({ kind: 'bullet', text: `${'  '.repeat(depth - MAX_DEPTH - 1)}- ${label}` });
    }
    walk(typeof node === 'string' ? null : node?.children, depth + 1);
  }
}

walk(source.outline, 1);

const lines = [];
entries.forEach((entry, i) => {
  if (i > 0 && (entry.kind === 'heading' || entries[i - 1].kind === 'heading')) lines.push('');
  lines.push(entry.text);
});

const markdown = lines.join('\n').trim();

const body = {
  markdown,
  width: Number(config.mindmap_width ?? 1600),
  theme: String(config.mindmap_theme ?? 'light'),
};

return [
  {
    json: {
      ...source,
      markdown,
      render_url: `${String(config.render_base_url).replace(/\/+$/, '')}/render`,
      body: JSON.stringify(body),
    },
  },
];
