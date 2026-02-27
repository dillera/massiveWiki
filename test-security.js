/**
 * Security regression tests
 * Covers: XSS sanitization, file-upload type restriction,
 *         security headers, and rate limiting.
 *
 * Run:  node test-security.js
 */

'use strict';

const http     = require('http');
const fs       = require('fs').promises;
const fsSync   = require('fs');
const path     = require('path');
const assert   = require('assert');
const { spawn } = require('child_process');
const FormData  = require('form-data');

// ─── Import pure functions for unit tests ──────────────────────────────────
const { sanitize, imageFilter } = require('./server.js');

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

// ─── HTTP helper (used by integration tests) ───────────────────────────────
function makeRequest(method, urlPath, data = null, isFormData = false, port = TEST_PORT, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = isFormData ? data.getHeaders() : { 'Content-Type': 'application/json' };
    const options = {
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      headers: { ...defaultHeaders, ...extraHeaders },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, data: body }); }
      });
    });

    req.on('error', reject);

    if (data) {
      if (isFormData) { data.pipe(req); }
      else { req.write(JSON.stringify(data)); req.end(); }
    } else {
      req.end();
    }
  });
}

// ─── Test server helpers ───────────────────────────────────────────────────
const TEST_PORT    = 3099;
const TEST_HOME    = path.join(__dirname, 'test-security-data');
const TEST_PAGES   = path.join(TEST_HOME, 'pages');
const TEST_IMAGES  = path.join(TEST_HOME, 'images');
const TEST_WIKI    = path.join(TEST_HOME, '_wiki');

async function setupTestDir() {
  await fs.mkdir(TEST_PAGES,  { recursive: true });
  await fs.mkdir(TEST_IMAGES, { recursive: true });
  await fs.mkdir(TEST_WIKI,   { recursive: true });
  await fs.writeFile(path.join(TEST_PAGES, 'home.md'), '# Home');
  await fs.writeFile(path.join(TEST_WIKI, '_config.json'), '{}');
  await fs.writeFile(path.join(TEST_WIKI, '_sidebar.md'), '');
  await fs.writeFile(path.join(TEST_WIKI, '_footer.md'), '');
}

async function teardownTestDir() {
  await fs.rm(TEST_HOME, { recursive: true, force: true });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT:                    String(TEST_PORT),
      RATE_LIMIT_MAX:          '8',   // low so we can trigger it in tests
      RATE_LIMIT_WRITE_MAX:    '5',
      RATE_LIMIT_WINDOW_MS:    '60000',
    };
    const proc = spawn('node', ['server.js', '--home', TEST_HOME], { env });
    let ready = false;

    proc.stdout.on('data', d => {
      if (d.toString().includes('Massive Wiki running') && !ready) {
        ready = true;
        setTimeout(() => resolve(proc), 300);
      }
    });
    proc.stderr.on('data', d => {
      // suppress noisy dotenv output; show real errors
      const s = d.toString();
      if (!s.includes('[dotenv')) process.stderr.write('server: ' + s);
    });
    setTimeout(() => { if (!ready) reject(new Error('Server failed to start')); }, 8000);
  });
}

// ─── Minimal 1×1 pixel PNG (valid image bytes) ────────────────────────────
const VALID_PNG = Buffer.from([
  0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,
  0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
  0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,
  0xDE,0x00,0x00,0x00,0x0C,0x49,0x44,0x41,
  0x54,0x08,0xD7,0x63,0xF8,0xCF,0xC0,0x00,
  0x00,0x03,0x01,0x01,0x00,0x18,0xDD,0x8D,
  0xB4,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,
  0x44,0xAE,0x42,0x60,0x82,
]);

// ═══════════════════════════════════════════════════════════════════════════
// UNIT TESTS — no server required
// ═══════════════════════════════════════════════════════════════════════════

