// Susun body request ke yt-service.
// URL-nya berasal dari pesan Telegram — input bebas — jadi dirakit sebagai
// objek lalu di-JSON.stringify() di sini dan dikirim sebagai Raw body, sama
// seperti body LLM. Tanda kutip di URL tidak akan pernah merusak strukturnya.
const config = $('Config').first().json;
const source = $input.first().json;

const body = { url: String(source.youtube_url ?? '').trim() };

return [
  {
    json: {
      ...source,
      yt_url: `${String(config.yt_service_base_url).replace(/\/+$/, '')}/youtube/prepare`,
      body: JSON.stringify(body),
    },
  },
];
