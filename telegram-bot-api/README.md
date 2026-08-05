# Telegram Bot API (self-hosted)

Bukan bagian dari workflow n8n — ini server proxy opsional ke Telegram, dipakai supaya bot bisa
**download file audio > 20 MB** (batas keras di server cloud resmi `api.telegram.org`).

Buildnya meng-compile [`tdlib/telegram-bot-api`](https://github.com/tdlib/telegram-bot-api) resmi
langsung dari source (repo itu tidak menyediakan Dockerfile sendiri). Compile TDLib berat: butuh
RAM lumayan besar dan bisa makan waktu puluhan menit — ini hal yang wajar, bukan tanda ada yang
salah.

## Kredensial

Beda dari token bot BotFather. Butuh `api_id` + `api_hash` dari akun Telegram pribadi:

1. Login ke <https://my.telegram.org/apps>
2. **Create new application** — isi bebas, Platform pilih **Other**
3. Catat `App api_id` dan `App api_hash` — perlakukan `api_hash` seperti password, jangan ditaruh di
   file/chat manapun yang bukan tempat aman

## Deploy di EasyPanel

1. **Create Service → App**, nama misal `notulensi-bot-api`.
2. **Source**: repo ini, **Build path** `telegram-bot-api`, **Build method: Dockerfile**.
3. **Environment** (lihat [`.env.example`](.env.example)):
   ```
   TELEGRAM_API_ID=<dari my.telegram.org>
   TELEGRAM_API_HASH=<dari my.telegram.org>
   ```
4. **Domains**: aktifkan domain + HTTPS, port `8081`.
5. **Mounts**: tambahkan volume ke `/data` (working directory server, jangan biarkan jadi filesystem
   container biasa — restart akan menghapus state login bot ke server ini).
6. **Resources**: RAM ≥ 2 GB **untuk proses build**-nya (compile TDLib). Setelah jadi, proses
   berjalannya sendiri ringan.

## Verifikasi

```bash
curl https://notulensi-bot-api.domain-kamu.com/bot<TOKEN_BOT>/getMe
```

Harus balas JSON info bot (`"ok":true,"result":{...}`), bukan error.

## Menyambungkan ke n8n

Di n8n → **Credentials** → credential `Telegram — Notulensi Bot` → field **Base URL**, ganti dari
`https://api.telegram.org` jadi `https://notulensi-bot-api.domain-kamu.com` → **Save**, pastikan
"Connection tested successfully" tetap muncul.

Setelah disambungkan, download file besar (>20 MB, sampai 2000 MB) akan otomatis lewat server ini —
tidak ada perubahan apa pun yang perlu dilakukan di workflow `n8n/voice-to-mindmap.workflow.json`.

## Catatan

- Flag `--local` di [`Dockerfile`](Dockerfile) yang menghilangkan limit ukuran — ini murni argumen
  command, bukan environment variable, karena binary-nya memang tidak menyediakan env var untuk
  flag ini.
- Kalau bot pernah dipakai lewat `api.telegram.org` sebelumnya lalu pindah ke sini, Telegram
  merekomendasikan logout dulu dari server lama (`logOut` method) supaya tidak ada update yang
  terlewat saat pindah — biasanya tidak masalah untuk kasus dipakai satu server saja seperti ini.
