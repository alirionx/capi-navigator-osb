import { describe, expect, it } from 'vitest';
import { uuidV5 } from '../src/osb/uuid.js';

describe('uuidV5 (plan IDs, section 3)', () => {
  it('matches reference values', () => {
    // RFC 9562 DNS namespace; values from Python's uuid.uuid5.
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
    expect(uuidV5('small', '0b0c9e40-7db5-45ae-a810-f4459a2fad3b')).toBe(
      '4f66e97c-7f0d-5e2f-9e50-a868d2d0d751',
    );
  });

  it('refuses a namespace that is no UUID', () => {
    expect(() => uuidV5('x', 'abc')).toThrow('UUID');
  });
});
