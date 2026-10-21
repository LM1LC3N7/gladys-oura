// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import { ACTIONS, OAUTH_FIELD, POLL_MINUTES, TOKEN_URLS } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics, and the version set by hand to 0.1.0 everywhere', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-oura:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-oura/main/cover.png',
  );
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.match(manifest.description[lang], /Not a medical device|Pas un dispositif médical/);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not[\s>]+affiliated[\s>]+with|sans[\s>]+lien[\s>]+avec/i);
    assert.match(docs, /not a medical device|pas un dispositif médical/i);
    assert.match(
      docs,
      /never[\s>]+tested[\s>]+with[\s>]+a[\s>]+real[\s>]+device|jamais[\s>]+testée?[\s>]+avec[\s>]+un[\s>]+vrai[\s>]+appareil/i,
    );
    assert.doesNotMatch(docs, /chiffr|encrypt/i, 'a secret field is not encrypted by Gladys');
  }
  for (const file of ['README.md', 'CHANGELOG.md', 'TODO.md', 'CLAUDE.md']) {
    assert.doesNotMatch(read(file), /chiffr|encrypt/i, file);
  }
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.doesNotMatch(text[lang] ?? '', /chiffr|encrypt/i, path);
    }
  }
  assert.match(read('LICENSE'), /Apache License\s+Version 2\.0/);
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /Copyright \(c\) 2022 Josh Hejka/);
  assert.match(notices, /Copyright \(c\) 2025 louispires/);
  assert.match(notices, /Permission is hereby granted, free of charge/);
  assert.match(read('Dockerfile'), /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
});

test('every text is in English and French; the intro says it is not a medical device', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
  // Review 1 (M10): both descriptions name sleep, readiness and activity.
  assert.match(manifest.description.en, /sleep, readiness, activity/);
  assert.match(manifest.description.fr, /sommeil, récupération, activité/);
  // Review 1 (M9, I2): the docs say a renewal token may be lost, and name the spo2 scope.
  assert.match(read('docs/en.md'), /lose the new renewal token/);
  assert.match(read('docs/fr.md'), /perdre le nouveau jeton/);
  for (const lang of ['en', 'fr']) {
    assert.doesNotMatch(read(`docs/${lang}.md`), /spo2Daily/);
    assert.match(read(`docs/${lang}.md`), /\*\*spo2\*\*/);
  }
  const intro = manifest.config_schema.find((f) => f.key === 'intro');
  assert.match(intro.description.en, /^NOT A MEDICAL DEVICE/);
  assert.match(intro.description.fr, /^PAS UN DISPOSITIF MÉDICAL/);
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.deepEqual(
    fields.token_endpoint.options.map((o) => o.value).sort(),
    Object.keys(TOKEN_URLS).sort(),
  );
  assert.equal(fields.client_id.type, 'string');
  assert.equal(fields.client_secret.type, 'secret', 'the secret is never sent back to the browser');
  assert.match(
    fields.client_secret.description.en,
    /Kept by Gladys in its database, never shown again/,
  );
  assert.match(
    fields.client_secret.description.fr,
    /Gardé par Gladys dans sa base, jamais réaffiché/,
  );
  assert.equal(fields.redirect_uri.type, 'string');
  assert.equal(fields[OAUTH_FIELD].type, 'oauth2');
  assert.ok(!('password' in fields), 'no password field: it is typed on the Oura page only');
  assert.deepEqual(
    [fields.poll_minutes.min, fields.poll_minutes.max],
    [POLL_MINUTES.min, POLL_MINUTES.max],
  );
  for (const field of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const lang of ['en', 'fr']) {
      assert.ok(
        field.description[lang].length <= 1000,
        `${field.key}.${lang}: ${field.description[lang].length} characters`,
      );
    }
  }
  const intro = fields.intro;
  assert.ok(intro.links.length <= 5 && intro.links.every((l) => l.url.startsWith('https://')));
  for (const field of manifest.config_schema) {
    if (field.placeholder) {
      assert.equal(typeof field.placeholder, 'object', `${field.key}: placeholder per language`);
    }
  }
});

test('the actions and their forms are those of the code; no command, no scene', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.ok(handlers.includes('onOAuthAuthorizeUrl') && handlers.includes('onOAuthCallback'));
  assert.ok(!handlers.includes('onSetValue'), 'read only');
  const actions = Object.fromEntries(manifest.actions.map((a) => [a.key, a]));
  assert.deepEqual(
    actions[ACTIONS.FINISH_SIGN_IN].fields.map((f) => [f.key, f.type, f.required]),
    [['url', 'string', true]],
  );
  assert.equal(actions[ACTIONS.TEST_CONNECTION].fields, undefined);
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
});
