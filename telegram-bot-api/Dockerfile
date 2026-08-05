# Telegram Bot API self-hosted (tdlib/telegram-bot-api resmi) — dipakai supaya
# bot bisa download file audio > 20 MB, batas default api.telegram.org.
# Referensi: https://github.com/tdlib/telegram-bot-api

FROM debian:bookworm AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      cmake \
      g++ \
      make \
      zlib1g-dev \
      libssl-dev \
      gperf \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --recursive https://github.com/tdlib/telegram-bot-api.git .

# Build TDLib berat & butuh RAM lumayan besar — paralelisme dibatasi (-j2)
# supaya tidak OOM di VPS kecil. Naikkan kalau VPS-nya punya RAM lebih longgar.
# cmake --target install menaruh binary di /usr/local/bin/telegram-bot-api.
RUN mkdir build && cd build \
    && cmake -DCMAKE_BUILD_TYPE=Release .. \
    && cmake --build . --target install -- -j2

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      libssl3 \
      zlib1g \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --home-dir /data botapi

COPY --from=build /usr/local/bin/telegram-bot-api /usr/local/bin/telegram-bot-api

RUN mkdir -p /data/work /data/tmp && chown -R botapi:botapi /data
USER botapi

EXPOSE 8081

# --api-id / --api-hash otomatis dibaca dari env TELEGRAM_API_ID / TELEGRAM_API_HASH
# kalau tidak dikirim sebagai argumen (perilaku bawaan binary-nya).
# --local WAJIB lewat argumen — tidak ada env var untuk flag ini — supaya limit
# download/upload standar (20MB/50MB) dihilangkan (jadi sampai 2000MB).
ENTRYPOINT ["telegram-bot-api", "--local", "--dir=/data/work", "--temp-dir=/data/tmp", "--http-port=8081"]
