/**
 * Unit tests for the {{children}} macro expansion.
 * Functions are copied from server.js — keep in sync when server.js changes.
 */

const fs = require('fs').promises;
const path = require('path');
const assert = require('assert');
const os = require('os');

// ---- Functions copied from server.js ----

function safePath(baseDir, userInput) {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(path.join(baseDir, userInput));
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

async function collectDescendants(dir, basePath, depth) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const indent = '  '.repeat(depth);
  const lines = [];

  const mdFiles = entries
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const dirs = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const file of mdFiles) {
    const name = file.name.slice(0, -3);
    const childPath = `${basePath}/${name}`;
    const displayName = name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    lines.push(`${indent}- [[${childPath}|${displayName}]]`);
    const matchingDir = dirs.find(d => d.name === name);
    if (matchingDir) {
      const sub = await collectDescendants(path.join(dir, name), childPath, depth + 1);
      lines.push(...sub);
    }
  }

  for (const d of dirs) {
    if (!mdFiles.some(f => f.name.slice(0, -3) === d.name)) {
      const sub = await collectDescendants(path.join(dir, d.name), `${basePath}/${d.name}`, depth);
      lines.push(...sub);
    }
  }

  return lines;
}

// PAGES_DIR is passed as a parameter here for testability (it's a module var in server.js)
async function buildChildrenList(PAGES_DIR, pagePath) {
  const childDir = safePath(PAGES_DIR, pagePath);
  if (!childDir) return '';
  try { await fs.access(childDir); } catch { return ''; }
  const lines = await collectDescendants(childDir, pagePath, 0);
  return lines.join('\n');
}

async function expandMacros(PAGES_DIR, content, pagePath) {
  if (!content.includes('{{')) return content;
  const childrenMd = await buildChildrenList(PAGES_DIR, pagePath);
  return content.replace(/\{\{children\}\}/gi, childrenMd);
}

// ---- Test harness ----

let testCount = 0;
let passedTests = 0;
let failedTests = 0;
const promises = [];

function test(description, fn) {
  testCount++;
  const p = Promise.resolve().then(fn).then(() => {
    passedTests++;
    console.log(`✓ ${description}`);
  }).catch(err => {
    failedTests++;
    console.error(`✗ ${description}`);
    console.error(`  ${err.message}`);
  });
  promises.push(p);
}

async function touch(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '');
}

// ---- Tests ----

