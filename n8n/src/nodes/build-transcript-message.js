// Kirim transkrip bersih: sebagai pesan biasa kalau pendek, sebagai file .txt
// kalau panjang (batas pesan Telegram 4096 karakter).
const config = $('Config').first().json;
const data = $('Parse Correction').first().json;

const transcript = String(data.transcript_corrected ?? data.transcript_raw ?? '').trim();
const limit = Number(config.max_transcript_inline ?? 3000);
const chatId = data.chat_id ?? $('Extract Audio').first().json.chat_id;
const threadId = data.thread_id ?? $('Extract Audio').first().json.thread_id;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stamp(iso) {
  const date = new Date(iso ?? Date.now());
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  return valid.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
}

if (transcript.length <= limit) {
  return [
    {
      json: {
        chat_id: chatId,
        thread_id: threadId,
        is_file: false,
        transcript_text: `📝 <b>Transkrip</b>\n\n${escapeHtml(transcript)}`,
      },
    },
  ];
}

const header = [
  data.title ? `Judul: ${data.title}` : null,
  `Tanggal: ${data.sent_at ?? ''}`,
  '',
  '',
].filter((line) => line !== null);

const content = `${header.join('\n')}${transcript}\n`;
const fileName = `transkrip-${stamp(data.sent_at)}.txt`;

return [
  {
    json: {
      chat_id: chatId,
      thread_id: threadId,
      is_file: true,
      file_name: fileName,
      transcript_text: '',
    },
    binary: {
      data: {
        data: Buffer.from(content, 'utf8').toString('base64'),
        mimeType: 'text/plain',
        fileName,
        fileExtension: 'txt',
      },
    },
  },
];
