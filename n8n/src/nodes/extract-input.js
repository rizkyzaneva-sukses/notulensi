// Kenali jenis masukan dari update Telegram dan normalkan jadi satu bentuk.
//
// Dua sumber yang didukung:
//   - audio  : voice note, file audio, video note, atau document ber-mime audio/video
//   - youtube: pesan teks (atau caption) yang mengandung link video YouTube
//
// Field `source` yang dihasilkan di sini ikut mengalir sampai ke tahap koreksi
// dan ringkasan, karena prompt-nya berbeda per sumber — kamus istilah bisnis
// hanya masuk akal untuk rekaman rapat, bukan untuk video orang lain.
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

// --- deteksi link YouTube ------------------------------------------------
// Sengaja longgar: yang penting menangkap niat "ini link YouTube". Validasi
// sesungguhnya dilakukan yt-service, yang bisa membedakan playlist, channel,
// dan video tunggal dengan benar.
const text = `${message.text ?? ''} ${message.caption ?? ''}`.trim();
const YOUTUBE_LINK = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/\S+/i;

const linkMatch = media ? null : text.match(YOUTUBE_LINK);
// Tanda baca di ujung kalimat ikut tertangkap \S+ — dibuang supaya URL bersih.
const youtubeUrl = linkMatch ? linkMatch[0].replace(/[.,;:!?)\]]+$/, '') : '';

const chatId = String(message.chat?.id ?? '');
// Hadir hanya kalau pesan dikirim di dalam topic grup forum; dipakai supaya
// balasan bot ikut masuk ke topic yang sama, bukan ke topic General.
const threadId = message.message_thread_id ?? undefined;
const sentAt = message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString();

const hasAudio = Boolean(media);
const hasYoutube = Boolean(youtubeUrl);

return [
  {
    json: {
      has_audio: hasAudio,
      has_youtube: hasYoutube,
      source: hasAudio ? 'voice' : hasYoutube ? 'youtube' : 'unknown',
      youtube_url: youtubeUrl,
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
