// Susun body request LLM untuk ringkasan + outline mind map.
// Node yang sama dipakai untuk percobaan pertama dan percobaan ulang; saat
// RETRY_MODE aktif, instruksi tambahan soal JSON valid ikut dikirim.
const PROMPT_TEMPLATE = __INJECT_GENERATE_OUTLINE_PROMPT__;
const GLOSSARY_BLOCK = __INJECT_GLOSSARY_BLOCK__;
const RETRY_MODE = __INJECT_RETRY_MODE__;

const config = $('Config').first().json;
const source = RETRY_MODE ? $('Parse Correction').first().json : $input.first().json;
const transcript = String(source.transcript_corrected ?? source.transcript_raw ?? '').trim();

// Alasan lengkap ada di build-correction-request.js — ringkasnya, bingkai
// "notulen rapat" dan kamus brand Rizky salah kalau sumbernya video orang lain.
const isBisnis = source.source !== 'youtube';

const videoTitle = String(source.video_title ?? '')
  .replace(/[\r\n]+/g, ' ')
  .trim()
  .slice(0, 150);

const SYSTEM_PROMPT = PROMPT_TEMPLATE
  .replace(
    '{{KONTEKS}}',
    isBisnis
      ? 'Sumbernya rekaman rapat/brainstorm bisnis. Perlakukan sebagai notulen.'
      : `Sumbernya video YouTube${videoTitle ? ` berjudul "${videoTitle}"` : ''}. Perlakukan sebagai ringkasan isi video, bukan notulen rapat — tidak perlu mencari action item kalau memang tidak ada.`,
  )
  .replace(
    '{{KAMUS}}',
    isBisnis ? `\nKAMUS EJAAN (pakai persis seperti ini bila muncul):\n${GLOSSARY_BLOCK}` : '',
  )
  .trim();

const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

if (RETRY_MODE) {
  messages.push({
    role: 'system',
    content:
      'PERCOBAAN ULANG. Balasan sebelumnya bukan JSON valid. Balas HANYA satu objek JSON valid ' +
      'sesuai skema di atas — tanpa blok kode, tanpa komentar, tanpa teks pembuka atau penutup. ' +
      'Pastikan seluruh tanda kurung dan tanda kutip tertutup rapi.',
  });
}

messages.push({ role: 'user', content: transcript });

const body = {
  model: config.llm_model,
  temperature: RETRY_MODE ? 0 : Number(config.llm_temperature_outline ?? 0.3),
  messages,
};

// Beberapa provider OpenAI-compatible belum mendukung response_format —
// matikan lewat field `llm_json_mode` di node Config kalau provider menolak.
if (config.llm_json_mode === true || config.llm_json_mode === 'true') {
  body.response_format = { type: 'json_object' };
}

return [
  {
    json: {
      ...source,
      llm_url: `${String(config.llm_base_url).replace(/\/+$/, '')}/chat/completions`,
      body: JSON.stringify(body),
    },
  },
];
