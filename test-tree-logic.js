/**
 * Unit tests for tree building logic
 * Tests parent-child relationships and page type classification
 */

const fs = require('fs').promises;
const path = require('path');
const assert = require('assert');

// Copy of buildTree function from server.js for testing
async function buildTree(dir, basePath = '') {
  const items = await fs.readdir(dir, { withFileTypes: true });
  const tree = [];

  // Group items by base name to detect page+folder combinations
  const mdFiles = new Map();
  const directories = new Map();

  for (const item of items) {
    if (item.name.startsWith('.')) continue; // Skip hidden files

    if (item.isDirectory()) {
      directories.set(item.name, item);
    } else if (item.name.endsWith('.md')) {
      const baseName = item.name.replace('.md', '');
      mdFiles.set(baseName, item);
    }
  }

  // Process all unique base names
  const allNames = new Set([...mdFiles.keys(), ...directories.keys()]);

  for (const name of allNames) {
    const hasMdFile = mdFiles.has(name);
    const hasDirectory = directories.has(name);

    const itemPath = path.join(basePath, name);
    let children = [];

    // If there's a directory, get its children
    if (hasDirectory) {
      children = await buildTree(path.join(dir, name), itemPath);
    }

    if (hasMdFile && hasDirectory) {
      // Page with children - can be clicked for content AND expanded for children
      tree.push({
        name: name,
        path: itemPath,
        type: 'page-parent',
        hasContent: true,
        children: children
      });
    } else if (hasMdFile) {
      // Page without children - just clickable
      tree.push({
        name: name,
        path: itemPath,
        type: 'page',
        hasContent: true,
        children: []
      });
    } else if (hasDirectory) {
      // Directory without a corresponding .md file - just a container
      tree.push({
        name: name,
        path: itemPath,
        type: 'folder',
        hasContent: false,
        children: children
      });
    }
  }

  // Sort alphabetically
  return tree.sort((a, b) => a.name.localeCompare(b.name));
}

// Test utilities
let testCount = 0;
let passedTests = 0;
let failedTests = 0;

function test(description, fn) {
  testCount++;
  try {
    fn();
    passedTests++;
    console.log(`✓ Test ${testCount}: ${description}`);
  } catch (error) {
    failedTests++;
    console.error(`✗ Test ${testCount}: ${description}`);
    console.error(`  Error: ${error.message}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  try {
    assert.deepStrictEqual(actual, expected);
  } catch (error) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Run tests
async function runTests() {
  console.log('\n=== Tree Logic Unit Tests ===\n');

  try {
    // Build the tree from actual pages directory
    const tree = await buildTree('pages');

    // Test 1: Tree is an array
    test('buildTree returns an array', () => {
      assert(Array.isArray(tree), 'Tree should be an array');
    });

    // Test 2: Tree has items
    test('buildTree returns non-empty array', () => {
      assert(tree.length > 0, 'Tree should have at least one item');
    });

    // Test 3: Find index page
    const indexPage = tree.find(item => item.name === 'index');
    test('index page exists in tree', () => {
      assert(indexPage !== undefined, 'index page should exist');
    });

    // Test 4: Index page has correct properties
    test('index page has correct properties', () => {
      assert.strictEqual(indexPage.name, 'index');
      assert.strictEqual(indexPage.hasContent, true);
      assert.strictEqual(indexPage.path, 'index');
    });

    // Test 5: Find guides (should be page-parent if guides.md and guides/ both exist)
    const guidesItem = tree.find(item => item.name === 'guides');
    test('guides item exists', () => {
      assert(guidesItem !== undefined, 'guides should exist in tree');
    });

    // Test 6: Check guides type
    test('guides is a page-parent (has content and children)', () => {
      assert.strictEqual(guidesItem.type, 'page-parent', 'guides should be page-parent type');
      assert.strictEqual(guidesItem.hasContent, true, 'guides should have content');
      assert(Array.isArray(guidesItem.children), 'guides should have children array');
      assert(guidesItem.children.length > 0, 'guides should have at least one child');
    });

    // Test 7: Check guides children
    test('guides has expected children', () => {
      const childNames = guidesItem.children.map(c => c.name);
      assert(childNames.includes('markdown-basics'), 'guides should have markdown-basics child');
      assert(childNames.includes('wikilinks'), 'guides should have wikilinks child');
    });

    // Test 8: Check child page properties
    const markdownBasics = guidesItem.children.find(c => c.name === 'markdown-basics');
    test('markdown-basics has correct properties', () => {
      assert.strictEqual(markdownBasics.type, 'page', 'markdown-basics should be type page');
      assert.strictEqual(markdownBasics.hasContent, true, 'markdown-basics should have content');
      assert.strictEqual(markdownBasics.path, 'guides/markdown-basics', 'markdown-basics should have correct path');
    });

    // Test 9: Check reference folder (if it exists)
    const referenceItem = tree.find(item => item.name === 'reference');
    if (referenceItem) {
      test('reference folder has children', () => {
        assert(Array.isArray(referenceItem.children), 'reference should have children array');
      });
    }

    // Test 10: All items have required properties
    test('all tree items have required properties', () => {
      function checkItem(item) {
        assert(item.name, 'Item should have name');
        assert(item.path, 'Item should have path');
        assert(item.type, 'Item should have type');
        assert(item.hasContent !== undefined, 'Item should have hasContent property');
        assert(Array.isArray(item.children) || item.children === undefined, 'Children should be array or undefined');

        // Check children recursively
        if (item.children && item.children.length > 0) {
          item.children.forEach(checkItem);
        }
      }

      tree.forEach(checkItem);
    });

    // Test 11: Type consistency
    test('page types are consistent with content and children', () => {
      function checkTypes(item) {
        if (item.type === 'page') {
          assert.strictEqual(item.hasContent, true, `${item.name} is type 'page' but hasContent is false`);
          assert.strictEqual(item.children.length, 0, `${item.name} is type 'page' but has children`);
        } else if (item.type === 'page-parent') {
          assert.strictEqual(item.hasContent, true, `${item.name} is type 'page-parent' but hasContent is false`);
          assert(item.children.length > 0, `${item.name} is type 'page-parent' but has no children`);
        } else if (item.type === 'folder') {
          assert.strictEqual(item.hasContent, false, `${item.name} is type 'folder' but hasContent is true`);
          assert(Array.isArray(item.children), `${item.name} is type 'folder' but has no children array`);
        }

        // Check children recursively
        if (item.children && item.children.length > 0) {
          item.children.forEach(checkTypes);
        }
      }

      tree.forEach(checkTypes);
    });

    // Test 12: Paths are correct
    test('all paths are correctly formed', () => {
      function checkPaths(item, expectedPrefix = '') {
        const expectedPath = expectedPrefix ? `${expectedPrefix}/${item.name}` : item.name;
        assert.strictEqual(item.path, expectedPath, `${item.name} has incorrect path`);

        if (item.children && item.children.length > 0) {
          item.children.forEach(child => checkPaths(child, expectedPath));
        }
      }

      tree.forEach(item => checkPaths(item));
    });

    // Print summary
    console.log('\n=== Test Summary ===');
    console.log(`Total tests: ${testCount}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${failedTests}`);

    if (failedTests === 0) {
      console.log('\n✓ All tests passed!\n');
      process.exit(0);
    } else {
      console.log('\n✗ Some tests failed\n');
      process.exit(1);
    }

  } catch (error) {
    console.error('Error running tests:', error);
    process.exit(1);
  }
}

// Run the tests
runTests();
