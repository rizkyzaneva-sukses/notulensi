# Panduan Pemasangan

Urutannya: render service dulu (karena n8n butuh URL-nya), baru bot Telegram, baru workflow.

Checklist singkat — 6 langkah sampai bot bisa dipakai:

1. Deploy `render-service/` ke EasyPanel, catat URL publik + `SERVICE_TOKEN`
2. Buat bot Telegram lewat BotFather, catat token + chat id kamu
3. Siapkan API key: **Groq** (wajib, transkripsi) + **OpenRouter** (default, LLM)
4. Buat 5 credential di n8n
5. Import `n8n/voice-to-mindmap.workflow.json`, sambungkan tiap node ke credential-nya
6. Isi node **Config**, Activate, kirim voice note tes

---

## 0. Prasyarat

- n8n self-hosted v1.119.2 (atau lebih baru)
- VPS + EasyPanel untuk render service
- API key **Groq** (wajib, untuk transkripsi Whisper) — <https://console.groq.com>
- API key **OpenAI** (opsional, untuk fallback transkripsi kalau Groq gagal)
- API key **OpenRouter** (untuk LLM koreksi + ringkasan; default workflow ini) — <https://openrouter.ai/keys>
- Node.js 20+ di mesin lokal kalau mau build/ubah workflow

> **Soal OpenRouter:** LLM (koreksi istilah + ringkasan + outline) dan Whisper (transkripsi) adalah
> dua hal terpisah. OpenRouter cuma menyediakan LLM — **Groq tetap wajib** untuk transkripsi karena
> OpenRouter tidak punya endpoint audio-to-text.
>
> Kalau kamu sudah punya API key OpenRouter: masukkan langsung ke credential `LLM Provider` di
> n8n (langkah 3 di bawah) — **jangan** ditaruh di file apa pun di repo ini. Kalau key itu sempat
> kamu tempel di tempat lain (chat, dokumen, dst.), pertimbangkan untuk generate key baru di
> <https://openrouter.ai/keys> supaya key lama bisa dicabut.

---

## 1. Deploy render service

Service ini melakukan dua hal: render mind map (markmap + Puppeteer) dan penyiapan audio (ffmpeg).

### 1.1 Siapkan token

```bash
openssl rand -hex 24
```

Simpan hasilnya — ini `SERVICE_TOKEN`, dipakai di service **dan** di credential n8n.

### 1.2 Deploy di EasyPanel

1. **Create Service → App**, nama misalnya `notulensi-render`.
2. **Source**: arahkan ke repo ini, **Build path** `render-service`, **Build method: Dockerfile**.
3. **Environment** — isi minimal:

   ```
   SERVICE_TOKEN=<hasil openssl rand di atas>
   PUBLIC_BASE_URL=https://notulensi-render.domain-kamu.com
   PORT=3000
   AUDIO_WORK_DIR=/data/audio
   ```

   Daftar lengkap beserta penjelasannya ada di [`render-service/.env.example`](../render-service/.env.example).

4. **Domains**: aktifkan domain + HTTPS, port `3000`.
5. **Mounts**: tambahkan volume ke `/data/audio` (potongan audio ditulis ke sana; dihapus otomatis
   setelah 30 menit).
6. **Resources**: sediakan RAM ≥ 1 GB — Chrome headless butuh ruang. Service membatasi diri maksimal
   2 render bersamaan.

`PUBLIC_BASE_URL` harus URL yang bisa dijangkau n8n, karena URL potongan audio yang dikirim ke n8n
disusun dari nilai ini.

### 1.3 Verifikasi

```bash
curl https://notulensi-render.domain-kamu.com/healthz
```

Harus membalas `{"ok":true,...}`. Lalu uji render (ganti `$TOKEN`):

```bash
curl -X POST https://notulensi-render.domain-kamu.com/render -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"markdown":"# Tes\n\n## Cabang A\n\n## Cabang B"}' -o tes.png
```

`tes.png` harus terbuka sebagai gambar mind map.

