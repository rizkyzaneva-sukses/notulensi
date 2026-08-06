# Bot API Files

Penyaji file untuk [`telegram-bot-api/`](../telegram-bot-api/) self-hosted. Cuma nginx dengan satu
folder dan satu pemeriksaan token — tidak ada kode aplikasi.

## Kenapa perlu

Server `telegram-bot-api` **hanya melayani URL yang diawali `/bot`**. Route `/file/...` tidak ada
sama sekali — cek sendiri di `HttpConnection.cpp` upstream:

```cpp
if (!url_path_parser.try_skip("/bot")) {
    return send_http_error(404, "Not Found");
}
```

Jadi `getFile` hanya memberitahu **lokasi file di disk server**; menyajikannya lewat HTTP memang
tugas kita. Tanpa service ini, node `Download Audio` di n8n selalu dapat
`{"ok":false,"error_code":404,"description":"Not Found"}` — bukan karena salah setelan, tapi karena
endpoint yang dituju memang tidak pernah ada.

Karena penyajiannya lewat HTTP, service ini **tidak harus satu VPS dengan n8n** — cukup satu VPS
dengan `telegram-bot-api`, karena keduanya berbagi folder lewat bind mount.

## Deploy di EasyPanel

Harus di **VPS yang sama** dengan service `telegram-bot-api`.

1. **Create Service → App**, nama misal `notulensi-bot-api-files`.
2. **Source**: repo ini, **Build path** `bot-api-files`, **Build method: Dockerfile**.
3. **Environment** (lihat [`.env.example`](.env.example)):
   ```
   FILES_TOKEN=<openssl rand -hex 24>
   ```
4. **Mounts** — **Bind Mount**, host path-nya **sama persis** dengan yang dipakai
   `telegram-bot-api`:
   ```
   Host Path:  /data/notulensi-bot-api
   Mount Path: /srv/data
   ```
   Perhatikan mount path-nya `/srv/data`, bukan `/data`. nginx memakai `root /srv`, sehingga URL
   bisa memakai `file_path` dari `getFile` apa adanya (bentuknya `/data/work/...`) tanpa perlu
   dipotong di sisi n8n.
5. **Domains**: aktifkan domain + HTTPS, port `80`.

## Verifikasi

Ambil satu `file_path` dari `getFile` lebih dulu:

```bash
curl "https://<domain-bot-api>/bot<TOKEN_BOT>/getFile?file_id=<FILE_ID>"
# → {"ok":true,"result":{...,"file_path":"/data/work/<bot>/music/file_0.m4a"}}
```

Lalu unduh lewat service ini:

```bash
curl -H "Authorization: Bearer $FILES_TOKEN" \
  "https://<domain-files>/data/work/<bot>/music/file_0.m4a" -o tes.m4a
```

Tanpa header itu harus balas `401`.

## Menyambungkan ke n8n

1. Credential baru: **`Bot API Files`**, tipe Header Auth, `Name` = `Authorization`,
   `Value` = `Bearer <FILES_TOKEN>`.
2. Node **Config** → `bot_api_files_base_url` = domain service ini, **tanpa garis miring di akhir**.
3. Node `Download Audio` di workflow memakai keduanya.

## Catatan

- **Worker nginx berjalan sebagai root.** `telegram-bot-api` menulis file dengan mode `0640` milik
  user internalnya, jadi user `nginx` tidak akan bisa membacanya. Container ini hanya membaca satu
  direktori dan tidak menjalankan kode lain, jadi dampaknya terbatas.
- **Log akses dimatikan** karena path file memuat token bot sebagai nama folder.
- Folder itu tumbuh terus — `telegram-bot-api` tidak menghapus file lamanya sendiri. Kalau disk mulai
  penuh, hapus isi `/data/notulensi-bot-api/work/*/` yang sudah lama.
