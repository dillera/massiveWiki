const http = require('http');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const FormData = require('form-data');

const TEST_PORT = 3001;
const TEST_HOME = 'test-upload-data';
const IMAGES_DIR = path.join(TEST_HOME, 'images');

// Simple test utilities
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  return async () => {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (error) {
      console.log(`✗ ${name}`);
      console.log(`  ${error.message}`);
      if (error.stack) {
        console.log(`  ${error.stack.split('\n').slice(1, 3).join('\n')}`);
      }
      failed++;
    }
  };
}

// HTTP request helper
function makeRequest(method, path, data = null, isFormData = false) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: TEST_PORT,
      path: path,
      method: method,
      headers: isFormData ? data.getHeaders() : {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      if (isFormData) {
        data.pipe(req);
      } else {
        req.write(JSON.stringify(data));
        req.end();
      }
    } else {
      req.end();
    }
  });
}

// Create a test image file
async function createTestImage(filename = 'test-image.png') {
  const testImagePath = path.join(__dirname, filename);

  // Create a minimal valid PNG (1x1 pixel, red)
  const pngData = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 pixel
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D,
    0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
    0x44, 0xAE, 0x42, 0x60, 0x82
  ]);

  await fs.writeFile(testImagePath, pngData);
  return testImagePath;
}

// Setup and cleanup
async function setup() {
  console.log('Setting up test environment...');

  // Create test directories
  await fs.mkdir(TEST_HOME, { recursive: true });
  await fs.mkdir(path.join(TEST_HOME, 'pages'), { recursive: true });
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.mkdir(path.join(TEST_HOME, '_wiki'), { recursive: true });

  // Create minimal required files
  await fs.writeFile(path.join(TEST_HOME, 'pages', 'home.md'), '# Test Home');
  await fs.writeFile(path.join(TEST_HOME, '_wiki', '_config.json'), '{}');
  await fs.writeFile(path.join(TEST_HOME, '_wiki', '_sidebar.md'), '# Sidebar');
  await fs.writeFile(path.join(TEST_HOME, '_wiki', '_footer.md'), '# Footer');
}

async function cleanup() {
  console.log('\nCleaning up...');
  await fs.rm(TEST_HOME, { recursive: true, force: true });
  await fs.unlink('test-image.png').catch(() => {});
  await fs.unlink('test-upload.jpg').catch(() => {});
}

// Start test server
function startServer() {
  return new Promise((resolve, reject) => {
    // Spawn server process
    const { spawn } = require('child_process');
    const server = spawn('node', ['server.js', '--home', TEST_HOME], {
      env: { ...process.env, PORT: TEST_PORT }
    });

    let started = false;

    server.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Massive Wiki running') && !started) {
        started = true;
        setTimeout(() => resolve(server), 500); // Give it a moment to fully start
      }
    });

    server.stderr.on('data', (data) => {
      console.error('Server error:', data.toString());
    });

    setTimeout(() => {
      if (!started) {
        reject(new Error('Server failed to start in time'));
      }
    }, 5000);
  });
}

// Tests
const tests = [
  test('upload a PNG image successfully', async () => {
    const testImagePath = await createTestImage();

    const form = new FormData();
    form.append('image', fsSync.createReadStream(testImagePath));

    const response = await makeRequest('POST', '/api/upload-image', form, true);

    assert(response.status === 200, `Expected status 200, got ${response.status}`);
    assert(response.data.success === true, 'Response should indicate success');
    assert(response.data.url, 'Response should include image URL');
    assert(response.data.filename, 'Response should include filename');
    assert(response.data.url.startsWith('/images/'), 'URL should start with /images/');

    // Verify file was actually saved
    const files = await fs.readdir(IMAGES_DIR);
    assert(files.length > 0, 'Images directory should contain uploaded file');

    const savedFile = files.find(f => f === response.data.filename);
    assert(savedFile, `File ${response.data.filename} should exist in images directory`);
  }),

  test('upload a JPEG image successfully', async () => {
    // Create a minimal JPEG
    const jpegData = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
      0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9
    ]);
    await fs.writeFile('test-upload.jpg', jpegData);

    const form = new FormData();
    form.append('image', fsSync.createReadStream('test-upload.jpg'));

    const response = await makeRequest('POST', '/api/upload-image', form, true);

    assert(response.status === 200, `Expected status 200, got ${response.status}`);
    assert(response.data.success === true, 'JPEG upload should succeed');
  }),

  test('return error when no file is uploaded', async () => {
    const form = new FormData();
    // Don't append any file

    const response = await makeRequest('POST', '/api/upload-image', form, true);

    assert(response.status === 400, `Expected status 400, got ${response.status}`);
    assert(response.data.error, 'Response should include error message');
    assert(response.data.error.includes('No file'), 'Error should mention no file uploaded');
  }),

  test('get list of uploaded images', async () => {
    const response = await makeRequest('GET', '/api/images');

    assert(response.status === 200, `Expected status 200, got ${response.status}`);
    assert(Array.isArray(response.data), 'Response should be an array');
    assert(response.data.length >= 2, `Should have at least 2 images, got ${response.data.length}`);

    // Check that our test images are in the list
    const hasImage = response.data.some(img => img.endsWith('.png') || img.endsWith('.jpg'));
    assert(hasImage, 'Image list should include uploaded images');
  }),

  test('uploaded images have unique filenames', async () => {
    // Upload same file twice
    const testImagePath = await createTestImage('test-unique.png');

    const form1 = new FormData();
    form1.append('image', fsSync.createReadStream(testImagePath));
    const response1 = await makeRequest('POST', '/api/upload-image', form1, true);

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 10));

    const form2 = new FormData();
    form2.append('image', fsSync.createReadStream(testImagePath));
    const response2 = await makeRequest('POST', '/api/upload-image', form2, true);

    assert(response1.data.filename !== response2.data.filename,
      'Duplicate uploads should have different filenames');

    // Cleanup
    await fs.unlink('test-unique.png');
  }),

  test('images are stored in correct directory', async () => {
    const files = await fs.readdir(IMAGES_DIR);
    assert(files.length > 0, 'Images directory should not be empty after uploads');

    // Check that at least one file exists and is readable
    const firstFile = files[0];
    const filePath = path.join(IMAGES_DIR, firstFile);
    const stats = await fs.stat(filePath);
    assert(stats.isFile(), 'Uploaded item should be a file');
    assert(stats.size > 0, 'Uploaded file should have content');
  }),

  test('image list filters non-image files', async () => {
    // Create a non-image file
    await fs.writeFile(path.join(IMAGES_DIR, 'test.txt'), 'not an image');

    const response = await makeRequest('GET', '/api/images');

    assert(response.status === 200, 'Should successfully get image list');
    const hasTxtFile = response.data.some(img => img.endsWith('.txt'));
    assert(!hasTxtFile, 'Image list should not include .txt files');
  })
];

// Run all tests
async function runTests() {
  console.log('=== Image Upload Tests ===\n');

  await setup();

  const server = await startServer();
  console.log(`Test server started on port ${TEST_PORT}\n`);

  // Run tests sequentially
  for (const testFn of tests) {
    await testFn();
  }

  // Cleanup
  server.kill();
  await cleanup();

  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Handle errors
process.on('unhandledRejection', async (error) => {
  console.error('Unhandled error:', error);
  await cleanup();
  process.exit(1);
});

runTests().catch(async (error) => {
  console.error('Test error:', error);
  await cleanup();
  process.exit(1);
});
