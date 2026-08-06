# Penyaji file untuk Telegram Bot API self-hosted.
#
# Server telegram-bot-api HANYA melayani URL yang diawali "/bot" (lihat
# HttpConnection.cpp di repo tdlib/telegram-bot-api) — tidak ada route /file/
# sama sekali. File hasil download ditulis ke disk saja, dan menyajikannya
# lewat HTTP adalah tanggung jawab kita. Container ini yang mengerjakan itu.
FROM nginx:1.27-alpine

# Worker dijalankan sebagai root karena telegram-bot-api menulis file dengan
# mode 0640 milik user internalnya sendiri — user `nginx` tidak akan bisa
# membacanya. Container ini hanya membaca & menyajikan satu direktori, tidak
# menjalankan kode lain, jadi dampaknya terbatas.
RUN sed -i 's/^user .*/user root;/' /etc/nginx/nginx.conf

# Template diproses envsubst oleh entrypoint bawaan image nginx saat start,
# sehingga ${FILES_TOKEN} terisi dari environment variable.
COPY default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80
