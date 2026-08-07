// Ambil teks balasan LLM dari bentuk respons OpenAI-compatible, lalu susun
// kembali potongan-potongan transkrip jadi satu teks utuh.
//
// Node ini menerima satu item per potongan (lihat Build Correction Request) dan
// memasang dua pengaman:
//
// 1. Potongan yang gagal — atau yang balasannya jauh lebih pendek dari aslinya,
//    tanda balasannya kena plafon output model — dianggap tidak terpakai, dan
//    yang dipakai adalah teks mentah potongan itu. Lebih baik satu bagian tidak
//    terkoreksi daripada isinya hilang separuh tanpa ketahuan.
// 2. Node "LLM: Correct Terms" memakai continueRegularOutput, jadi item yang
//    error ikut masuk ke sini alih-alih menyalakan jalur error terpisah. Kalau
//    lewat jalur error, satu potongan gagal akan membuat jalur error dan jalur
//    sukses menyala bersamaan — dan Rizky menerima pesan error plus ringkasan.
const config = $('Config').first().json;
const requests = $('Build Correction Request');
const previous = requests.first().json;

const minRatio = Number(config.correction_min_ratio ?? 0.6);
// Koreksi memang memangkas filler ("eh", "anu", "gitu ya"), jadi teks pendek
// wajar menyusut banyak. Pemeriksaan rasio baru berarti untuk potongan yang
// cukup panjang — yaitu satu-satunya yang bisa kena plafon output.
const GUARD_MIN_CHARS = 2000;

function textOf(response) {
  const choice = response?.choices?.[0];
  const raw = choice?.message?.content ?? choice?.text ?? '';

  return (Array.isArray(raw) ? raw.map((part) => part?.text ?? '').join('') : String(raw))
    // Sebagian model membungkus jawaban dalam blok kode meski sudah dilarang.
    .replace(/^\s*```[a-z]*\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

const items = $input.all();
const rows = [];
let failed = 0;

for (let i = 0; i < items.length; i++) {
  const response = items[i].json ?? {};

  let request = {};
  try {
    request = requests.itemMatching(i)?.json ?? {};
  } catch (error) {
    // Paired-item tidak bisa ditelusuri (mis. provider mengubah bentuk item) —
    // pakai urutan kedatangan sebagai perkiraan terbaik.
    request = {};
  }

  const parsedIndex = Number(request.chunk_index);
  const index = Number.isFinite(parsedIndex) ? parsedIndex : i;
  const original = String(request.chunk_text ?? previous.transcript_raw ?? '');
  const corrected = response.error ? '' : textOf(response);

  const truncated =
    original.length >= GUARD_MIN_CHARS && corrected.length < original.length * minRatio;
  const usable = corrected.length > 0 && !truncated;

  if (!usable) failed += 1;
  rows.push({ index, text: usable ? corrected : original });
}

rows.sort((a, b) => a.index - b.index);

const merged = rows
  .map((row) => row.text)
  .filter(Boolean)
  .join('\n\n')
  .trim();

const total = rows.length;

return [
  {
    json: {
      chat_id: previous.chat_id,
      thread_id: previous.thread_id,
      message_id: previous.message_id,
      sent_at: previous.sent_at,
      caption: previous.caption,
      // Ikut mengalir karena prompt ringkasan juga bergantung pada sumbernya.
      source: previous.source,
      video_title: previous.video_title,
      video_channel: previous.video_channel,
      video_url: previous.video_url,
      duration_sec: previous.duration_sec,
      part_count: previous.part_count,
      transcript_raw: previous.transcript_raw,
      // Kalau semuanya gagal, lebih baik pakai transkrip mentah daripada gagal.
      transcript_corrected: merged || previous.transcript_raw,
      correction_applied: total > 0 && failed < total,
      correction_chunk_total: total,
      correction_chunk_failed: failed,
    },
  },
];
