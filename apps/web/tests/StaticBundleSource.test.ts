import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DataContractError, DataFetchError, DataNotFoundError } from '@/data/errors';
import { StaticBundleSource } from '@/data/StaticBundleSource';

const manifest = JSON.parse(readFileSync(resolve(__dirname, '../public/data/2026-11-15/manifest.json'), 'utf8')) as {
  dam_id: string;
};

function source(routes: Record<string, unknown | number>) {
  const calls: string[] = [];
  const ds = new StaticBundleSource({
    baseUrl: '/data/test/',
    fetch: async (url) => {
      calls.push(url);
      const body = routes[url];
      if (body === undefined) return new Response('not found', { status: 404 });
      if (typeof body === 'number') return new Response('', { status: body });
      return new Response(JSON.stringify(body), { status: 200 });
    },
  });
  return { ds, calls };
}

describe('StaticBundleSource', () => {
  it('parses the manifest and caches it', async () => {
    const { ds, calls } = source({ '/data/test/manifest.json': manifest });
    const m = await ds.manifest();
    await ds.manifest();
    expect(m.dam_id).toBe(manifest.dam_id);
    expect(calls).toEqual(['/data/test/manifest.json']);
  });

  it('throws a typed DataContractError when a file breaks its contract', async () => {
    const { ds } = source({ '/data/test/manifest.json': { version: 1 } });
    const err = await ds.manifest().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataContractError);
    expect((err as DataContractError).contract).toBe('manifest');
    expect((err as DataContractError).issues.length).toBeGreaterThan(0);
  });

  it('maps 404 to DataNotFoundError and 5xx to DataFetchError', async () => {
    const a = source({});
    await expect(a.ds.manifest()).rejects.toBeInstanceOf(DataNotFoundError);
    const b = source({ '/data/test/manifest.json': 503 });
    await expect(b.ds.manifest()).rejects.toBeInstanceOf(DataFetchError);
  });

  it('rejects dams outside the bundle as missing', async () => {
    const { ds } = source({ '/data/test/manifest.json': manifest });
    await expect(ds.alerts('not_a_dam')).rejects.toBeInstanceOf(DataNotFoundError);
  });

  it('builds texture URLs from manifest layers', async () => {
    const { ds } = source({ '/data/test/manifest.json': manifest });
    const m = await ds.manifest();
    const layer = m.layers[0]!;
    expect(ds.textureUrl(layer.id)).toBe(`/data/test/${layer.file}`);
    expect(() => ds.textureUrl('nope')).toThrow(DataNotFoundError);
  });
});
