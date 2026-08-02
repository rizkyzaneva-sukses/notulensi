// Ambil teks balasan LLM dari bentuk respons OpenAI-compatible.
const response = $input.first().json;
const previous = $('Build Correction Request').first().json;

const choice = response?.choices?.[0];
const raw = choice?.message?.content ?? choice?.text ?? '';

const corrected = (Array.isArray(raw) ? raw.map((part) => part?.text ?? '').join('') : String(raw))
  // Sebagian model membungkus jawaban dalam blok kode meski sudah dilarang.
  .replace(/^\s*```[a-z]*\s*\n?/i, '')
  .replace(/\n?```\s*$/i, '')
  .trim();

const fallbackUsed = corrected.length === 0;

return [
  {
    json: {
      chat_id: previous.chat_id,
      message_id: previous.message_id,
      sent_at: previous.sent_at,
      caption: previous.caption,
      duration_sec: previous.duration_sec,
      part_count: previous.part_count,
      transcript_raw: previous.transcript_raw,
      // Kalau LLM balas kosong, lebih baik pakai transkrip mentah daripada gagal.
      transcript_corrected: fallbackUsed ? previous.transcript_raw : corrected,
      correction_applied: !fallbackUsed,
    },
  },
];
