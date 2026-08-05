// Parse balasan LLM jadi { title, summary, outline }.
// Node ini sengaja tidak pernah melempar error: kalau JSON-nya rusak, ia hanya
// menandai outline_valid = false supaya alur bisa retry / turun ke mode teks.
const SOURCE_NODE = __INJECT_SOURCE_NODE__;

const MAX_DEPTH = 3;
const MAX_CHILDREN = 8;
const MAX_LABEL = 80;

const response = $input.first().json;
const previous = $(SOURCE_NODE).first().json;

const choice = response?.choices?.[0];
const rawContent = choice?.message?.content ?? choice?.text ?? '';
const text = (Array.isArray(rawContent) ? rawContent.map((p) => p?.text ?? '').join('') : String(rawContent)).trim();

function extractJson(input) {
  const unfenced = input
    .replace(/^\s*```[a-z]*\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch (error) {
    // Model kadang menambahkan kalimat pembuka — ambil objek JSON terluar saja.
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch (innerError) {
      return null;
    }
  }
}

function cleanLabel(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s>#*+-]+/, '')
    .replace(/^\d+\.\s+/, '')
    .trim()
    .slice(0, MAX_LABEL);
}

function normalizeOutline(nodes, depth) {
  if (!Array.isArray(nodes) || depth > MAX_DEPTH) return [];
  const result = [];
  for (const node of nodes.slice(0, MAX_CHILDREN)) {
    const label = cleanLabel(typeof node === 'string' ? node : (node?.title ?? node?.name));
    if (!label) continue;
    const children = typeof node === 'string' ? [] : normalizeOutline(node?.children, depth + 1);
    result.push(children.length ? { title: label, children } : { title: label });
  }
  return result;
}

const parsed = extractJson(text);
const outline = normalizeOutline(parsed?.outline, 1);
const summary = String(parsed?.summary ?? '').trim();
const title = cleanLabel(parsed?.title) || cleanLabel(outline[0]?.title) || 'Catatan Suara';

const outlineValid = outline.length > 0 && summary.length > 0;

return [
  {
    json: {
      chat_id: previous.chat_id,
      thread_id: previous.thread_id,
      message_id: previous.message_id,
      sent_at: previous.sent_at,
      caption: previous.caption,
      duration_sec: previous.duration_sec,
      part_count: previous.part_count,
      transcript_raw: previous.transcript_raw,
      transcript_corrected: previous.transcript_corrected,
      correction_applied: previous.correction_applied,
      outline_valid: outlineValid,
      title,
      summary: summary || String(previous.transcript_corrected ?? '').slice(0, 600),
      outline,
      llm_raw_preview: outlineValid ? '' : text.slice(0, 400),
    },
  },
];