### 1.4 Menjalankan lokal (opsional)

```bash
cd render-service
npm install
npm run smoke          # render contoh ke out/sample.png, tanpa perlu server
SERVICE_TOKEN=token-lokal-minimal-16-char npm start
```

`npm run smoke` tidak butuh ffmpeg. Endpoint `/audio/prepare` butuh ffmpeg + ffprobe di PATH.

---

## 2. Bot Telegram

1. Chat ke [@BotFather](https://t.me/BotFather) → `/newbot` → simpan **token**-nya.
2. Kirim satu pesan apa saja ke bot barumu.
3. Buka `https://api.telegram.org/bot<TOKEN>/getUpdates` di browser, cari `"chat":{"id":123456789`.
   Angka itu **chat id** kamu.
4. Di BotFather: `/setprivacy` → **Disable** tidak diperlukan untuk chat pribadi, jadi biarkan saja.

---

## 3. Credential di n8n

Buat lima credential berikut. Nama harus **persis** seperti di tabel supaya cocok dengan workflow.

| Nama credential | Tipe | Isi |
|---|---|---|
| `Telegram — Notulensi Bot` | Telegram API | Access Token dari BotFather |
| `Groq API` | Header Auth | Name: `Authorization` · Value: `Bearer gsk_...` |
| `OpenAI Whisper Fallback` | Header Auth | Name: `Authorization` · Value: `Bearer sk-...` |
| `LLM Provider` | Header Auth | Name: `Authorization` · Value: `Bearer sk-or-v1-...` (key OpenRouter) |
| `Render Service` | Header Auth | Name: `Authorization` · Value: `Bearer <SERVICE_TOKEN>` |

Cara buat Header Auth credential di n8n: **Credentials → New → Header Auth**, isi `Name` =
`Authorization`, `Value` = `Bearer <key kamu>` (spasi setelah `Bearer` wajib).

`LLM Provider` diisi key **OpenRouter**-mu — ini yang dipakai node Config secara default
(`llm_base_url: https://openrouter.ai/api/v1`). Kalau nanti pindah ke provider lain yang bukan
OpenRouter, ganti isi credential ini plus `llm_base_url`/`llm_model` di node Config — lihat bagian
[Provider LLM](../README.md#provider-llm-openrouter-default) di README.

Kalau provider LLM-mu tidak memakai skema `Authorization: Bearer`, ubah Name/Value credential
`LLM Provider` sesuai yang diminta providernya — struktur workflow tidak perlu disentuh.

Tidak punya key OpenAI? Buat saja credential `OpenAI Whisper Fallback` dengan nilai dummy. Jalur
fallback hanya dipakai kalau Groq gagal, dan kegagalannya tetap berujung pesan error yang jelas ke
Telegram.

---

## 4. Import workflow

1. n8n → **Workflows → Import from File** → pilih `n8n/voice-to-mindmap.workflow.json`.
2. Workflow masuk dengan nama **Voice to Mindmap**, kondisi non-aktif.
3. **Pilih ulang credential di tiap node yang butuh.** File workflow memakai id credential
   placeholder (`REPLACE_..._CREDENTIAL_ID`), jadi n8n tidak selalu bisa mencocokkannya otomatis.
   Node yang perlu dicek:

   - Telegram: `Telegram Trigger`, `Download Audio`, dan semua node `Telegram: Kirim ...`
   - Groq: `Transcribe (Groq)`
   - OpenAI: `Transcribe (OpenAI Fallback)`
   - LLM Provider: `LLM: Correct Terms`, `LLM: Generate Outline`, `LLM: Generate Outline (Retry)`
   - Render Service: `Prepare Audio`, `Download Part`, `Download Part (Fallback)`, `Render Mindmap`

---

## 5. Isi node Config

Buka node **Config** (tepat setelah trigger). Semua setelan ada di sini.

| Field | Isi |
|---|---|
| `allowed_chat_ids` | chat id kamu dari langkah 2. Beberapa id dipisah koma. |
| `render_base_url` | URL render service, **tanpa garis miring di akhir** |
| `llm_base_url` | default `https://openrouter.ai/api/v1` — tanpa `/chat/completions`, tanpa garis miring di akhir |
| `llm_model` | default `google/gemini-3.1-flash-lite` — cek id terbaru di <https://openrouter.ai/models> |
| `llm_json_mode` | `true` (default) — Gemini 3.1 Flash-Lite lewat OpenRouter sudah teruji mendukung `response_format: json_object` |
| `groq_model` | `whisper-large-v3` |
| `transcribe_language` | `id` |
| `mindmap_width` / `mindmap_theme` | lebar PNG (px) dan `light` / `dark` |
| `max_transcript_inline` | di atas ini transkrip dikirim sebagai file `.txt` |

> `allowed_chat_ids` default-nya `000000000` — selama belum diganti, bot tidak akan merespons
> siapa pun. Itu disengaja.

---

## 6. Uji coba

1. **Save** lalu **Activate** workflow.
2. Kirim voice note pendek (10–20 detik) ke bot.
3. Balasan yang diharapkan, berurutan: gambar mind map → ringkasan → transkrip.

Kalau ada yang gagal, bot mengirim pesan error yang menyebut tahapnya. Buka **Executions** di n8n
untuk melihat detail node yang merah.

---

## 7. Pemakaian harian

1. Rekam di **NotelyVoice** (jalan di background).
2. Selesai merekam → **Share** → **Telegram** → pilih bot.
3. Tunggu balasan.

---

## Troubleshooting

| Gejala | Penyebab yang paling sering |
|---|---|
| Bot diam total | `allowed_chat_ids` belum diisi, atau workflow belum di-Activate |
| "Gagal menyiapkan audio" | Render service mati / `render_base_url` salah / `SERVICE_TOKEN` beda antara service dan credential |
| "Transkripsi gagal" | Key Groq salah atau kuota habis; cek node `Transcribe (Groq)` di Executions |
| "Ringkasan gagal" | `llm_base_url` atau `llm_model` salah — cek response error di Executions |
| Ringkasan datang tanpa mind map | LLM mengirim JSON rusak dua kali berturut-turut, atau render service timeout. Ringkasan tetap dikirim; ini perilaku yang disengaja. |
| Mind map terpotong / terlalu kecil | Naikkan `mindmap_width`, atau naikkan `RENDER_MAX_HEIGHT` di env render service |
| Nama brand tetap salah eja | Tambahkan ke `n8n/glossary.json`, jalankan `npm test` di folder `n8n/`, import ulang workflow |
| Container render gagal start | RAM kurang untuk Chrome headless — naikkan ke ≥ 1 GB |

---

## Lampiran: API render service

Semua endpoint selain `/healthz` butuh header `Authorization: Bearer <SERVICE_TOKEN>`.

| Endpoint | Keterangan |
|---|---|
| `GET /healthz` | Cek hidup, tanpa auth |
| `POST /render` | Body `{ markdown }` atau `{ outline, title }`, plus `width`, `scale`, `theme` opsional → `image/png` |
| `POST /audio/prepare` | `multipart/form-data` field `file` → `{ id, totalParts, durationSec, compressed, parts: [{ index, url, sizeBytes }] }` |
| `GET /audio/:id/:index` | Unduh satu potongan audio |
| `DELETE /audio/:id` | Hapus bundle lebih awal (kalau tidak, terhapus sendiri setelah `AUDIO_TTL_MS`) |

---

## Lampiran: mengaktifkan logging riwayat (v2)

PRD menandai ini nice-to-have dan **belum dipasang di workflow**. Skema tabelnya sudah siap:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Untuk memakainya, tambahkan node Postgres (insert ke `voice_notes`) setelah
`Telegram: Kirim Ringkasan`, dengan data dari `$('Parse Correction')` dan `$('Outline to Markdown')`.
