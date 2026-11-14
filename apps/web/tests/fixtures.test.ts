import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_FILES } from '@/data/StaticBundleSource';
import { type ContractStem, contractSchemas, ManifestSchema } from '@/data/schemas.gen';

/**
 * Every JSON of the shipped bundle must parse with its generated schema (the web side of the
 * contract; pipeline/08_bundle.py validates the write side).
 */
const BUNDLE = resolve(__dirname, '../public/data/2026-11-15');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const hasBundle = existsSync(join(BUNDLE, 'manifest.json'));
if (!hasBundle) {
  console.warn(`[fixtures.test] SKIPPED: no data bundle at ${BUNDLE} (run pipeline/08_bundle.py --fixture).`);
}

describe.skipIf(!hasBundle)('data bundle public/data/2026-11-15', () => {
  const read = (rel: string): unknown => JSON.parse(readFileSync(join(BUNDLE, rel), 'utf8'));
  const manifest = hasBundle ? ManifestSchema.parse(read('manifest.json')) : null;

  // Bundle-relative path → contract.
  const byPath = new Map<string, ContractStem>();
  for (const [stem, path] of Object.entries({ ...DEFAULT_FILES, ...(manifest?.files ?? {}) })) {
    if (stem in contractSchemas) byPath.set(path, stem as ContractStem);
  }
  const jsonFiles = hasBundle
    ? walk(BUNDLE)
        .filter((p) => p.endsWith('.json'))
        .map((p) => relative(BUNDLE, p).replace(/\\/g, '/'))
    : [];

  it('contains every contract file listed in the manifest', () => {
    for (const path of Object.values(manifest?.files ?? {})) {
      expect(jsonFiles, `manifest lists ${path}`).toContain(path);
    }
  });

  it.each(jsonFiles)('%s parses with its schema', (rel) => {
    const stem = byPath.get(rel) ?? (/\/stats\.json$/.test(rel) ? 'anuga_stats' : undefined);
    expect(stem, `no contract mapped for ${rel}`).toBeDefined();
    const result = contractSchemas[stem!].safeParse(read(rel));
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it('every manifest layer file exists', () => {
    for (const layer of manifest?.layers ?? []) {
      expect(existsSync(join(BUNDLE, layer.file)), layer.file).toBe(true);
    }
  });
});
