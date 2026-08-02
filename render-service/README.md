# Render Service

Micro-service pendamping workflow n8n Voice-to-Mindmap. Dua tugas:

1. **Render mind map** — markdown heading → PNG, memakai [markmap](https://markmap.js.org/) yang
   di-render di Chrome headless (Puppeteer). Bundle d3 & markmap-view dibaca dari `node_modules`,
   jadi tidak ada permintaan ke CDN saat render.
2. **Penyiapan audio** — menormalkan audio dari Telegram supaya siap dikirim ke Whisper API:
   lolos apa adanya kalau sudah kecil & formatnya didukung, dikompres ke opus 16 kHz mono kalau
   kebesaran, dan dipotong jadi beberapa part kalau setelah dikompres masih di atas batas 24 MB.

## Menjalankan

```bash
npm install
npm run smoke                                   # render contoh ke out/sample.png (tanpa server)
SERVICE_TOKEN=token-lokal-minimal-16-char npm start
```

`npm run smoke` cuma butuh Node + Chrome hasil `npm install`. Endpoint `/audio/prepare` butuh
`ffmpeg` dan `ffprobe` di PATH — keduanya sudah termasuk di image Docker.

Konfigurasi lewat environment variable, lihat [`.env.example`](.env.example). `SERVICE_TOKEN` wajib
diisi (minimal 16 karakter); tanpa itu service menolak start.

## Endpoint

Semua kecuali `/healthz` butuh header `Authorization: Bearer <SERVICE_TOKEN>`.

### `GET /healthz`

```json
{ "ok": true, "service": "notulensi-render-service", "uptimeSec": 120 }
```

### `POST /render` → `image/png`

```json
{ "markdown": "# Judul\n\n## Cabang", "width": 1600, "scale": 2, "theme": "light" }
```

Alternatif tanpa markdown: `{ "outline": [{ "title": "A", "children": [...] }], "title": "Judul" }`.
Tinggi gambar mengikuti aspect ratio isi mind map, dibatasi `RENDER_MIN_HEIGHT`/`RENDER_MAX_HEIGHT`.

### `POST /audio/prepare` (multipart, field `file`)

```json
{
  "ok": true,
  "id": "b757a1d6-…",
  "totalParts": 1,
  "durationSec": 95,
  "originalSizeBytes": 512000,
  "compressed": false,
  "parts": [{ "index": 0, "fileName": "part-000.ogg", "sizeBytes": 512000, "startSec": 0, "url": "https://…/audio/b757a1d6-…/0" }]
}
```

`url` disusun dari `PUBLIC_BASE_URL`, jadi env itu harus berisi URL yang bisa dijangkau n8n.

### `GET /audio/:id/:index`

Mengunduh satu potongan. `Content-Disposition` membawa nama file berekstensi benar — n8n memakainya
sebagai nama binary, dan Whisper API menentukan format dari ekstensi itu.

### `DELETE /audio/:id`

Hapus bundle lebih awal. Kalau tidak dipanggil, janitor menghapusnya sendiri setelah `AUDIO_TTL_MS`
(default 30 menit).

## Catatan operasional

- Maksimal 2 render berjalan bersamaan; sisanya antre. Sediakan RAM ≥ 1 GB untuk Chrome headless.
- Satu instance Chrome dipakai ulang antar request dan dinyalakan ulang otomatis kalau mati.
- Pemotongan audio memakai `ffmpeg -f segment -c copy` **tanpa overlap**, jadi ada kemungkinan satu
  kata terpotong di batas potongan. Ini baru terjadi pada audio di atas ~3,5 jam.
- `/data/audio` sebaiknya berupa volume, bukan filesystem container, supaya restart tidak menghapus
  bundle yang sedang diproses.
