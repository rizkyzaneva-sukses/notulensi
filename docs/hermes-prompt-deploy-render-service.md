# Prompt untuk Hermes — Deploy render-service ke EasyPanel

> **Status: deployment sudah selesai (Agustus 2026).** Service `notulensi-render` sudah live
> di `https://notulen.maulanacorp.my.id` (EasyPanel, project *creative*), `/healthz` dan `/render`
> sudah dites. `SERVICE_TOKEN` disimpan di password manager Rizky dan credential *Render Service*
> di n8n — tidak dicatat di file ini.
>
> File ini disimpan sebagai template untuk re-deploy / migrasi. Isi ulang 4 titik `<...>` di
> bagian atas kalau dipakai lagi. **Jangan pernah tempel token asli ke file ini** — repo GitHub
> `rizkyzaneva-sukses/notulensi` bersifat publik.

---

Tempel prompt di bawah ini ke Hermes. Isi dulu 4 titik `<...>` di bagian atas sebelum dikirim.

---

## Konteks

Saya (Rizky) punya repo GitHub berisi micro-service Node.js bernama `render-service`, di dalam
folder `render-service/` repo tersebut. Service ini punya `Dockerfile` sendiri yang sudah siap
pakai — tugasmu HANYA deploy-nya ke EasyPanel yang sudah jalan di VPS saya, bukan menulis ulang
kodenya.

Fungsi service: menerima outline mind map dari workflow n8n dan mengubahnya jadi gambar PNG
(pakai Chrome headless), plus menyiapkan file audio sebelum ditranskripsi. Dia HTTP API biasa,
port 3000 di dalam container.

## Info yang saya berikan

- Repo GitHub: `<isi: contoh https://github.com/rizkyzaneva-sukses/notulensi>`
- Build path di dalam repo: `render-service`
- URL/IP EasyPanel dashboard saya: `<isi: contoh http://43.129.38.56:3000, masukkan di project creative>`
- Domain yang mau dipakai untuk service ini: `<isi: contoh notulen.mrrizky.my.id>`

Saya sudah login ke EasyPanel di browser ini / silakan minta saya login kalau perlu — jangan
pernah minta saya ketik ulang password di tempat lain.

## Yang perlu kamu lakukan

1. Buka dashboard EasyPanel di URL yang saya beri.
2. Buat **App/Service baru**:
   - Source: GitHub repo yang saya beri
   - Build path: `render-service`
   - Build method: **Dockerfile** (pakai `render-service/Dockerfile` yang sudah ada di repo, jangan dibuat ulang)
3. Generate token acak yang aman (32+ karakter hex, misal pakai `openssl rand -hex 24` kalau kamu
   punya akses shell, atau generator token acak lain) untuk dipakai sebagai `SERVICE_TOKEN` di
   bawah. **Tampilkan token ini ke saya di akhir supaya saya bisa masukkan ke n8n** — jangan
   simpan di tempat lain, dan JANGAN tulis ke file dokumentasi mana pun.
4. Isi Environment Variables:
   ```
   SERVICE_TOKEN=<token acak yang kamu generate di langkah 3 — jangan tulis di file>
   PUBLIC_BASE_URL=https://<domain yang saya beri>
   PORT=3000
   AUDIO_WORK_DIR=/data/audio
   ```
5. Tambahkan **persistent volume/mount** ke path `/data/audio` di dalam container (potongan audio
   sementara ditulis ke sana).
6. Aktifkan **domain** yang saya beri, dengan **HTTPS/SSL** aktif, mengarah ke port `3000`.
7. Pastikan resource RAM service ini minimal **1 GB** — dia menjalankan Chrome headless untuk
   render gambar, dan lambat/crash kalau RAM kurang.
8. Deploy, tunggu build selesai, lalu verifikasi dengan buka:
   `https://<domain yang saya beri>/healthz`
   Harus muncul JSON seperti `{"ok":true,"service":"notulensi-render-service",...}`.
9. Verifikasi endpoint render juga jalan (ganti `<TOKEN>` dengan token dari langkah 3):
   ```
   curl -X POST https://<domain yang saya beri>/render \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"markdown":"# Tes\n\n## Cabang A\n\n## Cabang B"}' \
     -o tes.png
   ```
   `tes.png` harus terbuka sebagai gambar mind map sederhana, bukan pesan error.

## Laporkan ke saya di akhir

- URL publik service: `https://<domain>`
- `SERVICE_TOKEN` yang di-generate — kirim ke saya via chat (saya tempel ke password manager & n8n), **jangan tulis ke file dokumentasi apa pun**
- Konfirmasi `/healthz` dan `/render` sudah dites dan berhasil
- Kalau ada langkah yang gagal atau butuh keputusan saya (nama domain belum ada DNS-nya, dsb), berhenti dan tanya — jangan menebak.
