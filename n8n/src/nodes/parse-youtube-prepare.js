// Terjemahkan balasan yt-service jadi keputusan lanjut/berhenti.
//
// Node "YouTube: Prepare" sengaja memakai neverError + fullResponse +
// continueRegularOutput, jadi SEMUA kemungkinan bermuara ke sini sebagai satu
// item biasa: sukses, error HTTP dengan kode dari service, dan gagal terhubung
// karena PC mati. Satu tempat untuk memutuskan, bukan tiga cabang terpisah.
//
// Kode error dari yt-service diterjemahkan jadi kalimat yang memberi tahu Rizky
// apa yang harus dilakukan — tanpa ini semua kegagalan terlihat sama.
const previous = $('Build YouTube Request').first().json;
const response = $input.first().json ?? {};

const PESAN = {
  INVALID_URL: ['Link tidak dikenali', 'Itu bukan link video YouTube. Kirim link satu video ya.'],
  UNSUPPORTED_URL: ['Bukan video tunggal', 'Playlist dan channel belum didukung — kirim link satu video.'],
  LIVE_NOT_SUPPORTED: ['Masih siaran langsung', 'Tunggu siarannya selesai dulu, baru kirim ulang linknya.'],
  TOO_LONG: ['Video terlalu panjang', 'Batasnya 4 jam. Kalau perlu, potong dulu bagian yang mau diringkas.'],
  DURATION_UNKNOWN: ['Durasi tidak terbaca', 'Kemungkinan premiere atau siaran yang belum selesai.'],
  VIDEO_UNAVAILABLE: ['Video tidak tersedia', 'Videonya privat, sudah dihapus, atau dibatasi wilayah.'],
  BOT_CHECK: ['YouTube minta verifikasi', 'YouTube menandai unduhan ini sebagai bot. Perlu pasang cookies di yt-service.'],
  DOWNLOAD_FAILED: ['Gagal mengunduh video', 'Coba kirim ulang linknya sebentar lagi.'],
  TRANSCODE_FAILED: ['Gagal menyiapkan audio', 'Konversi audio di PC gagal. Cek log yt-service.'],
  STORAGE_FULL: ['Disk PC penuh', 'Kosongkan ruang di PC dulu, lalu kirim ulang.'],
  UNAUTHORIZED: ['Kredensial yt-service salah', 'Token di n8n tidak cocok dengan SERVICE_TOKEN di .env PC.'],
};

const meta = {
  chat_id: previous.chat_id,
  thread_id: previous.thread_id,
  message_id: previous.message_id,
  sent_at: previous.sent_at,
  caption: previous.caption,
  source: 'youtube',
  youtube_url: previous.youtube_url,
};

function gagal(stage, message, detail) {
  return [
    {
      json: {
        ...meta,
        yt_ok: false,
        error_stage: stage,
        error_message: message,
        // Dibaca Build Error Message untuk ditampilkan sebagai <code>.
        error: detail ? { message: String(detail).slice(0, 300) } : undefined,
      },
    },
  ];
}

// Gagal terhubung sama sekali — item tidak punya statusCode, hanya error.
if (response.error && response.statusCode === undefined) {
  const detail = response.error?.message ?? response.error?.description ?? '';
  return gagal(
    'PC perekam tidak aktif',
    'yt-service tidak merespons. Pastikan PC menyala dan Tailscale tersambung.',
    detail,
  );
}

const status = Number(response.statusCode ?? 0);
// fullResponse membungkus isinya di `body`; kalau opsi itu mati, isinya di akar.
const body = response.body ?? response;

if (status !== 200 || body?.ok !== true) {
  const code = String(body?.code ?? 'UNKNOWN');
  const [stage, message] = PESAN[code] ?? [
    'Gagal memproses link YouTube',
    'Coba kirim ulang linknya. Kalau terus gagal, cek log yt-service di PC.',
  ];
  return gagal(stage, message, body?.message ?? `HTTP ${status}`);
}

return [
  {
    json: {
      ...meta,
      yt_ok: true,
      video_id: body.videoId ?? '',
      video_title: body.title ?? '',
      video_channel: body.channel ?? '',
      audio_url: body.audioUrl ?? '',
      // Durasi dari yt-service dipakai sebagai perkiraan awal; angka final
      // tetap diambil dari ffprobe di Prepare Audio.
      duration_sec: Number(body.durationSec ?? 0),
    },
  },
];
