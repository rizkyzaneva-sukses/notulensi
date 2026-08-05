// Ambil metadata audio dari update Telegram (voice note, file audio, video note,
// atau document ber-mime audio/video) dan normalkan jadi satu bentuk.
const update = $input.first().json;
const message = update.message ?? update.channel_post ?? update;

const candidates = [
  ['voice', message.voice],
  ['audio', message.audio],
  ['video_note', message.video_note],
];

let kind = null;
let media = null;
for (const [name, value] of candidates) {
  if (value && value.file_id) {
    kind = name;
    media = value;
    break;
  }
}

if (!media && message.document?.file_id) {
  const mime = String(message.document.mime_type ?? '');
  if (/^(audio|video)\//.test(mime)) {
    kind = 'document';
    media = message.document;
  }
}

const chatId = String(message.chat?.id ?? '');
// Hadir hanya kalau pesan dikirim di dalam topic grup forum; dipakai supaya
// balasan bot ikut masuk ke topic yang sama, bukan ke topic General.
const threadId = message.message_thread_id ?? undefined;
const sentAt = message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString();

return [
  {
    json: {
      has_audio: Boolean(media),
      kind,
      chat_id: chatId,
      thread_id: threadId,
      message_id: message.message_id ?? null,
      from: message.from?.first_name ?? '',
      caption: String(message.caption ?? '').trim(),
      sent_at: sentAt,
      file_id: media?.file_id ?? '',
      file_name: media?.file_name ?? '',
      mime_type: media?.mime_type ?? '',
      file_size: Number(media?.file_size ?? 0),
      duration_sec: Number(media?.duration ?? 0),
    },
  },
];
