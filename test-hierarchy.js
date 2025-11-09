const fs = require('fs').promises;
const path = require('path');

// Mock file system structure for testing
const mockFileSystem = {
  'test-data/pages': {
    'home.md': 'content',
    'getting-started.md': 'content',
    'systems.md': 'content',
    'systems': {
      'atari.md': 'content',
      'nintendo.md': 'content'
    },
    'guides.md': 'content',
    'guides': {
      'intro.md': 'content',
      'advanced': {
        'tips.md': 'content'
      }
    }
  }
};

// Setup mock file system
async function setupMockFS(structure, basePath = '') {
  for (const [name, content] of Object.entries(structure)) {
    const fullPath = path.join(basePath, name);

    if (typeof content === 'object') {
      // It's a directory
      await fs.mkdir(fullPath, { recursive: true });
      await setupMockFS(content, fullPath);
    } else {
      // It's a file
      await fs.writeFile(fullPath, content, 'utf-8');
    }
  }
}

// Clean up mock file system
async function cleanupMockFS() {
  await fs.rm('test-data', { recursive: true, force: true });
}

// Copy buildTree function from server.js for testing
async function buildTree(dir, basePath = '') {
  const items = await fs.readdir(dir, { withFileTypes: true });
  const tree = [];
  const processedNames = new Set();

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

  // Sort: home first, then alphabetically
  return tree.sort((a, b) => {
    if (a.name === 'home') return -1;
    if (b.name === 'home') return 1;
    return a.name.localeCompare(b.name);
  });
}

// Test utilities
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function findNode(tree, path) {
  const parts = path.split('/');
  let current = tree;

  for (const part of parts) {
    const node = current.find(n => n.name === part);
    if (!node) return null;
    current = node.children;
  }

  return current;
}

function findNodeByName(tree, name) {
  for (const node of tree) {
    if (node.name === name) return node;
    if (node.children) {
      const found = findNodeByName(node.children, name);
      if (found) return found;
    }
  }
  return null;
}

// Tests
async function runTests() {
  console.log('Setting up mock file system...');
  await setupMockFS(mockFileSystem);

  console.log('\nBuilding tree...');
  const tree = await buildTree('test-data/pages');

  console.log('\n=== Tree Structure ===');
  console.log(JSON.stringify(tree, null, 2));

  console.log('\n=== Running Tests ===\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (error) {
      console.log(`✗ ${name}`);
      console.log(`  ${error.message}`);
      failed++;
    }
  }

  // Test 1: Home is first
  test('home is the first item in the tree', () => {
    assert(tree[0].name === 'home', `Expected first item to be 'home', got '${tree[0].name}'`);
  });

  // Test 2: Home is a simple page (not a page-parent in this structure)
  test('home is a page type', () => {
    const home = tree[0];
    assert(home.type === 'page', `Expected home to be 'page', got '${home.type}'`);
    assert(home.hasContent === true, 'home should have content');
  });

  // Test 3: Getting started exists at root
  test('getting-started exists at root level', () => {
    const gs = tree.find(n => n.name === 'getting-started');
    assert(gs !== undefined, 'getting-started not found');
    assert(gs.type === 'page', `Expected 'page', got '${gs.type}'`);
  });

  // Test 4: Systems is a page-parent
  test('systems is a page-parent (has .md file AND folder)', () => {
    const systems = tree.find(n => n.name === 'systems');
    assert(systems !== undefined, 'systems not found');
    assert(systems.type === 'page-parent', `Expected 'page-parent', got '${systems.type}'`);
    assert(systems.hasContent === true, 'systems should have content');
    assert(systems.children.length > 0, 'systems should have children');
  });

  // Test 5: Atari is a child of systems
  test('atari is a child of systems', () => {
    const systems = tree.find(n => n.name === 'systems');
    const atari = systems.children.find(n => n.name === 'atari');
    assert(atari !== undefined, 'atari not found in systems children');
    assert(atari.path === 'systems/atari', `Expected path 'systems/atari', got '${atari.path}'`);
    assert(atari.type === 'page', `Expected 'page', got '${atari.type}'`);
  });

  // Test 6: Nintendo is a child of systems
  test('nintendo is a child of systems', () => {
    const systems = tree.find(n => n.name === 'systems');
    const nintendo = systems.children.find(n => n.name === 'nintendo');
    assert(nintendo !== undefined, 'nintendo not found in systems children');
    assert(nintendo.path === 'systems/nintendo', `Expected path 'systems/nintendo', got '${nintendo.path}'`);
  });

  // Test 7: Guides is a page-parent
  test('guides is a page-parent', () => {
    const guides = tree.find(n => n.name === 'guides');
    assert(guides !== undefined, 'guides not found');
    assert(guides.type === 'page-parent', `Expected 'page-parent', got '${guides.type}'`);
  });

  // Test 8: Intro is a child of guides
  test('intro is a child of guides', () => {
    const guides = tree.find(n => n.name === 'guides');
    const intro = guides.children.find(n => n.name === 'intro');
    assert(intro !== undefined, 'intro not found in guides children');
    assert(intro.path === 'guides/intro', `Expected path 'guides/intro', got '${intro.path}'`);
  });

  // Test 9: Advanced is a folder (no .md file) under guides
  test('advanced is a folder under guides', () => {
    const guides = tree.find(n => n.name === 'guides');
    const advanced = guides.children.find(n => n.name === 'advanced');
    assert(advanced !== undefined, 'advanced not found in guides children');
    assert(advanced.type === 'folder', `Expected 'folder', got '${advanced.type}'`);
    assert(advanced.hasContent === false, 'advanced should not have content (no .md file)');
  });

  // Test 10: Tips is a child of advanced
  test('tips is a child of guides/advanced', () => {
    const guides = tree.find(n => n.name === 'guides');
    const advanced = guides.children.find(n => n.name === 'advanced');
    const tips = advanced.children.find(n => n.name === 'tips');
    assert(tips !== undefined, 'tips not found in advanced children');
    assert(tips.path === 'guides/advanced/tips', `Expected path 'guides/advanced/tips', got '${tips.path}'`);
  });

  // Test 11: Hierarchy is preserved (3 levels deep)
  test('hierarchy is preserved for 3-level nesting', () => {
    const guidesNode = findNodeByName(tree, 'guides');
    assert(guidesNode !== null, 'guides not found');

    const advancedNode = findNodeByName(guidesNode.children, 'advanced');
    assert(advancedNode !== null, 'advanced not found in guides');

    const tipsNode = findNodeByName(advancedNode.children, 'tips');
    assert(tipsNode !== null, 'tips not found in advanced');
    assert(tipsNode.path === 'guides/advanced/tips', 'tips has wrong path');
  });

  // Test 12: Alphabetical sorting (except home)
  test('items are sorted alphabetically (except home first)', () => {
    const names = tree.map(n => n.name);
    assert(names[0] === 'home', 'home should be first');

    const rest = names.slice(1);
    const sortedRest = [...rest].sort();
    assert(JSON.stringify(rest) === JSON.stringify(sortedRest),
      `Items not sorted: ${rest.join(', ')}`);
  });

  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  console.log('\nCleaning up...');
  await cleanupMockFS();

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Test error:', error);
  cleanupMockFS().then(() => process.exit(1));
});
