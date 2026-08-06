// Uji struktur workflow + logika tiap Code node.
//   node test/run-tests.mjs
import assert from 'node:assert/strict';
import { workflow, nodeByName, runCodeNode } from './harness.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

function group(title) {
  console.log(`\n${title}`);
}

const CONFIG = Object.fromEntries(
  nodeByName('Config').parameters.assignments.assignments.map((a) => [a.name, a.value]),
);

// --------------------------------------------------------------- struktur --

group('Struktur workflow');

test('semua jsCode punya sintaks valid', () => {
  for (const node of workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.code')) {
    try {
      new Function('$input', '$', 'Buffer', node.parameters.jsCode);
    } catch (error) {
      throw new Error(`${node.name}: ${error.message}`);
    }
  }
});

test('tidak ada token inject yang tertinggal', () => {
  const raw = JSON.stringify(workflow);
  assert.equal(raw.includes('__INJECT_'), false, 'masih ada placeholder __INJECT_');
  assert.equal(raw.includes('{{GLOSSARY}}'), false, 'placeholder glossary belum diisi');
});

test('semua node punya id unik', () => {
  const ids = workflow.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('setiap node (selain trigger & sticky) punya koneksi masuk', () => {
  const targets = new Set();
  for (const entry of Object.values(workflow.connections)) {
    for (const output of entry.main) for (const t of output) targets.add(t.node);
  }
  const orphans = workflow.nodes
    .filter((n) => !['n8n-nodes-base.telegramTrigger', 'n8n-nodes-base.stickyNote'].includes(n.type))
    .filter((n) => !targets.has(n.name))
    .map((n) => n.name);
  assert.deepEqual(orphans, []);
});

test('semua HTTP Request pakai credential, bukan key hardcode', () => {
  const raw = JSON.stringify(workflow);
  for (const pattern of [/gsk_[A-Za-z0-9]/, /sk-[A-Za-z0-9]{20}/, /Bearer\s+[A-Za-z0-9_-]{20}/]) {
    assert.equal(pattern.test(raw), false, `pola kredensial ${pattern} muncul di workflow`);
  }
  for (const node of workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest')) {
    assert.equal(node.parameters.authentication, 'genericCredentialType', `${node.name} tanpa auth`);
    assert.ok(node.credentials?.httpHeaderAuth, `${node.name} tanpa credential`);
  }
});

test('body LLM & render dikirim sebagai raw body', () => {
  for (const name of [
    'LLM: Correct Terms',
    'LLM: Generate Outline',
    'LLM: Generate Outline (Retry)',
    'Render Mindmap',
  ]) {
    const node = nodeByName(name);
    assert.equal(node.parameters.contentType, 'raw', `${name} bukan raw body`);
    assert.equal(node.parameters.rawContentType, 'application/json');
    assert.equal(node.parameters.body, '={{ $json.body }}');
  }
});

test('setiap tahap kritis punya error output yang tersambung', () => {
  const withErrorOutput = [
    'Download Audio: Get File Info',
    'Download Audio',
    'Prepare Audio',
    'Transcribe (Groq)',
    'Transcribe (OpenAI Fallback)',
    'LLM: Correct Terms',
    'LLM: Generate Outline',
    'LLM: Generate Outline (Retry)',
    'Render Mindmap',
  ];
  for (const name of withErrorOutput) {
    assert.equal(nodeByName(name).onError, 'continueErrorOutput', `${name} tanpa error output`);
    const outputs = workflow.connections[name]?.main ?? [];
    assert.ok(outputs[1]?.length, `${name} error output tidak tersambung ke mana-mana`);
  }
});

test('semua jalur Stage bermuara ke satu pesan error Telegram', () => {
  const stages = workflow.nodes.filter((n) => n.name.startsWith('Stage: '));
  assert.ok(stages.length >= 7);
  for (const stage of stages) {
    assert.deepEqual(
      workflow.connections[stage.name].main[0].map((t) => t.node),
      ['Build Error Message'],
    );
  }
  assert.deepEqual(
    workflow.connections['Build Error Message'].main[0].map((t) => t.node),
    ['Telegram: Kirim Error'],
  );
});

test('jalur Groq & fallback bertemu di Merge node, bukan langsung ke Code node', () => {
  // Dua koneksi ke input yang sama membuat n8n menjalankan node tujuan dua kali.
  const merge = nodeByName('Merge Transcript Parts');
  assert.equal(merge.type, 'n8n-nodes-base.merge');
  assert.equal(merge.parameters.numberInputs, 2);
  assert.deepEqual(workflow.connections['Transcribe (Groq)'].main[0], [
    { node: 'Merge Transcript Parts', type: 'main', index: 0 },
  ]);
  assert.deepEqual(workflow.connections['Transcribe (OpenAI Fallback)'].main[0], [
    { node: 'Merge Transcript Parts', type: 'main', index: 1 },
  ]);
});

test('tidak ada input node yang menerima lebih dari satu koneksi', () => {
  const inbound = new Map();
  for (const [from, entry] of Object.entries(workflow.connections)) {
    for (const output of entry.main) {
      for (const target of output) {
        const key = `${target.node}#${target.index}`;
        inbound.set(key, [...(inbound.get(key) ?? []), from]);
      }
    }
  }
  // Node yang hanya bisa dicapai lewat satu cabang per eksekusi (jalur error /
  // percabangan IF yang saling eksklusif) memang boleh punya banyak sumber.
  const mutuallyExclusive = new Set([
    // Retry hanya berjalan kalau panggilan pertama sukses tapi JSON-nya rusak,
    // jadi kedua error output ini tidak mungkin aktif bersamaan.
    'Stage: Ringkasan#0',
    'Outline to Markdown#0',
    'Build Summary Message (Tanpa Mindmap)#0',
    'Build Transcript Message#0',
    'Build Error Message#0',
    // Get File Info dan Read From Disk berjalan berurutan — errornya tidak
    // pernah aktif bersamaan dalam satu eksekusi.
    'Stage: Unduh Gagal#0',
  ]);
  const offenders = [...inbound.entries()]
    .filter(([key, sources]) => sources.length > 1 && !mutuallyExclusive.has(key))
    .map(([key, sources]) => `${key} ← ${sources.join(', ')}`);
  assert.deepEqual(offenders, []);
});

test('URL render service tidak ditulis dengan trailing slash', () => {
  assert.equal(/\/$/.test(CONFIG.render_base_url), false);
  assert.equal(/\/$/.test(CONFIG.llm_base_url), false);
  // URL disambung langsung dengan file_path yang sudah diawali "/", jadi
  // garis miring di akhir akan menghasilkan "//data/work/...".
  assert.equal(/\/$/.test(CONFIG.bot_api_files_base_url), false);
});

// ------------------------------------------------------------ Extract Audio --

group('Extract Audio');

const voiceUpdate = {
  update_id: 1,
  message: {
    message_id: 42,
    date: 1_770_000_000,
    from: { first_name: 'Rizky' },
    chat: { id: 123456789 },
    voice: { file_id: 'AWADBAAD', duration: 95, mime_type: 'audio/ogg', file_size: 512000 },
  },
};

test('voice note dikenali', () => {
  const [out] = runCodeNode('Extract Audio', { input: [voiceUpdate] });
  assert.equal(out.json.has_audio, true);
  assert.equal(out.json.kind, 'voice');
  assert.equal(out.json.chat_id, '123456789');
  assert.equal(out.json.file_id, 'AWADBAAD');
  assert.equal(out.json.duration_sec, 95);
});

test('document ber-mime audio dikenali, mime lain ditolak', () => {
  const audioDoc = {
    message: { chat: { id: 1 }, document: { file_id: 'D1', mime_type: 'audio/mpeg', file_name: 'r.mp3' } },
  };
  const pdfDoc = {
    message: { chat: { id: 1 }, document: { file_id: 'D2', mime_type: 'application/pdf' } },
  };
  assert.equal(runCodeNode('Extract Audio', { input: [audioDoc] })[0].json.has_audio, true);
  assert.equal(runCodeNode('Extract Audio', { input: [pdfDoc] })[0].json.has_audio, false);
});

test('pesan teks biasa tidak dianggap audio', () => {
  const out = runCodeNode('Extract Audio', {
    input: [{ message: { chat: { id: 1 }, text: 'halo' } }],
  });
  assert.equal(out[0].json.has_audio, false);
});

// --------------------------------------------------------- Merge Transcript --

group('Merge Transcript');

const extractOut = runCodeNode('Extract Audio', { input: [voiceUpdate] })[0].json;

test('potongan digabung sesuai urutan index, bukan urutan kedatangan', () => {
  const [out] = runCodeNode('Merge Transcript', {
    input: [{ text: 'bagian dua' }, { text: 'bagian satu' }],
    nodes: {
      'Split Parts': [{ index: 1 }, { index: 0 }],
      'Extract Audio': [extractOut],
    },
  });
  assert.equal(out.json.transcript_raw, 'bagian satu\n\nbagian dua');
  assert.equal(out.json.part_count, 2);
  assert.equal(out.json.has_transcript, true);
});

test('transkrip kosong ditandai has_transcript = false', () => {
  const [out] = runCodeNode('Merge Transcript', {
    input: [{ text: '   ' }],
    nodes: { 'Split Parts': [{ index: 0 }], 'Extract Audio': [extractOut] },
  });
  assert.equal(out.json.has_transcript, false);
});

test('tetap jalan walau paired-item tidak bisa ditelusuri', () => {
  const [out] = runCodeNode('Merge Transcript', {
    input: [{ text: 'a' }, { text: 'b' }],
    nodes: { 'Split Parts': [], 'Extract Audio': [extractOut] },
  });
  assert.equal(out.json.transcript_raw, 'a\n\nb');
});

// ------------------------------------------------- Build Correction Request --

group('Build Correction Request');

const mergedOut = runCodeNode('Merge Transcript', {
  input: [{ text: 'roas nya turun kata mas budi "jangan panik"\nnewline\\ntest' }],
  nodes: { 'Split Parts': [{ index: 0 }], 'Extract Audio': [extractOut] },
})[0].json;

test('body valid JSON walau transkrip berisi kutip & backslash', () => {
  const [out] = runCodeNode('Build Correction Request', {
    input: [mergedOut],
    nodes: { Config: [CONFIG] },
  });
  const body = JSON.parse(out.json.body);
  assert.equal(body.model, CONFIG.llm_model);
  assert.equal(body.messages[1].content, mergedOut.transcript_raw);
  assert.ok(body.messages[0].content.includes('Zaneva'), 'kamus istilah ikut terkirim');
  assert.equal(out.json.llm_url, `${CONFIG.llm_base_url}/chat/completions`);
});

// ------------------------------------------------------------- Parse Correction --

group('Parse Correction');

const correctionCtx = {
  nodes: { 'Build Correction Request': [{ ...mergedOut, body: '{}' }] },
};

test('mengambil isi dari choices[0].message.content', () => {
  const [out] = runCodeNode('Parse Correction', {
    input: [{ choices: [{ message: { content: 'ROAS-nya turun.' } }] }],
    ...correctionCtx,
  });
  assert.equal(out.json.transcript_corrected, 'ROAS-nya turun.');
  assert.equal(out.json.correction_applied, true);
});

test('blok kode dari model dilepas', () => {
  const [out] = runCodeNode('Parse Correction', {
    input: [{ choices: [{ message: { content: '```\nROAS turun.\n```' } }] }],
    ...correctionCtx,
  });
  assert.equal(out.json.transcript_corrected, 'ROAS turun.');
});

test('balasan kosong jatuh balik ke transkrip mentah', () => {
  const [out] = runCodeNode('Parse Correction', {
    input: [{ choices: [{ message: { content: '' } }] }],
    ...correctionCtx,
  });
  assert.equal(out.json.transcript_corrected, mergedOut.transcript_raw);
  assert.equal(out.json.correction_applied, false);
});

// ---------------------------------------------------- Build Outline Request --

group('Build Outline Request');

const correctedOut = runCodeNode('Parse Correction', {
  input: [{ choices: [{ message: { content: 'ROAS turun ke 2,1. HPP naik.' } }] }],
  ...correctionCtx,
})[0].json;

test('mode normal memakai transkrip terkoreksi dan response_format JSON', () => {
  const [out] = runCodeNode('Build Outline Request', {
    input: [correctedOut],
    nodes: { Config: [CONFIG] },
  });
  const body = JSON.parse(out.json.body);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[1].content, correctedOut.transcript_corrected);
  assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('llm_json_mode = false menghilangkan response_format', () => {
  const [out] = runCodeNode('Build Outline Request', {
    input: [correctedOut],
    nodes: { Config: [{ ...CONFIG, llm_json_mode: false }] },
  });
  assert.equal(JSON.parse(out.json.body).response_format, undefined);
});

test('mode retry menambah instruksi JSON valid dan suhu 0', () => {
  const [out] = runCodeNode('Build Outline Retry Request', {
    input: [{ error: 'apa pun' }],
    nodes: { Config: [CONFIG], 'Parse Correction': [correctedOut] },
  });
  const body = JSON.parse(out.json.body);
  assert.equal(body.temperature, 0);
  assert.equal(body.messages.length, 3);
  assert.ok(body.messages[1].content.includes('PERCOBAAN ULANG'));
  assert.equal(body.messages[2].content, correctedOut.transcript_corrected);
});

// ------------------------------------------------------------ Parse Outline --

group('Parse Outline');

const outlineCtx = { nodes: { 'Build Outline Request': [correctedOut] } };
const llmReply = (content) => [{ choices: [{ message: { content } }] }];

const goodOutline = {
  title: 'Evaluasi Iklan Zaneva',
  summary: 'ROAS turun ke 2,1 dan HPP naik. Perlu audit creative.',
  outline: [
    {
      title: 'Evaluasi Iklan Zaneva',
      children: [
        { title: 'Performa', children: [{ title: 'ROAS 2,1' }] },
        { title: 'Action', children: [{ title: 'Audit creative' }] },
      ],
    },
  ],
};

test('JSON bersih diterima', () => {
  const [out] = runCodeNode('Parse Outline', {
    input: llmReply(JSON.stringify(goodOutline)),
    ...outlineCtx,
  });
  assert.equal(out.json.outline_valid, true);
  assert.equal(out.json.title, 'Evaluasi Iklan Zaneva');
  assert.equal(out.json.outline[0].children.length, 2);
});

test('JSON dalam blok kode diterima', () => {
  const [out] = runCodeNode('Parse Outline', {
    input: llmReply('```json\n' + JSON.stringify(goodOutline) + '\n```'),
    ...outlineCtx,
  });
  assert.equal(out.json.outline_valid, true);
});

test('JSON yang diapit kalimat basa-basi tetap terambil', () => {
  const [out] = runCodeNode('Parse Outline', {
    input: llmReply(`Tentu! Ini hasilnya:\n${JSON.stringify(goodOutline)}\nSemoga membantu.`),
    ...outlineCtx,
  });
  assert.equal(out.json.outline_valid, true);
});

test('balasan rusak ditandai tidak valid, bukan melempar error', () => {
  for (const bad of ['bukan json sama sekali', '{"title": "x", "summ', '{}', '']) {
    const [out] = runCodeNode('Parse Outline', { input: llmReply(bad), ...outlineCtx });
    assert.equal(out.json.outline_valid, false, `seharusnya invalid: ${bad}`);
    assert.ok(out.json.summary.length > 0, 'summary cadangan tetap diisi');
  }
});

test('level 4+ dipangkas jadi maksimal 3 level', () => {
  const deep = {
    title: 'A',
    summary: 'ringkas',
    outline: [
      { title: 'L1', children: [{ title: 'L2', children: [{ title: 'L3', children: [{ title: 'L4' }] }] }] },
    ],
  };
  const [out] = runCodeNode('Parse Outline', { input: llmReply(JSON.stringify(deep)), ...outlineCtx });
  const l3 = out.json.outline[0].children[0].children[0];
  assert.equal(l3.title, 'L3');
  assert.equal(l3.children, undefined, 'level 4 seharusnya sudah dibuang');
});

test('markdown di dalam judul node dibersihkan', () => {
  const dirty = {
    title: '## Judul',
    summary: 'ringkas',
    outline: [{ title: '- Tema', children: [{ title: '1. Detail' }] }],
  };
  const [out] = runCodeNode('Parse Outline', { input: llmReply(JSON.stringify(dirty)), ...outlineCtx });
  assert.equal(out.json.title, 'Judul');
  assert.equal(out.json.outline[0].title, 'Tema');
  assert.equal(out.json.outline[0].children[0].title, 'Detail');
});

// ------------------------------------------------------ Outline to Markdown --

group('Outline to Markdown');

const parsedOut = runCodeNode('Parse Outline', {
  input: llmReply(JSON.stringify(goodOutline)),
  ...outlineCtx,
})[0].json;

test('outline jadi heading bertingkat dan body render valid', () => {
  const [out] = runCodeNode('Outline to Markdown', {
    input: [parsedOut],
    nodes: { Config: [CONFIG] },
  });
  assert.equal(
    out.json.markdown,
    ['# Evaluasi Iklan Zaneva', '', '## Performa', '', '### ROAS 2,1', '', '## Action', '', '### Audit creative'].join(
      '\n',
    ),
  );
  const body = JSON.parse(out.json.body);
  assert.equal(body.markdown, out.json.markdown);
  assert.equal(body.width, CONFIG.mindmap_width);
  assert.equal(out.json.render_url, `${CONFIG.render_base_url}/render`);
});

test('level ekstra turun jadi bullet, bukan hilang', () => {
  const [out] = runCodeNode('Outline to Markdown', {
    input: [
      {
        ...parsedOut,
        outline: [{ title: 'A', children: [{ title: 'B', children: [{ title: 'C', children: [{ title: 'D' }] }] }] }],
      },
    ],
    nodes: { Config: [CONFIG] },
  });
  assert.ok(out.json.markdown.includes('### C'));
  assert.ok(out.json.markdown.includes('- D'));
});

// ------------------------------------------------------ Build Summary Message --

group('Build Summary Message');

const markdownOut = runCodeNode('Outline to Markdown', {
  input: [parsedOut],
  nodes: { Config: [CONFIG] },
})[0].json;

test('ringkasan berisi judul, meta, dan poin utama', () => {
  const [out] = runCodeNode('Build Summary Message', {
    input: [{}],
    nodes: { 'Outline to Markdown': [markdownOut], 'Extract Audio': [extractOut] },
  });
  const text = out.json.summary_text;
  assert.ok(text.startsWith('🗒 <b>Evaluasi Iklan Zaneva</b>'));
  assert.ok(text.includes('1 mnt 35 dtk'));
  assert.ok(text.includes('<b>Poin utama</b>'));
  assert.ok(text.includes('• <b>Performa</b>'));
  assert.ok(text.includes('   ◦ ROAS 2,1'));
  assert.equal(text.includes('Mind map gagal'), false);
  assert.equal(out.json.chat_id, '123456789');
});

test('karakter HTML dari transkrip di-escape', () => {
  const [out] = runCodeNode('Build Summary Message', {
    input: [{}],
    nodes: {
      'Outline to Markdown': [{ ...markdownOut, summary: 'Margin <5% & turun', title: 'A & B' }],
      'Extract Audio': [extractOut],
    },
  });
  assert.ok(out.json.summary_text.includes('Margin &lt;5% &amp; turun'));
  assert.ok(out.json.summary_text.includes('A &amp; B'));
  assert.equal(/<(?!\/?(b|i|code)>)/.test(out.json.summary_text.replace(/<\/?[bi]>/g, '')), false);
});

test('varian tanpa mind map menambahkan catatan dan tetap jalan tanpa node render', () => {
  const [out] = runCodeNode('Build Summary Message (Tanpa Mindmap)', {
    input: [{ error: 'timeout' }],
    nodes: { 'Parse Outline': [parsedOut], 'Extract Audio': [extractOut] },
  });
  assert.ok(out.json.summary_text.includes('Mind map gagal dibuat'));
  assert.ok(out.json.summary_text.includes('Evaluasi Iklan Zaneva'));
});

test('pesan dipotong di bawah batas Telegram', () => {
  const [out] = runCodeNode('Build Summary Message', {
    input: [{}],
    nodes: {
      'Outline to Markdown': [{ ...markdownOut, summary: 'x'.repeat(9000) }],
      'Extract Audio': [extractOut],
    },
  });
  assert.ok(out.json.summary_text.length <= 4096, `panjang ${out.json.summary_text.length}`);
  assert.ok(out.json.summary_text.includes('(dipotong)'));
});

// --------------------------------------------------- Build Transcript Message --

group('Build Transcript Message');

test('transkrip pendek dikirim sebagai teks', () => {
  const [out] = runCodeNode('Build Transcript Message', {
    input: [{}],
    nodes: {
      Config: [CONFIG],
      'Parse Correction': [{ ...correctedOut, chat_id: '123456789' }],
      'Extract Audio': [extractOut],
    },
  });
  assert.equal(out.json.is_file, false);
  assert.ok(out.json.transcript_text.startsWith('📝 <b>Transkrip</b>'));
  assert.equal(out.binary, undefined);
});

test('transkrip panjang dikirim sebagai file .txt', () => {
  const long = 'kalimat panjang. '.repeat(400);
  const [out] = runCodeNode('Build Transcript Message', {
    input: [{}],
    nodes: {
      Config: [CONFIG],
      'Parse Correction': [{ ...correctedOut, transcript_corrected: long, chat_id: '123456789' }],
      'Extract Audio': [extractOut],
    },
  });
  assert.equal(out.json.is_file, true);
  assert.match(out.json.file_name, /^transkrip-.*\.txt$/);
  assert.equal(out.binary.data.mimeType, 'text/plain');
  assert.ok(Buffer.from(out.binary.data.data, 'base64').toString('utf8').includes(long.trim()));
});

// ------------------------------------------------------- Build Error Message --

group('Build Error Message');

test('menggabungkan tahap, kalimat ramah, dan detail error', () => {
  const [out] = runCodeNode('Build Error Message', {
    input: [
      {
        error_stage: 'Transkripsi gagal',
        error_message: 'Coba kirim ulang.',
        error: { message: 'Request failed with status code 429' },
      },
    ],
    nodes: { 'Extract Audio': [extractOut] },
  });
  assert.ok(out.json.error_text.includes('⚠️ <b>Transkripsi gagal</b>'));
  assert.ok(out.json.error_text.includes('Coba kirim ulang.'));
  assert.ok(out.json.error_text.includes('429'));
  assert.equal(out.json.chat_id, '123456789');
});

test('detail error di-escape supaya tidak merusak parse_mode HTML', () => {
  const [out] = runCodeNode('Build Error Message', {
    input: [{ error_stage: 'X', error_message: 'Y', error: { message: '<script>a & b' } }],
    nodes: { 'Extract Audio': [extractOut] },
  });
  assert.ok(out.json.error_text.includes('&lt;script&gt;a &amp; b'));
});

test('tanpa detail error pun tetap menghasilkan pesan', () => {
  const [out] = runCodeNode('Build Error Message', {
    input: [{ error_stage: 'Bukan pesan suara', error_message: 'Kirim voice note ya.' }],
    nodes: { 'Extract Audio': [extractOut] },
  });
  assert.ok(out.json.error_text.includes('Bukan pesan suara'));
});

// -------------------------------------------------------------------- hasil --

console.log(`\n${passed} lulus, ${failed} gagal`);
process.exit(failed ? 1 : 0);
