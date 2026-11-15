#!/usr/bin/env node
/**
 * Codegen: contracts/*.schema.json (exported from pipeline/common/contracts.py) → src/data/schemas.gen.ts
 *
 *   node scripts/gen-schemas.mjs           write the file
 *   node scripts/gen-schemas.mjs --check   exit 1 if the committed file is stale (CI)
 *
 * Pydantic emits `$defs` + local `$ref`s and draft 2020-12 `prefixItems` tuples. We dereference
 * and normalise them here (tiny inline resolver, no extra deps) before json-schema-to-zod.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { jsonSchemaToZod } from 'json-schema-to-zod';
import prettier from 'prettier';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const contractsDir = resolve(webRoot, '../../contracts');
const outFile = resolve(webRoot, 'src/data/schemas.gen.ts');
const check = process.argv.includes('--check');

/** Contracts the web app consumes (file stem → TS name). */
const CONTRACTS = {
  grid: 'Grid',
  manifest: 'Manifest',
  reservoir_area: 'ReservoirArea',
  alerts: 'Alerts',
  hand_lut: 'HandLut',
  anuga_index: 'AnugaIndex',
  anuga_stats: 'AnugaStats',
  impacts: 'Impacts',
  level_volume: 'LevelVolume',
  sources: 'Sources',
  events: 'Events',
  validation: 'Validation',
};

/** Keywords that carry no validation meaning for Zod and only add noise. */
const DROP = new Set(['$id', '$schema', '$defs', 'definitions', 'title', 'x-schema-version']);

/** Resolve a local JSON pointer ("#/$defs/Layer") against the root document. */
function resolvePointer(root, ref, file) {
  if (!ref.startsWith('#/')) throw new Error(`${file}: only local $ref are supported, got "${ref}"`);
  let node = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node == null || !(key in node)) throw new Error(`${file}: unresolved $ref "${ref}"`);
    node = node[key];
  }
  return node;
}

/** Inline every $ref, normalise prefixItems → tuple items, drop noise keywords. Throws on cycles. */
function deref(node, root, file, stack = []) {
  if (Array.isArray(node)) return node.map((n) => deref(n, root, file, stack));
  if (node === null || typeof node !== 'object') return node;

  if (typeof node.$ref === 'string') {
    if (stack.includes(node.$ref)) {
      throw new Error(`${file}: recursive $ref ${[...stack, node.$ref].join(' → ')} is not supported`);
    }
    const { $ref, ...siblings } = node;
    const target = deref(resolvePointer(root, $ref, file), root, file, [...stack, $ref]);
    // Sibling keywords next to $ref (e.g. "default", "description") override the target.
    return { ...target, ...deref(siblings, root, file, stack) };
  }

  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (DROP.has(k)) continue;
    if (k === 'properties') {
      // property names are data, not keywords: never drop "title" etc. here
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, deref(pv, root, file, stack)]));
      continue;
    }
    out[k] = deref(v, root, file, stack);
  }

  // Draft 2020-12 tuple → draft-07 tuple, which json-schema-to-zod understands.
  if (Array.isArray(out.prefixItems)) {
    out.items = out.prefixItems; // pydantic tuples are closed (minItems = maxItems = length)
    out.additionalItems = false;
    delete out.prefixItems;
    delete out.minItems;
    delete out.maxItems;
  }
  return out;
}

function header(sources) {
  return [
    '/* eslint-disable */',
    '// ─────────────────────────────────────────────────────────────────────────────',
    '// GENERATED FILE — DO NOT EDIT. Run `pnpm gen:schemas` after a contract change.',
    '// Source: contracts/*.schema.json (pydantic models in pipeline/common/contracts.py)',
    `// Contracts: ${sources.join(', ')}`,
    '// ─────────────────────────────────────────────────────────────────────────────',
    "import { z } from 'zod';",
    '',
  ].join('\n');
}

async function generate() {
  if (!existsSync(contractsDir)) throw new Error(`contracts folder not found: ${contractsDir}`);
  const available = new Set(
    readdirSync(contractsDir)
      .filter((f) => f.endsWith('.schema.json'))
      .map((f) => f.replace(/\.schema\.json$/, '')),
  );
  const missing = Object.keys(CONTRACTS).filter((c) => !available.has(c));
  if (missing.length) throw new Error(`missing contracts: ${missing.map((m) => `${m}.schema.json`).join(', ')}`);

  const blocks = [];
  for (const [stem, name] of Object.entries(CONTRACTS)) {
    const file = `${stem}.schema.json`;
    const raw = JSON.parse(readFileSync(join(contractsDir, file), 'utf8'));
    const schema = deref(raw, raw, file);
    const expr = jsonSchemaToZod(schema, { module: 'none', zodVersion: 3 }).trim().replace(/;$/, '');
    blocks.push(
      `/** contracts/${file}${raw['x-schema-version'] ? ` (schema v${raw['x-schema-version']})` : ''} */\n` +
        `export const ${name}Schema = ${expr};\n` +
        `export type ${name} = z.infer<typeof ${name}Schema>;\n`,
    );
  }

  const registry =
    '/** All contract schemas by file stem (manifest `files` keys). */\n' +
    'export const contractSchemas = {\n' +
    Object.entries(CONTRACTS)
      .map(([stem, name]) => `  ${stem}: ${name}Schema,`)
      .join('\n') +
    '\n} as const;\n' +
    'export type ContractStem = keyof typeof contractSchemas;\n';

  const code = header(Object.keys(CONTRACTS)) + '\n' + blocks.join('\n') + '\n' + registry;
  const config = (await prettier.resolveConfig(outFile)) ?? {};
  return prettier.format(code, { ...config, filepath: outFile });
}

try {
  const next = await generate();
  if (check) {
    const current = existsSync(outFile) ? readFileSync(outFile, 'utf8') : '';
    if (current.replace(/\r\n/g, '\n') !== next) {
      console.error('✗ src/data/schemas.gen.ts is stale. Run `pnpm gen:schemas` and commit the result.');
      process.exit(1);
    }
    console.log('✓ src/data/schemas.gen.ts is up to date with contracts/');
  } else {
    writeFileSync(outFile, next, 'utf8');
    console.log(`✓ wrote ${outFile.replace(webRoot, '.')} (${Object.keys(CONTRACTS).length} contracts)`);
  }
} catch (err) {
  console.error(`✗ gen-schemas: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
