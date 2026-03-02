/**
 * Unit tests for initializeWiki()
 *
 * Verifies that a fresh wiki directory is correctly seeded with all
 * default pages, special pages, and config on first run, and that
 * a second call does NOT overwrite existing content.
 *
 * Run:  node test-init.js
 */

'use strict';

const fs     = require('fs').promises;
const fsSync = require('fs');
const path   = require('path');
const os     = require('os');

const { initializeWiki } = require('./server.js');

// ─── Test harness ──────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗  ${name}`);
    console.log(`       ${err.message}`);
    failed++;
  }
}

function ok(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function fileExists(p) {
  return fsSync.existsSync(p);
}

async function readJSON(p) {
  return JSON.parse(await fs.readFile(p, 'utf-8'));
}

// ─── Helpers ───────────────────────────────────────────────────────────────
async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'massivewiki-test-'));
}

async function cleanupDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// ─── Tests ─────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n── initializeWiki() unit tests ──\n');

  let tempDir;

  // ── Suite 1: fresh first-run initialization ──
  console.log('Suite 1: first-run initialization');

  tempDir = await makeTempDir();
  try {
    await initializeWiki(tempDir);

    await test('creates pages/ directory', async () => {
      ok(fileExists(path.join(tempDir, 'pages')), 'pages/ not found');
    });

    await test('creates images/ directory', async () => {
      ok(fileExists(path.join(tempDir, 'images')), 'images/ not found');
    });

    await test('creates _wiki/ directory', async () => {
      ok(fileExists(path.join(tempDir, '_wiki')), '_wiki/ not found');
    });

    await test('creates home.md', async () => {
      ok(fileExists(path.join(tempDir, 'pages', 'home.md')), 'home.md not found');
    });

    await test('home.md contains expected heading', async () => {
      const content = await fs.readFile(path.join(tempDir, 'pages', 'home.md'), 'utf-8');
      ok(content.includes('# Welcome to Massive Wiki'), 'Missing heading in home.md');
    });

    await test('home.md references getting-started wikilink', async () => {
      const content = await fs.readFile(path.join(tempDir, 'pages', 'home.md'), 'utf-8');
      ok(content.includes('[[getting-started'), 'Missing wikilink in home.md');
    });

    await test('creates getting-started.md', async () => {
      ok(fileExists(path.join(tempDir, 'pages', 'getting-started.md')), 'getting-started.md not found');
    });

    await test('getting-started.md contains expected heading', async () => {
      const content = await fs.readFile(path.join(tempDir, 'pages', 'getting-started.md'), 'utf-8');
      ok(content.includes('# Getting Started'), 'Missing heading in getting-started.md');
    });

    await test('creates secure.md', async () => {
      ok(fileExists(path.join(tempDir, 'pages', 'secure.md')), 'secure.md not found');
    });

    await test('creates _sidebar.md', async () => {
      ok(fileExists(path.join(tempDir, '_wiki', '_sidebar.md')), '_sidebar.md not found');
    });

    await test('creates _footer.md', async () => {
      ok(fileExists(path.join(tempDir, '_wiki', '_footer.md')), '_footer.md not found');
    });

    await test('creates _config.json', async () => {
      ok(fileExists(path.join(tempDir, '_wiki', '_config.json')), '_config.json not found');
    });

    await test('_config.json has correct defaults', async () => {
      const config = await readJSON(path.join(tempDir, '_wiki', '_config.json'));
      ok(config.wikiName === 'Massive Wiki',      'wikiName wrong');
      ok(config.authEnabled === false,            'authEnabled should default to false');
      ok(Array.isArray(config.protectedPages),    'protectedPages should be an array');
      ok(config.protectedPages.includes('secure'),'secure should be in protectedPages');
      ok(config.defaultHomePage === 'home',       'defaultHomePage should be "home"');
    });

  } finally {
    await cleanupDir(tempDir);
  }

  // ── Suite 2: idempotency — second call must not overwrite existing content ──
  console.log('\nSuite 2: idempotency (second call must not overwrite)');

  tempDir = await makeTempDir();
  try {
    // First init
    await initializeWiki(tempDir);

    // Overwrite home.md with custom content
    const customContent = '# My Custom Home Page\n\nDo not overwrite me.\n';
    await fs.writeFile(path.join(tempDir, 'pages', 'home.md'), customContent, 'utf-8');

    // Second init — should detect home.md exists and skip
    await initializeWiki(tempDir);

    await test('second call does not overwrite home.md', async () => {
      const content = await fs.readFile(path.join(tempDir, 'pages', 'home.md'), 'utf-8');
      ok(content === customContent, 'home.md was overwritten by second initializeWiki() call');
    });

  } finally {
    await cleanupDir(tempDir);
  }

  // ── Suite 3: recovery — missing files after partial init ──
  console.log('\nSuite 3: missing home.md triggers re-init');

  tempDir = await makeTempDir();
  try {
    // Create the directory structure but NOT home.md (simulate a partial/failed first run)
    await fs.mkdir(path.join(tempDir, 'pages'),  { recursive: true });
    await fs.mkdir(path.join(tempDir, 'images'), { recursive: true });
    await fs.mkdir(path.join(tempDir, '_wiki'),  { recursive: true });

    await initializeWiki(tempDir);

    await test('creates home.md when pages/ exists but home.md is missing', async () => {
      ok(fileExists(path.join(tempDir, 'pages', 'home.md')), 'home.md not created after partial init');
    });

    await test('creates getting-started.md in partial-init scenario', async () => {
      ok(fileExists(path.join(tempDir, 'pages', 'getting-started.md')), 'getting-started.md missing');
    });

    await test('creates _config.json in partial-init scenario', async () => {
      ok(fileExists(path.join(tempDir, '_wiki', '_config.json')), '_config.json missing');
    });

  } finally {
    await cleanupDir(tempDir);
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