async function runTests() {
  console.log('\n=== {{children}} Macro Unit Tests ===\n');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'massivewiki-macro-'));
  const P = root; // PAGES_DIR for all tests

  // Structure:
  //   systems.md
  //   systems/
  //     apple.md
  //     atari.md
  //     atari/
  //       400.md
  //       800xl.md
  //     sgi.md

  await touch(path.join(P, 'systems.md'));
  await touch(path.join(P, 'systems', 'apple.md'));
  await touch(path.join(P, 'systems', 'atari.md'));
  await touch(path.join(P, 'systems', 'atari', '400.md'));
  await touch(path.join(P, 'systems', 'atari', '800xl.md'));
  await touch(path.join(P, 'systems', 'sgi.md'));

  // 1. Leaf page returns empty string
  test('leaf page with no children returns empty string', async () => {
    const result = await buildChildrenList(P, 'systems/apple');
    assert.strictEqual(result, '');
  });

  // 2. Non-existent directory returns empty string
  test('non-existent directory returns empty string', async () => {
    const result = await buildChildrenList(P, 'does-not-exist');
    assert.strictEqual(result, '');
  });

  // 3. Path traversal attempt is rejected
  test('path traversal attempt returns empty string', async () => {
    const result = await buildChildrenList(P, '../../etc/passwd');
    assert.strictEqual(result, '');
  });

  // 4. Direct children listed alphabetically
  test('direct children are listed alphabetically', async () => {
    const result = await buildChildrenList(P, 'systems');
    const lines = result.split('\n');
    const appleIdx = lines.findIndex(l => l.includes('systems/apple'));
    const atariIdx = lines.findIndex(l => l.includes('[[systems/atari|'));
    const sgiIdx   = lines.findIndex(l => l.includes('systems/sgi'));
    assert(appleIdx !== -1, 'apple should be present');
    assert(atariIdx !== -1, 'atari should be present');
    assert(sgiIdx   !== -1, 'sgi should be present');
    assert(appleIdx < atariIdx, 'apple before atari');
    assert(atariIdx < sgiIdx,   'atari before sgi');
  });

  // 5. Grandchildren appear after their parent
  test('grandchildren appear after parent entry', async () => {
    const result = await buildChildrenList(P, 'systems');
    const lines = result.split('\n');
    const atariIdx = lines.findIndex(l => l.includes('[[systems/atari|'));
    const xlIdx    = lines.findIndex(l => l.includes('systems/atari/800xl'));
    assert(xlIdx > atariIdx, '800xl should follow atari');
  });

  // 6. Grandchildren are indented by 2 spaces
  test('grandchildren are indented by 2 spaces', async () => {
    const result = await buildChildrenList(P, 'systems');
    const lines = result.split('\n');
    const xlLine = lines.find(l => l.includes('systems/atari/800xl'));
    assert(xlLine, '800xl line should exist');
    assert(xlLine.startsWith('  '), `Expected 2-space indent, got: "${xlLine}"`);
  });

  // 7. Wikilink syntax is correct
  test('wikilinks use [[path|Name]] format', async () => {
    const result = await buildChildrenList(P, 'systems');
    assert(result.includes('[[systems/apple|Apple]]'), `Expected [[systems/apple|Apple]] in:\n${result}`);
    assert(result.includes('[[systems/sgi|Sgi]]'),     `Expected [[systems/sgi|Sgi]] in:\n${result}`);
  });

  // 8. Hyphens in filename → spaces in display name
  test('hyphens in filenames become spaces in display name', async () => {
    const sub = await fs.mkdtemp(path.join(os.tmpdir(), 'massivewiki-name-'));
    await touch(path.join(sub, 'parent', 'my-cool-page.md'));
    const result = await buildChildrenList(sub, 'parent');
    assert(result.includes('My Cool Page'), `Expected "My Cool Page" in:\n${result}`);
    await fs.rm(sub, { recursive: true, force: true });
  });

  // 9. {{children}} replaced in content
  test('{{children}} token is replaced with child list', async () => {
    const result = await expandMacros(P, 'Intro\n{{children}}\nEnd', 'systems');
    assert(!result.includes('{{children}}'), 'token should be gone');
    assert(result.includes('[[systems/apple|Apple]]'), 'child link should appear');
  });

  // 10. Case-insensitive matching
  test('{{Children}} and {{CHILDREN}} are both expanded', async () => {
    const result = await expandMacros(P, '{{Children}}\n{{CHILDREN}}', 'systems');
    assert(!result.includes('{{Children}}'), '{{Children}} not replaced');
    assert(!result.includes('{{CHILDREN}}'), '{{CHILDREN}} not replaced');
  });

  // 11. Fast path: no {{ means no fs work, content returned unchanged
  test('content without {{ is returned unchanged', async () => {
    const content = 'No macros here.';
    const result = await expandMacros(P, content, 'systems');
    assert.strictEqual(result, content);
  });

  // 12. Leaf page: {{children}} expands to empty string (macro vanishes)
  test('{{children}} on leaf page expands to empty string (invisible)', async () => {
    const result = await expandMacros(P, 'Before\n{{children}}\nAfter', 'systems/apple');
    assert.strictEqual(result, 'Before\n\nAfter');
  });

  // 13. Transparent folder (dir without matching .md) traversed at same depth
  test('transparent folder contents appear at parent depth (no extra indent)', async () => {
    const sub = await fs.mkdtemp(path.join(os.tmpdir(), 'massivewiki-folder-'));
    // 'container/stuff/' has no container/stuff.md — just a page inside
    await touch(path.join(sub, 'container', 'stuff', 'page.md'));
    const result = await buildChildrenList(sub, 'container');
    const lines = result.split('\n').filter(Boolean);
    const pageLine = lines.find(l => l.includes('container/stuff/page'));
    assert(pageLine, 'page inside transparent folder should appear');
    assert(!pageLine.startsWith('  '), `Should not be indented, got: "${pageLine}"`);
    await fs.rm(sub, { recursive: true, force: true });
  });

  // ---- Wait for all async tests then print summary ----
  await Promise.all(promises);

  await fs.rm(root, { recursive: true, force: true });

  console.log('\n=== Test Summary ===');
  console.log(`Total: ${testCount}  Passed: ${passedTests}  Failed: ${failedTests}`);
  if (failedTests === 0) {
    console.log('\n✓ All tests passed!\n');
    process.exit(0);
  } else {
    console.log('\n✗ Some tests failed\n');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
