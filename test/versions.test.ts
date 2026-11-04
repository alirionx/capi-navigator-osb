import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Couplings between version pins that live in different files (ADR-0010, docs/maintenance.md).
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('version pins (ADR-0010)', () => {
  it('builds the image on the Node.js major of .nvmrc', () => {
    const nvmrc = read('.nvmrc').trim();
    const majors = [...read('Dockerfile').matchAll(/^FROM node:(\d+)[-.]/gm)].map((m) => m[1]);
    expect(majors.length).toBeGreaterThan(0);
    expect(new Set(majors)).toEqual(new Set([nvmrc]));
  });

  it('pins pnpm only in packageManager of package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { packageManager?: string };
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    for (const file of [
      'Dockerfile',
      '.github/workflows/ci.yaml',
      '.github/workflows/release.yaml',
    ]) {
      expect(read(file), file).not.toMatch(/pnpm@\d/);
    }
  });
});