async function runUnitTests() {
  console.log('\n── Unit tests: sanitize() ─────────────────────────────────');

  await test('strips <script> tags', () => {
    const out = sanitize('<p>Hello</p><script>alert("xss")</script>');
    ok(!out.includes('<script'), `Output still contains <script>: ${out}`);
    ok(out.includes('Hello'), 'Safe content was removed');
  });

  await test('strips inline event handlers (onerror, onclick, onload)', () => {
    const out = sanitize('<img src="x" onerror="alert(1)"><p onclick="evil()">hi</p>');
    ok(!out.includes('onerror'), `onerror survived: ${out}`);
    ok(!out.includes('onclick'), `onclick survived: ${out}`);
  });

  await test('strips javascript: href', () => {
    const out = sanitize('<a href="javascript:alert(1)">click</a>');
    ok(!out.includes('javascript:'), `javascript: href survived: ${out}`);
  });

  await test('strips data: href (not a known safe scheme for anchors)', () => {
    const out = sanitize('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    ok(!out.includes('data:text'), `data: href survived: ${out}`);
  });

  await test('strips <iframe> tags', () => {
    const out = sanitize('<iframe src="https://evil.com"></iframe>');
    ok(!out.includes('iframe'), `iframe survived: ${out}`);
  });

  await test('strips <style> tags', () => {
    const out = sanitize('<style>body { display:none }</style><p>text</p>');
    ok(!out.includes('<style'), `<style> survived: ${out}`);
    ok(out.includes('text'), 'Safe content was removed');
  });

  await test('preserves standard markdown output tags', () => {
    const out = sanitize('<h1>Title</h1><p>Para <strong>bold</strong> <em>italic</em></p><ul><li>item</li></ul>');
    ok(out.includes('<h1>'), 'h1 was stripped');
    ok(out.includes('<strong>'), 'strong was stripped');
    ok(out.includes('<em>'), 'em was stripped');
    ok(out.includes('<li>'), 'li was stripped');
  });

  await test('preserves wikilink attributes (class, data-page, data-exists)', () => {
    const out = sanitize('<a href="/foo" class="wikilink" data-page="foo" data-exists="true">Foo</a>');
    ok(out.includes('class="wikilink"'),   'class was stripped');
    ok(out.includes('data-page="foo"'),    'data-page was stripped');
    ok(out.includes('data-exists="true"'), 'data-exists was stripped');
  });

  await test('preserves code blocks', () => {
    const out = sanitize('<pre><code class="language-js">const x = 1;</code></pre>');
    ok(out.includes('<pre>'), 'pre was stripped');
    ok(out.includes('<code'), 'code was stripped');
    ok(out.includes('const x'), 'code content was stripped');
  });

  await test('preserves images with safe src', () => {
    const out = sanitize('<img src="/images/photo.png" alt="photo">');
    ok(out.includes('<img'), 'img was stripped');
    ok(out.includes('alt="photo"'), 'alt was stripped');
  });

  await test('strips images with javascript: src', () => {
    const out = sanitize('<img src="javascript:alert(1)" alt="x">');
    ok(!out.includes('javascript:'), `javascript: img src survived: ${out}`);
  });

  console.log('\n── Unit tests: imageFilter() ──────────────────────────────');

  function runFilter(mimetype, filename) {
    return new Promise((resolve) => {
      imageFilter({}, { mimetype, originalname: filename }, (err, accept) => {
        resolve({ err, accept });
      });
    });
  }

  await test('accepts image/jpeg with .jpg extension', async () => {
    const { err, accept } = await runFilter('image/jpeg', 'photo.jpg');
    ok(!err, `Unexpected error: ${err?.message}`);
    ok(accept === true, 'JPEG was rejected');
  });

  await test('accepts image/png with .png extension', async () => {
    const { err, accept } = await runFilter('image/png', 'photo.png');
    ok(!err && accept === true, 'PNG was rejected');
  });

  await test('accepts image/gif with .gif extension', async () => {
    const { err, accept } = await runFilter('image/gif', 'anim.gif');
    ok(!err && accept === true, 'GIF was rejected');
  });

  await test('accepts image/webp with .webp extension', async () => {
    const { err, accept } = await runFilter('image/webp', 'img.webp');
    ok(!err && accept === true, 'WebP was rejected');
  });

  await test('rejects text/html regardless of extension', async () => {
    const { err, accept } = await runFilter('text/html', 'evil.html');
    ok(err, 'HTML file was accepted (expected rejection)');
    ok(accept === false, 'accept flag should be false');
    ok(err.code === 'INVALID_FILE_TYPE', `Wrong error code: ${err.code}`);
  });

  await test('rejects application/javascript', async () => {
    const { err, accept } = await runFilter('application/javascript', 'evil.js');
    ok(err && accept === false, 'JS file was accepted');
  });

  await test('rejects image/svg+xml (SVG can embed scripts)', async () => {
    const { err, accept } = await runFilter('image/svg+xml', 'logo.svg');
    ok(err && accept === false, 'SVG was accepted');
  });

  await test('rejects .html extension even with image/ MIME type (double-check)', async () => {
    const { err, accept } = await runFilter('image/png', 'disguised.html');
    ok(err && accept === false, 'File with .html extension was accepted');
  });

  await test('rejects .php extension', async () => {
    const { err, accept } = await runFilter('image/jpeg', 'shell.php');
    ok(err && accept === false, '.php file was accepted');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION TESTS — requires the spawned server
// ═══════════════════════════════════════════════════════════════════════════

async function runIntegrationTests() {
  console.log('\n── Integration tests: security headers ────────────────────');

  const { headers } = await makeRequest('GET', '/api/tree');

  await test('X-Frame-Options header is set', () => {
    // helmet sets frame-ancestors in CSP; also sets x-frame-options
    const has = headers['x-frame-options'] || headers['content-security-policy']?.includes('frame-ancestors');
    ok(has, `Neither x-frame-options nor frame-ancestors CSP found. Headers: ${JSON.stringify(headers)}`);
  });

  await test('X-Content-Type-Options: nosniff is set', () => {
    ok(headers['x-content-type-options'] === 'nosniff',
       `x-content-type-options: ${headers['x-content-type-options']}`);
  });

  await test('Content-Security-Policy header is present', () => {
    ok(headers['content-security-policy'], 'CSP header missing');
  });

  await test("CSP contains default-src 'self'", () => {
    ok(headers['content-security-policy']?.includes("default-src 'self'"),
       `CSP: ${headers['content-security-policy']}`);
  });

  await test("CSP blocks object-src (set to 'none')", () => {
    ok(headers['content-security-policy']?.includes("object-src 'none'"),
       `CSP missing object-src 'none': ${headers['content-security-policy']}`);
  });

  await test('Referrer-Policy header is set', () => {
    ok(headers['referrer-policy'], `referrer-policy missing. Headers: ${JSON.stringify(headers)}`);
  });

  // ── XSS sanitization via HTTP ──────────────────────────────────────────
  console.log('\n── Integration tests: XSS sanitization ───────────────────');

  // Write a malicious page directly to disk (bypasses auth, tests the GET path)
  const maliciousContent = [
    '# XSS Test',
    '',
    '<script>alert("stored-xss")</script>',
    '',
    '<img src="x" onerror="alert(1)">',
    '',
    '<a href="javascript:alert(2)">click me</a>',
    '',
    'Safe paragraph.',
  ].join('\n');
  await fs.writeFile(path.join(TEST_PAGES, 'xss-test.md'), maliciousContent);

  const pageResp = await makeRequest('GET', '/api/page/xss-test');

  // We check only the rendered `content` field — the `raw` field intentionally
  // holds the original markdown source for the editor and is never set as innerHTML.
  const renderedHtml = pageResp.data.content || '';

  await test('page response does not contain <script> tag', () => {
    ok(pageResp.status === 200, `Expected 200, got ${pageResp.status}`);
    ok(!renderedHtml.includes('<script'), `<script> survived in rendered content: ${renderedHtml}`);
  });

  await test('page response does not contain onerror handler', () => {
    ok(!renderedHtml.includes('onerror'), `onerror survived in rendered content: ${renderedHtml}`);
  });

  await test('page response does not contain javascript: href', () => {
    ok(!renderedHtml.includes('javascript:'), `javascript: survived in rendered content: ${renderedHtml}`);
  });

  await test('page response still contains safe content', () => {
    const html = typeof pageResp.data === 'object' ? pageResp.data.content : pageResp.data;
    ok(html && html.includes('Safe paragraph'), 'Safe paragraph was removed by sanitizer');
  });

  // ── File upload type restriction via HTTP ──────────────────────────────
  console.log('\n── Integration tests: file upload restriction ─────────────');

  // Upload attempt without auth → 401 (proves auth guard runs before fileFilter)
  await test('upload without auth token returns 401', async () => {
    const form = new FormData();
    form.append('image', Buffer.from('<html>evil</html>'), { filename: 'evil.html', contentType: 'text/html' });
    const resp = await makeRequest('POST', '/api/upload-image', form, true);
    ok(resp.status === 401, `Expected 401, got ${resp.status}`);
  });

  // ── Rate limiting ──────────────────────────────────────────────────────
  console.log('\n── Integration tests: rate limiting ───────────────────────');

  await test('read limiter returns 429 after exceeding max requests', async () => {
    // RATE_LIMIT_MAX is set to 8 for tests; hammer the read endpoint 10 times
    let lastStatus = null;
    for (let i = 0; i < 10; i++) {
      const resp = await makeRequest('GET', '/api/tree');
      lastStatus = resp.status;
      if (resp.status === 429) break;
    }
    ok(lastStatus === 429, `Expected a 429 after 8 requests, last status was ${lastStatus}`);
  });

  await test('rate limit response body includes error message', async () => {
    // We are already over the limit from the previous test; this request should 429 too.
    const resp = await makeRequest('GET', '/api/tree');
    ok(resp.status === 429, `Expected 429, got ${resp.status}`);
    ok(resp.data && resp.data.error, `429 body missing error field: ${JSON.stringify(resp.data)}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('=== Security Tests ===');

  // ── Unit tests first (no server) ──────────────────────────────────────
  await runUnitTests();

  // ── Integration tests (spawn server) ──────────────────────────────────
  console.log('\n── Spinning up test server… ───────────────────────────────');
  await setupTestDir();
  let server;
  try {
    server = await startServer();
    console.log(`   Test server on port ${TEST_PORT}\n`);
    await runIntegrationTests();
  } finally {
    if (server) server.kill();
    await teardownTestDir();
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  if (failed === 0) {
    console.log('\n  ✓ All security tests passed\n');
    process.exit(0);
  } else {
    console.log('\n  ✗ Some tests failed\n');
    process.exit(1);
  }
}

process.on('unhandledRejection', async err => {
  console.error('Unhandled error:', err);
  await teardownTestDir().catch(() => {});
  process.exit(1);
});

main().catch(async err => {
  console.error('Fatal error:', err);
  await teardownTestDir().catch(() => {});
  process.exit(1);
});
