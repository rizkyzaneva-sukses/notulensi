// Gabungkan hasil transkripsi semua part audio kembali jadi satu teks.
// Node ini menerima item dari jalur Groq maupun jalur fallback OpenAI, jadi
// urutannya dipulihkan lewat index part-nya, bukan lewat urutan item.
const items = $input.all();
const rows = [];

for (let i = 0; i < items.length; i++) {
  const json = items[i].json ?? {};

  let index = i;
  try {
    const matched = $('Split Parts').itemMatching(i);
    const value = Number(matched?.json?.index);
    if (Number.isFinite(value)) index = value;
  } catch (error) {
    // Paired-item tidak bisa ditelusuri (mis. provider mengubah bentuk item) —
    // pakai urutan kedatangan sebagai perkiraan terbaik.
    index = i;
  }

  const text = typeof json.text === 'string' ? json.text : (json.transcript ?? '');
  rows.push({ index, text: String(text).trim() });
}

rows.sort((a, b) => a.index - b.index);

const transcriptRaw = rows
  .map((row) => row.text)
  .filter(Boolean)
  .join('\n\n')
  .trim();

const meta = $('Extract Audio').first().json;

return [
  {
    json: {
      chat_id: meta.chat_id,
      message_id: meta.message_id,
      sent_at: meta.sent_at,
      caption: meta.caption,
      duration_sec: meta.duration_sec,
      part_count: rows.length,
      transcript_raw: transcriptRaw,
      has_transcript: transcriptRaw.length > 0,
    },
  },
];
