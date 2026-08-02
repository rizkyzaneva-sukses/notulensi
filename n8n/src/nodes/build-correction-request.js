// Susun body request LLM untuk koreksi istilah.
// Transkrip adalah input bebas, jadi body-nya dirakit sebagai objek lalu
// di-JSON.stringify() di sini dan dikirim sebagai Raw body oleh HTTP Request node.
const SYSTEM_PROMPT = __INJECT_CORRECT_TERMS_PROMPT__;

const config = $('Config').first().json;
const source = $input.first().json;
const transcript = String(source.transcript_raw ?? '').trim();

const body = {
  model: config.llm_model,
  temperature: Number(config.llm_temperature_correct ?? 0.1),
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: transcript },
  ],
};

return [
  {
    json: {
      ...source,
      llm_url: `${String(config.llm_base_url).replace(/\/+$/, '')}/chat/completions`,
      body: JSON.stringify(body),
    },
  },
];
