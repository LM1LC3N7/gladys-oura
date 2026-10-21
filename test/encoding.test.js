// -----------------------------------------------------------------------------
// The texts users and contributors read are UTF-8 without BOM, never
// mojibake (UTF-8 bytes read as Latin-1 / Windows-1252 and saved again), and
// hold no control byte (other than tab, line feed and carriage return).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const c = (...points) => String.fromCodePoint(...points);
// The lead byte of a French letter or sign (C2, C3, C5, E2) read as one
// character, followed by a continuation byte (80-BF) read as Latin-1 or as
// Windows-1252 ("Ã©", "Â«", "â€™", "Å“", "Ã‰"...). This test file is not
// in the list below: it holds these sequences on purpose.
const MOJIBAKE = /[ÂÃÅâ][\u0080-¿€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Every .js / .mjs file under a folder, at any depth. */
const sources = (dir) =>
  readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(`${dir}/${entry.name}`)
      : /\.m?js$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : [],
  );

const FILES = [
  'gladys-assistant-integration.json',
  'package.json',
  'docs/en.md',
  'docs/fr.md',
  'README.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'TODO.md',
  'THIRD_PARTY_NOTICES.md',
  'SECURITY.md',
  'LICENSE',
  'Dockerfile',
  'index.js',
  ...sources('src'),
  ...sources('scripts'),
  ...sources('test').filter((f) => f !== 'test/encoding.test.js'),
];

for (const file of FILES) {
  test(`${file}: UTF-8 without BOM, no mojibake, no control byte`, () => {
    const bytes = readFileSync(new URL(`../${file}`, import.meta.url));
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM');
    const text = bytes.toString('utf8');
    assert.ok(!text.includes('�'), 'invalid UTF-8');
    const lines = text.split('\n');
    const line = lines.findIndex((l) => MOJIBAKE.test(l));
    assert.equal(line, -1, `mojibake on line ${line + 1}`);
    const control = lines.findIndex((l) => CONTROL.test(l));
    assert.equal(control, -1, `control byte on line ${control + 1}`);
  });
}

test('the mojibake pattern catches what it should, and only that', () => {
  const mangle = (s) => Buffer.from(s, 'utf8').toString('latin1');
  const good = ['Français', '« Découverte »', 'État', 'À', 'Ça', 'l’app…', '—', 'œuvre'];
  for (const text of good) {
    assert.doesNotMatch(text, MOJIBAKE, text);
    assert.match(mangle(text), MOJIBAKE, `${text} read as Latin-1`);
  }
  assert.match(`l${c(0xe2, 0x20ac, 0x2122)}app`, MOJIBAKE, 'an apostrophe read as Windows-1252');
  assert.match(`${c(0xc3, 0x2030)}tat`, MOJIBAKE, 'a capital E acute read as Windows-1252');
  assert.doesNotMatch('800×534 m³/h 14:45–15:05 °C âge', MOJIBAKE);
  assert.match(`a${c(0x1b)}b`, CONTROL);
  assert.doesNotMatch('a\tb\r', CONTROL);
});

test('every source file is in the list', () => {
  assert.ok(FILES.includes('src/app.js') && FILES.includes('src/oauth.js'));
});
