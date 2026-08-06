#!/usr/bin/env node
// Merakit voice-to-mindmap.workflow.json dari potongan-potongan di ./src.
// Kode Code node & prompt disimpan sebagai file terpisah supaya bisa dibaca dan
// di-review dengan wajar, lalu diinline ke JSON workflow saat build.
//
//   node build-workflow.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');

// ---------------------------------------------------------------- glossary --

const glossary = JSON.parse(read('glossary.json'));
const glossaryTerms = [...glossary.brands, ...glossary.terms];
const glossaryBlock = [
  `Brand & nama produk: ${glossary.brands.join(', ')}`,
  `Istilah bisnis: ${glossary.terms.join(', ')}`,
].join('\n');

// Whisper `prompt` hanya menampung ~224 token, jadi dipangkas.
const whisperPrompt = `Transkrip rapat bisnis Bahasa Indonesia. Ejaan yang benar: ${glossaryTerms.join(', ')}.`.slice(
  0,
  480,
);

const prompt = (name) => read('src', 'prompts', `${name}.md`).replace('{{GLOSSARY}}', glossaryBlock).trim();

const CORRECT_TERMS_PROMPT = prompt('correct-terms');
const GENERATE_OUTLINE_PROMPT = prompt('generate-outline');

// --------------------------------------------------------------- code nodes --

function code(fileName, replacements = {}) {
  let source = read('src', 'nodes', fileName);
  for (const [token, value] of Object.entries(replacements)) {
    if (!source.includes(token)) {
      throw new Error(`Token ${token} tidak ditemukan di ${fileName}`);
    }
    source = source.replaceAll(token, JSON.stringify(value));
  }
  const leftover = source.match(/__INJECT_[A-Z_]+__/);
  if (leftover) throw new Error(`Token ${leftover[0]} belum diisi di ${fileName}`);
  return source;
}

// ------------------------------------------------------------ node helpers --

const nodes = [];
const connections = {};

