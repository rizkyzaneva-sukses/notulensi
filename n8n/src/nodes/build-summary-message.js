// Rakit pesan ringkasan untuk Telegram (parse_mode HTML).
const WITH_MINDMAP = __INJECT_WITH_MINDMAP__;
const TELEGRAM_LIMIT = 4000;

function pick(nodeName) {
  try {
    return $(nodeName).first().json ?? null;
  } catch (error) {
    return null;
  }
}

// Node ini dipakai oleh jalur dengan dan tanpa mind map, jadi sumber datanya
// dicari dari kandidat yang benar-benar sempat berjalan.
const candidates = ['Outline to Markdown', 'Parse Outline Retry', 'Parse Outline']
  .map(pick)
  .filter(Boolean);
const data = candidates.find((item) => item.outline_valid) ?? candidates[0] ?? pick('Parse Correction') ?? {};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return '';
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes ? `${minutes} mnt ${rest} dtk` : `${rest} dtk`;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (error) {
    return '';
  }
}

let durationSec = Number(data.duration_sec ?? 0);
const prepared = pick('Prepare Audio');
if (!durationSec && prepared?.durationSec) durationSec = Number(prepared.durationSec);

const metaParts = [formatDuration(durationSec), formatDate(data.sent_at)].filter(Boolean);

const lines = [`🗒 <b>${escapeHtml(data.title ?? 'Catatan Suara')}</b>`];
if (metaParts.length) lines.push(`<i>${escapeHtml(metaParts.join(' · '))}</i>`);
lines.push('', escapeHtml(data.summary ?? '').trim());

const outline = Array.isArray(data.outline) ? data.outline : [];
const themes = outline.length === 1 && Array.isArray(outline[0]?.children) ? outline[0].children : outline;

if (themes.length) {
  lines.push('', '<b>Poin utama</b>');
  for (const theme of themes) {
    lines.push(`• <b>${escapeHtml(theme?.title)}</b>`);
    for (const child of Array.isArray(theme?.children) ? theme.children : []) {
      lines.push(`   ◦ ${escapeHtml(child?.title)}`);
    }
  }
}

if (!WITH_MINDMAP) {
  lines.push('', '<i>⚠️ Mind map gagal dibuat kali ini — ringkasan tetap dikirim.</i>');
}

let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
if (text.length > TELEGRAM_LIMIT) {
  text = `${text.slice(0, TELEGRAM_LIMIT - 30).trim()}\n\n<i>… (dipotong)</i>`;
}

return [
  {
    json: {
      chat_id: data.chat_id ?? $('Extract Audio').first().json.chat_id,
      title: data.title ?? 'Catatan Suara',
      summary_text: text,
    },
  },
];
