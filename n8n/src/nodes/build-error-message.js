// Susun pesan error yang dikirim ke Telegram.
// Semua jalur error bertemu di sini; tahap & kalimat ramahnya sudah diisi oleh
// node "Stage: ..." tepat sebelum node ini.
const item = $input.first().json ?? {};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const detail = String(
  item.error?.message ??
    item.error?.description ??
    item.error?.error ??
    (typeof item.error === 'string' ? item.error : '') ??
    item.message ??
    '',
).trim();

const lines = [
  `⚠️ <b>${escapeHtml(item.error_stage ?? 'Pemrosesan gagal')}</b>`,
  escapeHtml(item.error_message ?? 'Coba kirim ulang rekamannya ya.'),
];

if (detail) {
  lines.push('', `<code>${escapeHtml(detail.slice(0, 300))}</code>`);
}

let chatId = item.chat_id ?? '';
let threadId = item.thread_id;
if (!chatId) {
  try {
    chatId = $('Extract Input').first().json.chat_id;
    threadId = $('Extract Input').first().json.thread_id;
  } catch (error) {
    chatId = '';
  }
}

return [
  {
    json: {
      chat_id: chatId,
      thread_id: threadId,
      error_text: lines.join('\n'),
    },
  },
];
