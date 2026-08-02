-- Skema riwayat Voice-to-Mindmap (fitur v2 / nice-to-have).
-- MVP-nya stateless — tabel ini baru dipakai kalau logging riwayat diaktifkan.
--
--   psql "$DATABASE_URL" -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS voice_notes (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_chat_id     text        NOT NULL,
    telegram_message_id  bigint,
    audio_duration_sec   integer     NOT NULL DEFAULT 0,
    audio_part_count     integer     NOT NULL DEFAULT 1,
    transcript_raw       text        NOT NULL DEFAULT '',
    transcript_corrected text        NOT NULL DEFAULT '',
    title                text,
    summary              text,
    mindmap_outline      jsonb,
    mindmap_image_url    text,
    whisper_provider     text,
    llm_provider         text,
    llm_model            text,
    created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE voice_notes IS
    'Riwayat tiap rekaman yang diproses: transkrip, ringkasan, outline, dan link mind map.';

CREATE INDEX IF NOT EXISTS voice_notes_chat_created_idx
    ON voice_notes (telegram_chat_id, created_at DESC);

-- Pencarian teks bebas di transkrip yang sudah dikoreksi.
CREATE INDEX IF NOT EXISTS voice_notes_transcript_fts_idx
    ON voice_notes USING gin (to_tsvector('simple', transcript_corrected));

-- Telegram message id unik per chat — mencegah baris ganda kalau workflow
-- dijalankan ulang untuk pesan yang sama.
CREATE UNIQUE INDEX IF NOT EXISTS voice_notes_chat_message_key
    ON voice_notes (telegram_chat_id, telegram_message_id)
    WHERE telegram_message_id IS NOT NULL;
