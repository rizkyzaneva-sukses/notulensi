// Kabari Rizky bahwa videonya sudah dikenali dan sedang diproses.
//
// Video 1 jam butuh 5-8 menit sampai ringkasan datang. Tanpa kabar apa pun
// selama itu, "sedang jalan" dan "mati diam-diam" terlihat sama persis. Pesan
// ini sekalian jadi konfirmasi bahwa video yang diambil memang yang dimaksud.
const data = $input.first().json;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return '';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours} jam ${minutes} mnt`;
  return `${minutes || 1} mnt`;
}

const title = String(data.video_title ?? '').trim() || 'Video YouTube';
const bits = [data.video_channel, formatDuration(data.duration_sec)].filter(Boolean);

const lines = [`🎬 <b>${escapeHtml(title)}</b>`];
if (bits.length) lines.push(`<i>${escapeHtml(bits.join(' · '))}</i>`);
lines.push('', '<i>Sedang diproses — ringkasan menyusul beberapa menit lagi.</i>');

return [
  {
    json: {
      chat_id: data.chat_id,
      thread_id: data.thread_id,
      ack_text: lines.join('\n'),
    },
  },
];