const nodeId = (name) => {
  const hex = createHash('md5').update(name).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

function add(node) {
  if (nodes.some((existing) => existing.name === node.name)) {
    throw new Error(`Nama node duplikat: ${node.name}`);
  }
  nodes.push({ id: nodeId(node.name), ...node });
  return node.name;
}

function connect(from, to, { output = 0, input = 0 } = {}) {
  const entry = (connections[from] ??= { main: [] });
  while (entry.main.length <= output) entry.main.push([]);
  entry.main[output].push({ node: to, type: 'main', index: input });
}

const CRED = {
  telegram: { telegramApi: { id: 'REPLACE_TELEGRAM_CREDENTIAL_ID', name: 'Telegram — Notulensi Bot' } },
  groq: { httpHeaderAuth: { id: 'REPLACE_GROQ_CREDENTIAL_ID', name: 'Groq API' } },
  openai: { httpHeaderAuth: { id: 'REPLACE_OPENAI_CREDENTIAL_ID', name: 'OpenAI Whisper Fallback' } },
  llm: { httpHeaderAuth: { id: 'REPLACE_LLM_CREDENTIAL_ID', name: 'LLM Provider' } },
  render: { httpHeaderAuth: { id: 'REPLACE_RENDER_CREDENTIAL_ID', name: 'Render Service' } },
};

const codeNode = (name, position, jsCode) => ({
  name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position,
  parameters: { mode: 'runOnceForAllItems', jsCode },
});

const booleanIf = (name, position, expression) => ({
  name,
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position,
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [
        {
          id: nodeId(`${name}-cond`),
          leftValue: expression,
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  },
});

const stageNode = (name, position, stage, message) => ({
  name,
  type: 'n8n-nodes-base.set',
  typeVersion: 3.4,
  position,
  parameters: {
    mode: 'manual',
    includeOtherFields: true,
    assignments: {
      assignments: [
        { id: nodeId(`${name}-stage`), name: 'error_stage', value: stage, type: 'string' },
        { id: nodeId(`${name}-message`), name: 'error_message', value: message, type: 'string' },
      ],
    },
    options: {},
  },
});

const telegramSendMessage = (name, position, { chatId, text, caption, messageThreadId }) => ({
  name,
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position,
  parameters: {
    resource: 'message',
    operation: 'sendMessage',
    chatId,
    text: text ?? caption,
    additionalFields: {
      parse_mode: 'HTML',
      appendAttribution: false,
      // Expression-nya resolve ke undefined untuk chat pribadi / grup tanpa
      // topic — n8n melewatkan field ini dari request kalau begitu, jadi
      // aman dipasang selalu, tidak cuma untuk grup dengan topic.
      message_thread_id: messageThreadId,
    },
  },
  credentials: CRED.telegram,
});

const transcribeNode = (name, position, { urlField, modelField, credentials }) => ({
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position,
  parameters: {
    method: 'POST',
    url: `={{ $('Config').first().json.${urlField} }}`,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    contentType: 'multipart-form-data',
    bodyParameters: {
      parameters: [
        { parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' },
        { parameterType: 'formData', name: 'model', value: `={{ $('Config').first().json.${modelField} }}` },
        {
          parameterType: 'formData',
          name: 'language',
          value: "={{ $('Config').first().json.transcribe_language }}",
        },
        { parameterType: 'formData', name: 'response_format', value: 'json' },
        { parameterType: 'formData', name: 'temperature', value: '0' },
        { parameterType: 'formData', name: 'prompt', value: whisperPrompt },
      ],
    },
    options: { timeout: 600000 },
  },
  credentials,
  retryOnFail: true,
  maxTries: 2,
  waitBetweenTries: 2000,
});

const rawJsonPost = (name, position, { url, credentials, timeout = 180000, responseFile = false }) => ({
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position,
  parameters: {
    method: 'POST',
    url,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    contentType: 'raw',
    rawContentType: 'application/json',
    // Body sudah di-JSON.stringify() di Code node sebelumnya — dikirim apa adanya
    // sebagai raw body supaya teks transkrip tidak pernah merusak struktur JSON.
    body: '={{ $json.body }}',
    options: {
      timeout,
      ...(responseFile
        ? { response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } }
        : {}),
    },
  },
  credentials,
  retryOnFail: true,
  maxTries: 2,
  waitBetweenTries: 2000,
});

// ------------------------------------------------------------------- nodes --

add({
  name: 'Telegram Trigger',
  type: 'n8n-nodes-base.telegramTrigger',
  typeVersion: 1.2,
  position: [-620, 300],
  parameters: { updates: ['message'], additionalFields: {} },
  credentials: CRED.telegram,
  webhookId: 'a7f1c0de-4b21-4a90-9c1f-voice2mindmap',
});

add({
  name: 'Config',
  type: 'n8n-nodes-base.set',
  typeVersion: 3.4,
  position: [-400, 300],
  parameters: {
    mode: 'manual',
    includeOtherFields: true,
    assignments: {
      assignments: [
        // --- akses ---
        { id: nodeId('cfg-chat'), name: 'allowed_chat_ids', value: '000000000', type: 'string' },
        // --- transkripsi ---
        {
          id: nodeId('cfg-groq-url'),
          name: 'groq_url',
          value: 'https://api.groq.com/openai/v1/audio/transcriptions',
          type: 'string',
        },
        { id: nodeId('cfg-groq-model'), name: 'groq_model', value: 'whisper-large-v3', type: 'string' },
        {
          id: nodeId('cfg-openai-url'),
          name: 'openai_url',
          value: 'https://api.openai.com/v1/audio/transcriptions',
          type: 'string',
        },
        { id: nodeId('cfg-openai-model'), name: 'openai_model', value: 'whisper-1', type: 'string' },
        { id: nodeId('cfg-lang'), name: 'transcribe_language', value: 'id', type: 'string' },
        // --- LLM (ganti 3 field ini untuk pindah provider) ---
        // Default: OpenRouter — 1 API key untuk banyak provider (Gemini, GPT, Claude, dll),
        // tinggal ganti `llm_model` tanpa ganti base_url/credential.
        {
          id: nodeId('cfg-llm-url'),
          name: 'llm_base_url',
          value: 'https://openrouter.ai/api/v1',
          type: 'string',
        },
        { id: nodeId('cfg-llm-model'), name: 'llm_model', value: 'google/gemini-3.1-flash-lite', type: 'string' },
        { id: nodeId('cfg-llm-json'), name: 'llm_json_mode', value: true, type: 'boolean' },
        { id: nodeId('cfg-llm-t1'), name: 'llm_temperature_correct', value: 0.1, type: 'number' },
        { id: nodeId('cfg-llm-t2'), name: 'llm_temperature_outline', value: 0.3, type: 'number' },
        // --- render service (tanpa trailing slash) ---
        {
          id: nodeId('cfg-render-url'),
          name: 'render_base_url',
          value: 'https://notulensi-render.contoh.com',
          type: 'string',
        },
        { id: nodeId('cfg-mm-width'), name: 'mindmap_width', value: 1600, type: 'number' },
        { id: nodeId('cfg-mm-theme'), name: 'mindmap_theme', value: 'light', type: 'string' },
        // --- pengiriman ---
        { id: nodeId('cfg-inline'), name: 'max_transcript_inline', value: 3000, type: 'number' },
      ],
    },
    options: {},
  },
});

add(
  booleanIf(
    'Guard: Chat Diizinkan',
    [-180, 300],
    "={{ $('Config').first().json.allowed_chat_ids.split(',').map(v => v.trim()).filter(v => v).includes(String($json.message ? $json.message.chat.id : '')) }}",
  ),
);

add({
  name: 'Abaikan',
  type: 'n8n-nodes-base.noOp',
  typeVersion: 1,
  position: [40, 120],
  parameters: {},
});

add(codeNode('Extract Audio', [40, 300], code('extract-audio.js')));
add(booleanIf('Guard: Ada Audio', [260, 300], '={{ $json.has_audio }}'));

// Server Telegram Bot API self-hosted (mode --local) mengembalikan file_path
// sebagai path FILESYSTEM ABSOLUT, bukan path relatif yang bisa dipakai untuk
// download HTTP biasa — endpoint /file/... tidak melayani request di mode ini.
// Jadi ambil metadata dulu (getFile), lalu baca file-nya langsung dari disk
// yang di-share (volume sama) antara container bot-api dan container n8n ini.
add({
  name: 'Download Audio: Get File Info',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [480, 300],
  parameters: { resource: 'file', operation: 'get', fileId: '={{ $json.file_id }}' },
  credentials: CRED.telegram,
  onError: 'continueErrorOutput',
  retryOnFail: true,
  maxTries: 2,
  waitBetweenTries: 2000,
});

add({
  name: 'Download Audio: Read From Disk',
  type: 'n8n-nodes-base.readWriteFile',
  typeVersion: 1,
  position: [560, 300],
  parameters: {
    operation: 'read',
    fileSelector: '={{ $json.file_path }}',
    options: { dataPropertyName: 'data' },
  },
  onError: 'continueErrorOutput',
});

add({
  name: 'Prepare Audio',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [700, 300],
  parameters: {
    method: 'POST',
    url: "={{ $('Config').first().json.render_base_url }}/audio/prepare",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    contentType: 'multipart-form-data',
    bodyParameters: {
      parameters: [{ parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' }],
    },
    options: { timeout: 900000 },
  },
  credentials: CRED.render,
  onError: 'continueErrorOutput',
});

add({
  name: 'Split Parts',
  type: 'n8n-nodes-base.splitOut',
  typeVersion: 1,
  position: [920, 300],
  parameters: { fieldToSplitOut: 'parts', options: {} },
});

const downloadPart = (name, position, url) => ({
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position,
  parameters: {
    method: 'GET',
    url,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    options: {
      timeout: 300000,
      response: { response: { responseFormat: 'file', outputPropertyName: 'data' } },
    },
  },
  credentials: CRED.render,
  retryOnFail: true,
  maxTries: 2,
  waitBetweenTries: 2000,
});

add(downloadPart('Download Part', [1140, 300], '={{ $json.url }}'));

add({
  ...transcribeNode('Transcribe (Groq)', [1360, 300], {
    urlField: 'groq_url',
    modelField: 'groq_model',
    credentials: CRED.groq,
  }),
  onError: 'continueErrorOutput',
});

// Item pada error-output tidak membawa binary, jadi part-nya diunduh ulang
// sebelum dicoba ke provider cadangan.
add(downloadPart('Download Part (Fallback)', [1360, 520], "={{ $('Split Parts').item.json.url }}"));

add({
  ...transcribeNode('Transcribe (OpenAI Fallback)', [1580, 520], {
    urlField: 'openai_url',
    modelField: 'openai_model',
    credentials: CRED.openai,
  }),
  onError: 'continueErrorOutput',
});

// Kalau sebagian part berhasil di Groq dan sisanya baru berhasil di fallback,
// kedua jalur sama-sama membawa data. Tanpa Merge node, n8n akan menjalankan
// node berikutnya dua kali — dan Rizky menerima dua kali balasan.
add({
  name: 'Merge Transcript Parts',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [1800, 380],
  parameters: { mode: 'append', numberInputs: 2 },
});

add(codeNode('Merge Transcript', [2020, 300], code('merge-transcript.js')));
add(booleanIf('Guard: Transkrip Ada', [2240, 300], '={{ $json.has_transcript }}'));

add(
  codeNode(
    'Build Correction Request',
    [2460, 300],
    code('build-correction-request.js', { __INJECT_CORRECT_TERMS_PROMPT__: CORRECT_TERMS_PROMPT }),
  ),
);

add({
  ...rawJsonPost('LLM: Correct Terms', [2680, 300], {
    url: '={{ $json.llm_url }}',
    credentials: CRED.llm,
  }),
  onError: 'continueErrorOutput',
});

add(codeNode('Parse Correction', [2900, 300], code('parse-correction.js')));

add(
  codeNode(
    'Build Outline Request',
    [3120, 300],
    code('build-outline-request.js', {
      __INJECT_GENERATE_OUTLINE_PROMPT__: GENERATE_OUTLINE_PROMPT,
      __INJECT_RETRY_MODE__: false,
    }),
  ),
);

add({
  ...rawJsonPost('LLM: Generate Outline', [3340, 300], {
    url: '={{ $json.llm_url }}',
    credentials: CRED.llm,
  }),
  onError: 'continueErrorOutput',
});

add(
  codeNode(
    'Parse Outline',
    [3560, 300],
    code('parse-outline.js', { __INJECT_SOURCE_NODE__: 'Build Outline Request' }),
  ),
);

add(booleanIf('Guard: Outline Valid', [3780, 300], '={{ $json.outline_valid }}'));

add(
  codeNode(
    'Build Outline Retry Request',
    [3780, 560],
    code('build-outline-request.js', {
      __INJECT_GENERATE_OUTLINE_PROMPT__: GENERATE_OUTLINE_PROMPT,
      __INJECT_RETRY_MODE__: true,
    }),
  ),
);

add({
  ...rawJsonPost('LLM: Generate Outline (Retry)', [4000, 560], {
    url: '={{ $json.llm_url }}',
    credentials: CRED.llm,
  }),
  onError: 'continueErrorOutput',
});

add(
  codeNode(
    'Parse Outline Retry',
    [4220, 560],
    code('parse-outline.js', { __INJECT_SOURCE_NODE__: 'Build Outline Retry Request' }),
  ),
);

add(booleanIf('Guard: Outline Valid (Retry)', [4440, 560], '={{ $json.outline_valid }}'));

add(codeNode('Outline to Markdown', [4660, 300], code('outline-to-markdown.js')));

add({
  ...rawJsonPost('Render Mindmap', [4880, 300], {
    url: '={{ $json.render_url }}',
    credentials: CRED.render,
    timeout: 120000,
    responseFile: true,
  }),
  onError: 'continueErrorOutput',
});

add({
  name: 'Telegram: Kirim Mindmap',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [5100, 300],
  parameters: {
    resource: 'message',
    operation: 'sendPhoto',
    chatId: "={{ $('Extract Audio').first().json.chat_id }}",
    binaryData: true,
    binaryPropertyName: 'data',
    additionalFields: {
      caption: "={{ '🧠 ' + $('Outline to Markdown').first().json.title }}",
      appendAttribution: false,
      message_thread_id: "={{ $('Extract Audio').first().json.thread_id }}",
    },
  },
  credentials: CRED.telegram,
});

add(
  codeNode(
    'Build Summary Message',
    [5320, 300],
    code('build-summary-message.js', { __INJECT_WITH_MINDMAP__: true }),
  ),
);

add(
  telegramSendMessage('Telegram: Kirim Ringkasan', [5540, 300], {
    chatId: '={{ $json.chat_id }}',
    text: '={{ $json.summary_text }}',
    messageThreadId: '={{ $json.thread_id }}',
  }),
);

add(
  codeNode(
    'Build Summary Message (Tanpa Mindmap)',
    [5320, 760],
    code('build-summary-message.js', { __INJECT_WITH_MINDMAP__: false }),
  ),
);

add(
  telegramSendMessage('Telegram: Kirim Ringkasan (Tanpa Mindmap)', [5540, 760], {
    chatId: '={{ $json.chat_id }}',
    text: '={{ $json.summary_text }}',
    messageThreadId: '={{ $json.thread_id }}',
  }),
);

add(codeNode('Build Transcript Message', [5760, 520], code('build-transcript-message.js')));
add(booleanIf('Guard: Transkrip Panjang', [5980, 520], '={{ $json.is_file }}'));

add({
  name: 'Telegram: Kirim Transkrip (File)',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [6200, 420],
  parameters: {
    resource: 'message',
    operation: 'sendDocument',
    chatId: '={{ $json.chat_id }}',
    binaryData: true,
    binaryPropertyName: 'data',
    additionalFields: {
      caption: '📝 Transkrip lengkap',
      appendAttribution: false,
      message_thread_id: '={{ $json.thread_id }}',
    },
  },
  credentials: CRED.telegram,
});

add(
  telegramSendMessage('Telegram: Kirim Transkrip (Teks)', [6200, 620], {
    chatId: '={{ $json.chat_id }}',
    text: '={{ $json.transcript_text }}',
    messageThreadId: '={{ $json.thread_id }}',
  }),
);

// ------------------------------------------------------------- jalur error --

const stages = [
  ['Stage: Bukan Audio', [260, 1120], 'Bukan pesan suara', 'Kirim voice note atau file audio ya — pesan lain tidak diproses.'],
  ['Stage: Unduh Gagal', [480, 1120], 'Gagal mengunduh audio', 'File-nya tidak bisa diambil dari Telegram. Coba kirim ulang.'],
  ['Stage: Siapkan Audio', [700, 1120], 'Gagal menyiapkan audio', 'Render service tidak merespons saat memproses audio. Coba lagi sebentar.'],
  ['Stage: Transkripsi', [1360, 1120], 'Transkripsi gagal', 'Groq dan provider cadangan sama-sama gagal. Coba kirim ulang rekamannya.'],
  ['Stage: Transkrip Kosong', [2240, 1120], 'Tidak ada suara terdeteksi', 'Rekamannya hening atau cuma noise, jadi tidak ada yang bisa diringkas.'],
  ['Stage: Koreksi', [2680, 1120], 'Koreksi transkrip gagal', 'LLM tidak merespons. Coba kirim ulang atau ganti provider di node Config.'],
  ['Stage: Ringkasan', [3340, 1120], 'Ringkasan gagal', 'LLM tidak merespons saat membuat ringkasan. Coba kirim ulang.'],
];

for (const [name, position, stage, message] of stages) {
  add(stageNode(name, position, stage, message));
}

add(codeNode('Build Error Message', [4000, 1120], code('build-error-message.js')));

add(
  telegramSendMessage('Telegram: Kirim Error', [4220, 1120], {
    chatId: '={{ $json.chat_id }}',
    text: '={{ $json.error_text }}',
    messageThreadId: '={{ $json.thread_id }}',
  }),
);

// -------------------------------------------------------------- keterangan --

const stickies = [
  [
    [-640, 60],
    620,
    200,
    4,
    '## 1. Masuk & filter\nTrigger Telegram → node **Config** (semua setelan ada di sini) → whitelist `chat_id`.\n\nGanti provider LLM = ubah `llm_base_url`, `llm_model`, `llm_json_mode` di node Config, plus credential **LLM Provider**.',
  ],
  [
    [660, 60],
    1740,
    200,
    5,
    '## 2. Audio → transkrip\n**Prepare Audio** menormalkan audio (kompres opus 16k mono, potong jadi beberapa part kalau > 24MB), lalu tiap part ditranskripsi Groq Whisper. Kalau Groq gagal, part-nya diunduh ulang dan dicoba ke OpenAI Whisper.',
  ],
  [
    [2460, 60],
    2180,
    200,
    3,
    '## 3. Koreksi & outline\nBody request LLM dirakit di Code node dengan `JSON.stringify()` lalu dikirim sebagai **Raw body** — bukan "Specify Body: JSON" — supaya teks transkrip tidak pernah merusak struktur JSON.\n\nOutline JSON tidak valid → retry 1x → kalau tetap gagal, kirim ringkasan teks tanpa mind map.',
  ],
  [
    [4660, 60],
    1760,
    200,
    6,
    '## 4. Render & balas\nOutline → markdown heading → render service (markmap + Puppeteer) → PNG. Balasan ke Telegram: mind map, ringkasan, lalu transkrip bersih (jadi file .txt kalau panjang).',
  ],
  [
    [240, 880],
    4000,
    200,
    2,
    '## Jalur error\nSetiap tahap punya error output sendiri yang bermuara ke satu pesan Telegram — tidak ada kegagalan yang diam-diam.',
  ],
];

for (const [position, width, height, color, content] of stickies) {
  add({
    name: `Sticky ${nodes.length}`,
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position,
    parameters: { width, height, color, content },
  });
}

// ------------------------------------------------------------- connections --

connect('Telegram Trigger', 'Config');
connect('Config', 'Guard: Chat Diizinkan');
connect('Guard: Chat Diizinkan', 'Extract Audio', { output: 0 });
connect('Guard: Chat Diizinkan', 'Abaikan', { output: 1 });

connect('Extract Audio', 'Guard: Ada Audio');
connect('Guard: Ada Audio', 'Download Audio: Get File Info', { output: 0 });
connect('Guard: Ada Audio', 'Stage: Bukan Audio', { output: 1 });

connect('Download Audio: Get File Info', 'Download Audio: Read From Disk', { output: 0 });
connect('Download Audio: Get File Info', 'Stage: Unduh Gagal', { output: 1 });

connect('Download Audio: Read From Disk', 'Prepare Audio', { output: 0 });
connect('Download Audio: Read From Disk', 'Stage: Unduh Gagal', { output: 1 });

connect('Prepare Audio', 'Split Parts', { output: 0 });
connect('Prepare Audio', 'Stage: Siapkan Audio', { output: 1 });

connect('Split Parts', 'Download Part');
connect('Download Part', 'Transcribe (Groq)');

connect('Transcribe (Groq)', 'Merge Transcript Parts', { output: 0, input: 0 });
connect('Transcribe (Groq)', 'Download Part (Fallback)', { output: 1 });
connect('Download Part (Fallback)', 'Transcribe (OpenAI Fallback)');
connect('Transcribe (OpenAI Fallback)', 'Merge Transcript Parts', { output: 0, input: 1 });
connect('Transcribe (OpenAI Fallback)', 'Stage: Transkripsi', { output: 1 });
connect('Merge Transcript Parts', 'Merge Transcript');

connect('Merge Transcript', 'Guard: Transkrip Ada');
connect('Guard: Transkrip Ada', 'Build Correction Request', { output: 0 });
connect('Guard: Transkrip Ada', 'Stage: Transkrip Kosong', { output: 1 });

connect('Build Correction Request', 'LLM: Correct Terms');
connect('LLM: Correct Terms', 'Parse Correction', { output: 0 });
connect('LLM: Correct Terms', 'Stage: Koreksi', { output: 1 });

connect('Parse Correction', 'Build Outline Request');
connect('Build Outline Request', 'LLM: Generate Outline');
connect('LLM: Generate Outline', 'Parse Outline', { output: 0 });
connect('LLM: Generate Outline', 'Stage: Ringkasan', { output: 1 });

connect('Parse Outline', 'Guard: Outline Valid');
connect('Guard: Outline Valid', 'Outline to Markdown', { output: 0 });
connect('Guard: Outline Valid', 'Build Outline Retry Request', { output: 1 });

connect('Build Outline Retry Request', 'LLM: Generate Outline (Retry)');
connect('LLM: Generate Outline (Retry)', 'Parse Outline Retry', { output: 0 });
connect('LLM: Generate Outline (Retry)', 'Stage: Ringkasan', { output: 1 });

connect('Parse Outline Retry', 'Guard: Outline Valid (Retry)');
connect('Guard: Outline Valid (Retry)', 'Outline to Markdown', { output: 0 });
connect('Guard: Outline Valid (Retry)', 'Build Summary Message (Tanpa Mindmap)', { output: 1 });

connect('Outline to Markdown', 'Render Mindmap');
connect('Render Mindmap', 'Telegram: Kirim Mindmap', { output: 0 });
connect('Render Mindmap', 'Build Summary Message (Tanpa Mindmap)', { output: 1 });

connect('Telegram: Kirim Mindmap', 'Build Summary Message');
connect('Build Summary Message', 'Telegram: Kirim Ringkasan');
connect('Telegram: Kirim Ringkasan', 'Build Transcript Message');

connect('Build Summary Message (Tanpa Mindmap)', 'Telegram: Kirim Ringkasan (Tanpa Mindmap)');
connect('Telegram: Kirim Ringkasan (Tanpa Mindmap)', 'Build Transcript Message');

connect('Build Transcript Message', 'Guard: Transkrip Panjang');
connect('Guard: Transkrip Panjang', 'Telegram: Kirim Transkrip (File)', { output: 0 });
connect('Guard: Transkrip Panjang', 'Telegram: Kirim Transkrip (Teks)', { output: 1 });

for (const [name] of stages) {
  connect(name, 'Build Error Message');
}
connect('Build Error Message', 'Telegram: Kirim Error');

// ------------------------------------------------------------- validasi --

const names = new Set(nodes.map((node) => node.name));
for (const [from, entry] of Object.entries(connections)) {
  if (!names.has(from)) throw new Error(`Koneksi dari node yang tidak ada: ${from}`);
  for (const output of entry.main) {
    for (const target of output) {
      if (!names.has(target.node)) throw new Error(`Koneksi ke node yang tidak ada: ${target.node}`);
    }
  }
}

const workflow = {
  name: 'Voice to Mindmap',
  nodes,
  connections,
  active: false,
  settings: { executionOrder: 'v1', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' },
  pinData: {},
  tags: [],
  meta: { instanceId: 'voice-to-mindmap' },
};

const outFile = path.join(root, 'voice-to-mindmap.workflow.json');
writeFileSync(outFile, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');

const counts = nodes.reduce((acc, node) => {
  const key = node.type.replace('n8n-nodes-base.', '');
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

console.log(`OK — ${path.relative(root, outFile)}`);
console.log(`   ${nodes.length} node, ${Object.keys(connections).length} node punya koneksi keluar`);
console.log(`   ${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(', ')}`);
