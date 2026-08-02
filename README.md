# Notulensi — Voice to Mindmap

Implementasi dari [PRD-voice-to-mindmap.md](PRD-voice-to-mindmap.md): kirim voice note ke bot
Telegram pribadi, dapat balasan berupa mind map (PNG), ringkasan terstruktur, dan transkrip yang
sudah dikoreksi istilah bisnisnya.

```
NotelyVoice → Telegram → n8n → Groq Whisper → LLM (koreksi) → LLM (ringkasan+outline)
                                                                    ↓
                          Telegram ← mind map PNG ← render service (markmap + Puppeteer)
```

## Isi repo

| Folder | Isi |
|---|---|
| `n8n/` | Sumber workflow (Code node, prompt, kamus istilah) + builder + test |
| `n8n/voice-to-mindmap.workflow.json` | **File yang di-import ke n8n** (hasil build, jangan diedit manual) |
| `render-service/` | Micro-service Node.js: render mind map (markmap + Puppeteer) & penyiapan audio (ffmpeg) |
| `db/schema.sql` | Skema PostgreSQL untuk logging riwayat (fitur v2, opsional) |
| `docs/SETUP.md` | Panduan pemasangan langkah demi langkah |

Panduan lengkap ada di **[docs/SETUP.md](docs/SETUP.md)**. Ringkasnya:

```bash
cd render-service && npm install && npm run smoke   # cek render lokal
cd ../n8n && npm test                                # build workflow + jalankan test
```

Lalu deploy `render-service/` (EasyPanel, pakai Dockerfile-nya), import
`n8n/voice-to-mindmap.workflow.json` ke n8n, isi 5 credential dan node **Config**.

## Cara kerja workflow

Semua setelan yang biasa diubah ada di satu node: **Config** (node kedua setelah trigger).

1. **Telegram Trigger** → **Config** → cek `chat_id` terhadap whitelist. Chat lain dihentikan
   tanpa balasan.
2. **Extract Audio** mengenali voice note, file audio, video note, atau document ber-mime audio.
3. **Prepare Audio** mengirim audio ke render service, yang menormalkannya: lolos apa adanya kalau
   sudah kecil & formatnya didukung, dikompres ke opus 16 kHz mono kalau kebesaran, dan dipotong
   jadi beberapa part kalau setelah dikompres masih di atas 24 MB (≈ 3,5 jam audio).
4. Tiap part ditranskripsi **Groq Whisper** (`whisper-large-v3`, `language=id`). Kalau Groq gagal,
   part-nya diunduh ulang lalu dicoba ke **OpenAI Whisper**.
5. **Merge Transcript** menyusun ulang potongan sesuai urutan index part — jadi kalau sebagian part
   lewat Groq dan sisanya lewat fallback, hasilnya tetap satu transkrip dengan urutan benar.
6. **LLM: Correct Terms** memperbaiki ejaan brand & istilah memakai `n8n/glossary.json`.
7. **LLM: Generate Outline** menghasilkan `{ title, summary, outline }`. Kalau JSON-nya tidak valid,
   dicoba ulang 1× dengan suhu 0 dan instruksi tegas; kalau tetap gagal, ringkasan tetap dikirim
   tanpa mind map.
8. **Outline to Markdown** → **Render Mindmap** → PNG.
9. Balasan ke Telegram: mind map, ringkasan, lalu transkrip bersih (jadi file `.txt` kalau > 3000
   karakter).

Setiap tahap punya error output yang bermuara ke satu pesan Telegram — tidak ada kegagalan yang
diam-diam.

## Provider LLM: OpenRouter (default)

Default-nya memakai **OpenRouter** — satu API key untuk banyak provider (Gemini, GPT, Claude,
Llama, dll), jadi ganti model = ganti satu field `llm_model`, tanpa ganti base_url atau credential.

```
llm_base_url  = https://openrouter.ai/api/v1
llm_model     = google/gemini-3.1-flash-lite
llm_json_mode = true
```

`google/gemini-3.1-flash-lite` sudah diuji langsung lewat API (bukan cuma dugaan) — cepat (~1,5–1,7
detik per panggilan), murah, dan konsisten menghasilkan JSON valid untuk outline mind map.

Model lain yang tersedia di OpenRouter dan sudah diverifikasi mendukung `response_format:
json_object`:

| `llm_model` | Catatan |
|---|---|
| `google/gemini-3.1-flash-lite` | **default** — sweet spot biaya/kecepatan sesuai rekomendasi PRD |
| `openai/gpt-5-mini` | alternatif dari PRD, sedikit lebih mahal & lebih lambat (reasoning tokens) |
| `google/gemini-3.5-flash` | kalau butuh kualitas lebih tinggi untuk transkrip panjang/kompleks |
| `meta-llama/llama-3.3-70b-instruct` | opsi paling murah |

Cek id & harga model terbaru di <https://openrouter.ai/models> sebelum ganti — id model berubah
dari waktu ke waktu (`google/gemini-2.0-flash-001` misalnya sudah tidak aktif).

Ganti ke provider lain (langsung ke Groq/OpenAI/Anthropic/Gemini, tanpa lewat OpenRouter) tetap
tinggal ubah tiga field yang sama plus credential `LLM Provider`. Sama untuk Whisper: `groq_url` /
`groq_model` dan `openai_url` / `openai_model` juga ada di node Config.

## Mengubah kamus istilah

Edit `n8n/glossary.json`, lalu:

```bash
cd n8n && npm test
```

Import ulang `voice-to-mindmap.workflow.json` ke n8n. Kamus dipakai di tiga tempat: `prompt` Whisper
(bantuan ejaan saat transkripsi), prompt koreksi, dan prompt outline.

## Mengubah workflow

`voice-to-mindmap.workflow.json` adalah **hasil build**. Sumbernya:

```
n8n/build-workflow.mjs      struktur node & koneksi
n8n/src/nodes/*.js          isi tiap Code node
n8n/src/prompts/*.md        system prompt LLM
n8n/glossary.json           kamus istilah
```

`npm test` di folder `n8n/` akan build ulang lalu menjalankan 41 test: sintaks tiap Code node,
keutuhan koneksi & jalur error, tidak adanya kredensial hardcode, tidak adanya input node yang
menerima dua koneksi sekaligus (penyebab balasan dobel di n8n), plus perilaku tiap Code node
(parsing JSON rusak, escaping HTML, pemotongan pesan Telegram, urutan potongan audio, dsb).

Perubahan kecil boleh saja dilakukan langsung di UI n8n, tapi kalau begitu ekspor hasilnya kembali
ke repo ini supaya sumber dan hasil tidak berpisah.

## Batasan yang perlu diketahui

- **Pemotongan audio tanpa overlap.** Audio > ~3,5 jam dipotong dengan `ffmpeg -f segment`, jadi ada
  kemungkinan satu kata terpotong di batas potongan.
- **Render service jadi dependensi setiap eksekusi**, bukan cuma saat bikin mind map — penyiapan
  audio juga lewat sana. Kalau service mati, workflow mengirim pesan error, bukan diam.
- **`llm_model` default (`llama-3.3-70b-versatile`) dipilih supaya satu API key Groq bisa dipakai
  untuk Whisper sekaligus LLM.** PRD merekomendasikan Gemini Flash-Lite / GPT-5 Mini — itu tinggal
  ganti tiga field di node Config seperti di tabel atas.
- **Logging riwayat (PRD §3.9) belum dipasang di workflow** karena ditandai nice-to-have v2. Skema
  tabelnya sudah siap di `db/schema.sql`.
