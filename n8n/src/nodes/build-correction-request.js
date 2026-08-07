// Susun body request LLM untuk koreksi istilah.
//
// Berbeda dengan tahap ringkasan yang memampatkan, tahap ini harus mengeluarkan
// SELURUH transkrip lagi sebagai output. Transkrip satu jam (±15 ribu token)
// akan menabrak plafon output model dan terpotong diam-diam. Jadi transkrip
// panjang dipecah dulu, dan tiap potongan dikoreksi terpisah.
//
// Node ini mengembalikan satu item per potongan; HTTP Request node di n8n
// otomatis berjalan sekali untuk tiap item, jadi tidak perlu loop manual.
//
// Transkrip adalah input bebas, jadi body-nya dirakit sebagai objek lalu
// di-JSON.stringify() di sini dan dikirim sebagai Raw body oleh HTTP Request node.
const SYSTEM_PROMPT = __INJECT_CORRECT_TERMS_PROMPT__;

const config = $('Config').first().json;
const source = $input.first().json;
const transcript = String(source.transcript_raw ?? '').trim();

// Batas karakter per potongan. 0 / kosong = jangan potong sama sekali.
const chunkChars = Math.max(0, Number(config.correction_chunk_chars ?? 9000) || 0);

/**
 * Potong teks di batas paling alami yang masih muat: paragraf dulu, lalu
 * kalimat, dan hanya kalau terpaksa dipotong di tengah. Tujuannya supaya tiap
 * potongan tetap bisa dibaca model sebagai satuan yang utuh.
 */
function splitTranscript(text, limit) {
  if (!limit || text.length <= limit) return text ? [text] : [];

  const chunks = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  // Coba sambung ke potongan berjalan; gagal kalau jadi melewati batas.
  const append = (piece, separator) => {
    const candidate = current ? current + separator + piece : piece;
    if (candidate.length > limit) return false;
    current = candidate;
    return true;
  };

  for (const paragraph of text.split(/\n{2,}/)) {
    const block = paragraph.trim();
    if (!block) continue;
    if (append(block, '\n\n')) continue;

    flush();
    if (block.length <= limit) {
      current = block;
      continue;
    }

    // Satu paragraf saja sudah kebesaran → turun ke batas kalimat.
    for (const sentence of block.match(/[^.!?\n]+[.!?]*\s*/g) ?? [block]) {
      const piece = sentence.trim();
      if (!piece) continue;
      if (append(piece, ' ')) continue;

      flush();
      if (piece.length <= limit) {
        current = piece;
        continue;
      }

      // Kalimat sangat panjang tanpa tanda baca (jarang, tapi Whisper bisa
      // menghasilkannya) → potong paksa daripada melewati batas.
      for (let i = 0; i < piece.length; i += limit) chunks.push(piece.slice(i, i + limit));
    }
  }
  flush();

  return chunks.length ? chunks : [text];
}

const split = splitTranscript(transcript, chunkChars);
// Selalu kembalikan minimal satu item supaya metadata tidak hilang dari alur.
const chunks = split.length ? split : [transcript];
const total = chunks.length;
const llmUrl = `${String(config.llm_base_url).replace(/\/+$/, '')}/chat/completions`;

return chunks.map((chunk, index) => {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

  if (total > 1) {
    // Tanpa instruksi ini model cenderung menambahkan "Berikut lanjutannya:"
    // atau catatan bahwa teksnya terpotong — dan itu ikut tergabung ke hasil.
    messages.push({
      role: 'system',
      content:
        `Ini potongan ke-${index + 1} dari ${total} sebuah transkrip panjang. ` +
        'Perbaiki potongan ini saja dan balas hanya isinya. Jangan menambah kalimat ' +
        'penghubung, pembuka, penutup, atau catatan bahwa teks ini terpotong. ' +
        'Wajar kalau potongan ini dimulai atau berakhir di tengah pembicaraan.',
    });
  }

  messages.push({ role: 'user', content: chunk });

  const body = {
    model: config.llm_model,
    temperature: Number(config.llm_temperature_correct ?? 0.1),
    messages,
  };

  return {
    json: {
      ...source,
      chunk_index: index,
      chunk_total: total,
      // Disimpan supaya Parse Correction bisa jatuh balik per potongan.
      chunk_text: chunk,
      llm_url: llmUrl,
      body: JSON.stringify(body),
    },
  };
});
