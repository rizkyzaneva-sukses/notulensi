// Harness mini yang meniru konteks Code node n8n, supaya logika tiap node bisa
// diuji tanpa harus menyalakan n8n.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const workflow = JSON.parse(
  readFileSync(path.join(root, 'voice-to-mindmap.workflow.json'), 'utf8'),
);

export function nodeByName(name) {
  const node = workflow.nodes.find((n) => n.name === name);
  if (!node) throw new Error(`Node "${name}" tidak ada di workflow`);
  return node;
}

/**
 * Jalankan jsCode sebuah Code node.
 * @param {string} name nama node
 * @param {{ input?: any[], nodes?: Record<string, any[]> }} ctx
 */
export function runCodeNode(name, ctx = {}) {
  const node = nodeByName(name);
  if (node.type !== 'n8n-nodes-base.code') throw new Error(`${name} bukan Code node`);

  const input = (ctx.input ?? []).map(normalizeItem);
  const store = Object.fromEntries(
    Object.entries(ctx.nodes ?? {}).map(([key, items]) => [key, items.map(normalizeItem)]),
  );

  const $input = {
    all: () => input,
    first: () => {
      if (!input.length) throw new Error('No input item');
      return input[0];
    },
    last: () => input[input.length - 1],
  };

  const $ = (nodeName) => {
    const items = store[nodeName];
    if (!items) {
      // n8n melempar error kalau node yang diacu belum pernah jalan.
      throw new Error(`No execution data for node "${nodeName}"`);
    }
    return {
      all: () => items,
      first: () => {
        if (!items.length) throw new Error(`No data for "${nodeName}"`);
        return items[0];
      },
      itemMatching: (index) => {
        if (!items[index]) throw new Error(`No matching item ${index} for "${nodeName}"`);
        return items[index];
      },
      get item() {
        return items[0];
      },
    };
  };

  const fn = new Function('$input', '$', 'Buffer', 'DateTime', node.parameters.jsCode);
  return fn($input, $, Buffer, null);
}

function normalizeItem(item) {
  if (item && typeof item === 'object' && ('json' in item || 'binary' in item)) return item;
  return { json: item };
}
