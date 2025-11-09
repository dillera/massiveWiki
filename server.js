const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { marked } = require('marked');
const { exec } = require('child_process');
const util = require('util');
const multer = require('multer');

const execPromise = util.promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

// Parse command line arguments for --home parameter
function parseArgs() {
  const args = process.argv.slice(2);
  const homeIndex = args.indexOf('--home');

  if (homeIndex !== -1 && args[homeIndex + 1]) {
    return path.resolve(args[homeIndex + 1]);
  }

  // Default to current directory/wiki-data
  return path.resolve('./wiki-data');
}

const WIKI_HOME = parseArgs();
const PAGES_DIR = path.join(WIKI_HOME, 'pages');
const IMAGES_DIR = path.join(WIKI_HOME, 'images');
const WIKI_DIR = path.join(WIKI_HOME, '_wiki');

// Initialize wiki directory structure
async function initializeWiki() {
  console.log(`Wiki home directory: ${WIKI_HOME}`);

  // Check if this is first run
  const homePagePath = path.join(PAGES_DIR, 'home.md');
  const isFirstRun = !fsSync.existsSync(homePagePath);

  // Create directories
  await fs.mkdir(WIKI_HOME, { recursive: true });
  await fs.mkdir(PAGES_DIR, { recursive: true });
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.mkdir(WIKI_DIR, { recursive: true });

  if (isFirstRun) {
    console.log('First run detected - initializing wiki structure...');

    // Create home.md
    const homeContent = `# Welcome to Massive Wiki

This is your wiki home page. This page cannot be renamed or deleted.

## Getting Started

Check out the [[getting-started|Getting Started]] guide to learn how to use your wiki.

## Features

- **Wikilinks**: Use \`[[PageName]]\` to link to any page globally
- **Markdown**: Full GitHub Flavored Markdown support
- **Organization**: Organize pages in folders and hierarchies
- **Git Backup**: Built-in backup to remote repositories
- **Simple**: All pages are just markdown files on disk

## Quick Links

- [[getting-started|Getting Started Guide]]
- Edit this page to customize your home page
- Click the Admin button to configure special pages

Start creating your knowledge base!
`;
    await fs.writeFile(homePagePath, homeContent, 'utf-8');
    console.log('✓ Created home.md');

    // Create getting-started.md
    const gettingStartedContent = `# Getting Started

Welcome to Massive Wiki! This guide will help you get started.

## Creating Pages

There are two ways to create pages:

1. **Click the + New button** in the header and enter a title and path
2. **Use red wikilinks**: Write \`[[NewPage]]\` in any page, and click the red link to create it

## Wikilinks

Link to any page using double brackets:

- \`[[PageName]]\` - Links to a page and displays the page name
- \`[[PageName|Display Text]]\` - Links to a page but shows custom text

Wikilinks are **global** - \`[[home]]\` works from anywhere in the wiki!

## Organizing Pages

Create folders to organize related pages:

- \`guides/tutorial\` creates tutorial.md in the guides folder
- Use the left sidebar to browse your page hierarchy

## Editing

1. Click the **Edit** button to edit any page
2. Write your content in GitHub Flavored Markdown
3. Click **Save** to save changes
4. Click **Preview** to see how it looks

## Special Pages

Access the **Admin** panel (purple gear button) to edit:

- **Sidebar**: Appears on the right side of every page
- **Footer**: Appears at the bottom of every page
- **Config**: Wiki settings and configuration

## Images

1. Click **Edit** on a page
2. Click **Insert Image**
3. Upload a new image or select an existing one
4. The markdown code is inserted automatically

## Git Backup

1. Click the **Backup** button
2. Enter your remote repository URL (first time only)
3. Enter a commit message
4. Click **Backup Now**

Your wiki is backed up to Git!

## Need Help?

- Check the Manual.md file in the project root
- All your pages are stored in: \`${PAGES_DIR}\`
- Images are stored in: \`${IMAGES_DIR}\`

Happy wiki-ing!
`;
    await fs.writeFile(path.join(PAGES_DIR, 'getting-started.md'), gettingStartedContent, 'utf-8');
    console.log('✓ Created getting-started.md');

    // Create _sidebar.md
    const sidebarContent = `## Quick Links

- [[home|Home]]
- [[getting-started|Getting Started]]

## Navigation

Browse pages using the left sidebar tree view.

## Resources

- [Markdown Guide](https://guides.github.com/features/mastering-markdown/)
`;
    await fs.writeFile(path.join(WIKI_DIR, '_sidebar.md'), sidebarContent, 'utf-8');
    console.log('✓ Created _sidebar.md');

    // Create _footer.md
    const footerContent = `---
**Massive Wiki** | Powered by Markdown | [Admin](/admin)
`;
    await fs.writeFile(path.join(WIKI_DIR, '_footer.md'), footerContent, 'utf-8');
    console.log('✓ Created _footer.md');

    // Create _config.json
    const config = {
      wikiName: "Massive Wiki",
      wikiDescription: "A simple, fast wiki document management system",
      showSidebar: true,
      showGlobalFooter: true,
      theme: "default",
      enableWikilinks: true,
      defaultHomePage: "home"
    };
    await fs.writeFile(path.join(WIKI_DIR, '_config.json'), JSON.stringify(config, null, 2), 'utf-8');
    console.log('✓ Created _config.json');

    console.log('✓ Wiki initialization complete!');
  }
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, IMAGES_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/images', express.static(IMAGES_DIR));

// Configure marked for GitHub Flavored Markdown
marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: true,
  mangle: false
});

// Global page index: maps page names to their full paths
let pageIndex = {};

// Build page index by scanning all pages
async function buildPageIndex() {
  pageIndex = {};

  async function scanDirectory(dir, relativePath = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        await scanDirectory(fullPath, relPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Get the page name without .md extension
        const pageName = entry.name.slice(0, -3);
        // Get the full path without .md extension
        const pagePathWithoutExt = relPath.slice(0, -3);

        // Store in index: both simple name and full path
        // Simple name (e.g., "atari" -> "computers/atari")
        if (!pageIndex[pageName.toLowerCase()]) {
          pageIndex[pageName.toLowerCase()] = pagePathWithoutExt;
        }
        // Full path (e.g., "computers/atari" -> "computers/atari")
        pageIndex[pagePathWithoutExt.toLowerCase()] = pagePathWithoutExt;
      }
    }
  }

  try {
    await scanDirectory(PAGES_DIR);
    console.log(`Page index built: ${Object.keys(pageIndex).length} entries`);
  } catch (error) {
    console.error('Error building page index:', error);
  }
}

// Helper function to process wikilinks
async function processWikilinks(content, currentPagePath) {
  const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
  const matches = [...content.matchAll(wikilinkRegex)];

  let processedContent = content;

  for (const match of matches) {
    const fullMatch = match[1].trim();

    // Handle [[PageName|Display Text]] syntax
    let pageName, displayText;
    if (fullMatch.includes('|')) {
      const parts = fullMatch.split('|');
      pageName = parts[0].trim().toLowerCase().replace(/\s+/g, '-');
      displayText = parts[1].trim();
    } else {
      pageName = fullMatch.toLowerCase().replace(/\s+/g, '-');
      displayText = fullMatch;
    }

    // Look up page in global index
    const targetPath = pageIndex[pageName];
    let exists = false;
    let linkPath;

    if (targetPath) {
      // Page exists in index
      exists = true;
      linkPath = targetPath;
    } else {
      // Page doesn't exist - will be a red link
      // Determine where to create the new page based on context
      exists = false;

      // If we're on the home page or home is the current page, create at root
      // Otherwise, create as a child of the current page
      if (!currentPagePath || currentPagePath === 'home') {
        linkPath = pageName;
      } else {
        linkPath = `${currentPagePath}/${pageName}`;
      }
    }

    // Create the link HTML with data-parent attribute for context
    const cssClass = exists ? 'wikilink' : 'wikilink wikilink-new';
    const linkHtml = `<a href="/${linkPath}" class="${cssClass}" data-page="${linkPath}" data-exists="${exists}">${displayText}</a>`;

    processedContent = processedContent.replace(match[0], linkHtml);
  }

  return processedContent;
}

// Helper function to check if a page exists
async function pageExists(pagePath) {
  const filePath = path.join(PAGES_DIR, pagePath + '.md');
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Helper function to find all references to a page
async function findPageReferences(pagePath) {
  const references = [];

  // Get the page name from the path
  const parts = pagePath.split('/');
  const pageName = parts[parts.length - 1];

  // Recursively scan all .md files
  async function scanDirectory(dir, basePath = '') {
    const items = await fs.readdir(dir, { withFileTypes: true });

    for (const item of items) {
      if (item.name.startsWith('.')) continue;

      const fullPath = path.join(dir, item.name);
      const relativePath = path.join(basePath, item.name);

      if (item.isDirectory()) {
        await scanDirectory(fullPath, relativePath);
      } else if (item.name.endsWith('.md')) {
        const content = await fs.readFile(fullPath, 'utf-8');
        const filePagePath = relativePath.replace('.md', '');

        // Check for wikilinks: [[pageName]] or [[path/to/pageName]]
        const wikilinkPattern = new RegExp(`\\[\\[([^\\]]*${pageName}[^\\]]*)\\]\\]`, 'gi');
        const wikilinkMatches = [...content.matchAll(wikilinkPattern)];

        // Check for markdown links: [text](pagePath)
        const mdLinkPattern = new RegExp(`\\[[^\\]]+\\]\\(/?${pagePath.replace(/\//g, '\\/')}\\)`, 'gi');
        const mdLinkMatches = [...content.matchAll(mdLinkPattern)];

        if (wikilinkMatches.length > 0 || mdLinkMatches.length > 0) {
          references.push({
            file: filePagePath,
            filePath: fullPath,
            wikilinks: wikilinkMatches.length,
            mdlinks: mdLinkMatches.length,
            total: wikilinkMatches.length + mdLinkMatches.length
          });
        }
      }
    }
  }

  await scanDirectory(PAGES_DIR);
  return references;
}

// Helper function to update references when renaming a page
async function updatePageReferences(oldPath, newPath) {
  const oldParts = oldPath.split('/');
  const newParts = newPath.split('/');
  const oldName = oldParts[oldParts.length - 1];
  const newName = newParts[newParts.length - 1];

  const updates = [];

  // Recursively update all .md files
  async function updateDirectory(dir, basePath = '') {
    const items = await fs.readdir(dir, { withFileTypes: true });

    for (const item of items) {
      if (item.name.startsWith('.')) continue;

      const fullPath = path.join(dir, item.name);
      const relativePath = path.join(basePath, item.name);

      if (item.isDirectory()) {
        await updateDirectory(fullPath, relativePath);
      } else if (item.name.endsWith('.md')) {
        let content = await fs.readFile(fullPath, 'utf-8');
        let modified = false;

        // Update wikilinks - case insensitive
        const wikilinkPattern = new RegExp(`\\[\\[([^\\]]*${oldName}[^\\]]*)\\]\\]`, 'gi');
        const newContent = content.replace(wikilinkPattern, (match, linkText) => {
          modified = true;
          // Replace just the name part, preserving case structure
          return `[[${linkText.replace(new RegExp(oldName, 'gi'), newName)}]]`;
        });

        // Update markdown links
        const mdLinkPattern = new RegExp(`(\\[[^\\]]+\\]\\()/?${oldPath.replace(/\//g, '\\/')}(\\))`, 'gi');
        const finalContent = newContent.replace(mdLinkPattern, (match, before, after) => {
          modified = true;
          return `${before}${newPath}${after}`;
        });

        if (modified) {
          await fs.writeFile(fullPath, finalContent, 'utf-8');
          updates.push(relativePath.replace('.md', ''));
        }
      }
    }
  }

  await updateDirectory(PAGES_DIR);
  return updates;
}

// Helper function to build directory tree
// Handles pages that can be both content (page) and parent (with children)
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

// API: Preview markdown content
app.post('/api/preview', async (req, res) => {
  try {
    const { content, currentPage } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Process wikilinks in the content
    const processedContent = await processWikilinks(content, currentPage || 'home');

    // Convert to HTML
    const html = marked.parse(processedContent);

    res.json({ html });
  } catch (error) {
    console.error('Error rendering preview:', error);
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

// API: Get directory tree
app.get('/api/tree', async (req, res) => {
  try {
    const tree = await buildTree(PAGES_DIR);
    res.json(tree);
  } catch (error) {
    console.error('Error building tree:', error);
    res.status(500).json({ error: 'Failed to build directory tree' });
  }
});

// API: Get page content
app.get('/api/page/*', async (req, res) => {
  try {
    let pagePath = req.params[0] || 'home';

    // Remove leading slash if present
    if (pagePath.startsWith('/')) pagePath = pagePath.slice(1);

    const filePath = path.join(PAGES_DIR, pagePath + '.md');

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Page not found' });
    }

    const content = await fs.readFile(filePath, 'utf-8');

    // Extract footer if present (content after ---)
    const parts = content.split(/\n---+\n/);
    let mainContent = content;
    let footerContent = '';

    if (parts.length > 1) {
      mainContent = parts.slice(0, -1).join('\n---\n');
      footerContent = parts[parts.length - 1];
    }

    // Process wikilinks in main content and footer
    const processedMain = await processWikilinks(mainContent, pagePath);
    const processedFooter = footerContent ? await processWikilinks(footerContent, pagePath) : '';

    // Convert to HTML
    const html = marked.parse(processedMain);
    const footerHtml = processedFooter ? marked.parse(processedFooter) : '';

    res.json({
      path: pagePath,
      content: html,
      footer: footerHtml,
      raw: content
    });
  } catch (error) {
    console.error('Error reading page:', error);
    res.status(500).json({ error: 'Failed to read page' });
  }
});

// API: Save page
app.post('/api/page/*', async (req, res) => {
  try {
    let pagePath = req.params[0] || 'home';
    if (pagePath.startsWith('/')) pagePath = pagePath.slice(1);

    const filePath = path.join(PAGES_DIR, pagePath + '.md');
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Create directory if it doesn't exist
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write file
    await fs.writeFile(filePath, content, 'utf-8');

    res.json({ success: true, path: pagePath });
  } catch (error) {
    console.error('Error saving page:', error);
    res.status(500).json({ error: 'Failed to save page' });
  }
});

// API: Check if page exists
app.get('/api/exists/*', async (req, res) => {
  try {
    let pagePath = req.params[0];
    if (pagePath.startsWith('/')) pagePath = pagePath.slice(1);

    const exists = await pageExists(pagePath);
    res.json({ exists });
  } catch (error) {
    console.error('Error checking page existence:', error);
    res.status(500).json({ error: 'Failed to check page' });
  }
});

// API: Create new page
app.post('/api/create', async (req, res) => {
  try {
    const { path: pagePath, title } = req.body;

    if (!pagePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const filePath = path.join(PAGES_DIR, pagePath + '.md');

    // Check if file already exists
    try {
      await fs.access(filePath);
      return res.status(400).json({ error: 'Page already exists' });
    } catch {
      // File doesn't exist, continue
    }

    // Create directory if needed
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Create initial content
    const initialContent = `# ${title || 'New Page'}\n\nStart writing your content here...\n`;
    await fs.writeFile(filePath, initialContent, 'utf-8');

    // Rebuild page index
    await buildPageIndex();

    res.json({ success: true, path: pagePath });
  } catch (error) {
    console.error('Error creating page:', error);
    res.status(500).json({ error: 'Failed to create page' });
  }
});

// API: Delete page
app.delete('/api/page/*', async (req, res) => {
  try {
    let pagePath = req.params[0];
    if (pagePath.startsWith('/')) pagePath = pagePath.slice(1);

    if (pagePath === 'home') {
      return res.status(400).json({ error: 'Cannot delete home page' });
    }

    const filePath = path.join(PAGES_DIR, pagePath + '.md');
    const folderPath = path.join(PAGES_DIR, pagePath);

    // Delete the .md file if it exists
    try {
      await fs.unlink(filePath);
    } catch (err) {
      // File might not exist, that's ok
    }

    // Delete the folder and all children if it exists
    try {
      const stats = await fs.stat(folderPath);
      if (stats.isDirectory()) {
        await fs.rm(folderPath, { recursive: true, force: true });
      }
    } catch (err) {
      // Folder might not exist, that's ok
    }

    // Rebuild page index
    await buildPageIndex();

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting page:', error);
    res.status(500).json({ error: 'Failed to delete page' });
  }
});

// API: Get child pages
app.get('/api/children/*', async (req, res) => {
  try {
    let pagePath = req.params[0];
    if (pagePath.startsWith('/')) pagePath = pagePath.slice(1);

    const folderPath = path.join(PAGES_DIR, pagePath);
    const children = [];

    // Check if folder exists
    try {
      const stats = await fs.stat(folderPath);
      if (stats.isDirectory()) {
        // Recursively scan for all child pages
        async function scanChildren(dir, relativePath = '') {
          const items = await fs.readdir(dir, { withFileTypes: true });
          for (const item of items) {
            if (item.name.startsWith('.')) continue;

            const itemPath = relativePath ? `${relativePath}/${item.name}` : item.name;

            if (item.isFile() && item.name.endsWith('.md')) {
              children.push(itemPath.replace('.md', ''));
            } else if (item.isDirectory()) {
              await scanChildren(path.join(dir, item.name), itemPath);
            }
          }
        }

        await scanChildren(folderPath, pagePath);
      }
    } catch (err) {
      // Folder doesn't exist, no children
    }

    res.json({ children, count: children.length });
  } catch (error) {
    console.error('Error getting children:', error);
    res.status(500).json({ error: 'Failed to get children' });
  }
});

// API: Get references to a page
app.get('/api/references/*', async (req, res) => {
  try {
    let pagePath = req.params[0];
    if (pagePath.startsWith('/')) pagePath = pagePath.slice(1);

    const references = await findPageReferences(pagePath);
    res.json({ references, count: references.length });
  } catch (error) {
    console.error('Error finding references:', error);
    res.status(500).json({ error: 'Failed to find references' });
  }
});

// API: Rename page
app.post('/api/rename', async (req, res) => {
  try {
    const { oldPath, newName } = req.body;

    if (!oldPath || !newName) {
      return res.status(400).json({ error: 'oldPath and newName are required' });
    }

    // Protect home page from being renamed
    if (oldPath === 'home') {
      return res.status(400).json({ error: 'Cannot rename the home page' });
    }

    // Validate newName: only letters, numbers, hyphens
    if (!/^[a-z0-9-]+$/i.test(newName)) {
      return res.status(400).json({ error: 'Page name can only contain letters, numbers, and hyphens' });
    }

    // Build new path
    const oldParts = oldPath.split('/');
    const newParts = [...oldParts];
    newParts[newParts.length - 1] = newName.toLowerCase();
    const newPath = newParts.join('/');

    // Check if new path already exists
    const newExists = await pageExists(newPath);
    if (newExists) {
      return res.status(400).json({ error: 'A page with this name already exists' });
    }

    const oldFilePath = path.join(PAGES_DIR, oldPath + '.md');
    const newFilePath = path.join(PAGES_DIR, newPath + '.md');
    const oldFolderPath = path.join(PAGES_DIR, oldPath);
    const newFolderPath = path.join(PAGES_DIR, newPath);

    // Check if old file exists
    try {
      await fs.access(oldFilePath);
    } catch {
      return res.status(404).json({ error: 'Page not found' });
    }

    // Update all references first
    const updatedPages = await updatePageReferences(oldPath, newPath);

    // Rename the file
    await fs.rename(oldFilePath, newFilePath);

    // If there's a corresponding folder, rename it too
    try {
      await fs.access(oldFolderPath);
      await fs.rename(oldFolderPath, newFolderPath);
    } catch {
      // No folder exists, that's okay
    }

    // Rebuild page index
    await buildPageIndex();

    res.json({
      success: true,
      oldPath,
      newPath,
      updatedPages,
      updatedCount: updatedPages.length
    });
  } catch (error) {
    console.error('Error renaming page:', error);
    res.status(500).json({ error: error.message || 'Failed to rename page' });
  }
});

// API: Get special page
app.get('/api/special/:page', async (req, res) => {
  try {
    const { page } = req.params;
    const filePath = path.join(WIKI_DIR, `${page}.md`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      res.json({ content });
    } catch {
      // File doesn't exist, return empty
      res.json({ content: '' });
    }
  } catch (error) {
    console.error('Error reading special page:', error);
    res.status(500).json({ error: 'Failed to read special page' });
  }
});

// API: Save special page
app.post('/api/special/:page', async (req, res) => {
  try {
    const { page } = req.params;
    const { content } = req.body;

    if (!content && content !== '') {
      return res.status(400).json({ error: 'Content is required' });
    }

    const filePath = path.join(WIKI_DIR, `${page}.md`);
    await fs.writeFile(filePath, content, 'utf-8');

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving special page:', error);
    res.status(500).json({ error: 'Failed to save special page' });
  }
});

// API: Get config
app.get('/api/config', async (req, res) => {
  try {
    const filePath = path.join(WIKI_DIR, '_config.json');

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const config = JSON.parse(content);
      res.json(config);
    } catch {
      // Return default config
      res.json({
        wikiName: 'Massive Wiki',
        wikiDescription: 'A simple, fast wiki document management system',
        showSidebar: true,
        showGlobalFooter: true,
        theme: 'default',
        enableWikilinks: true,
        defaultHomePage: 'index'
      });
    }
  } catch (error) {
    console.error('Error reading config:', error);
    res.status(500).json({ error: 'Failed to read config' });
  }
});

// API: Save config
app.post('/api/config', async (req, res) => {
  try {
    const config = req.body;

    const filePath = path.join(WIKI_DIR, '_config.json');
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// API: Upload image
app.post('/api/upload-image', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err);
      // "Unexpected end of form" means no file was uploaded
      if (err.message && err.message.includes('Unexpected end of form')) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      return res.status(500).json({ error: 'Failed to upload image', details: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const imageUrl = `/images/${req.file.filename}`;
    res.json({ success: true, url: imageUrl, filename: req.file.filename });
  });
});

// API: Get image list
app.get('/api/images', async (req, res) => {
  try {
    const files = await fs.readdir(IMAGES_DIR);
    const images = files.filter(f => /\.(jpg|jpeg|png|gif|svg|webp)$/i.test(f));
    res.json(images);
  } catch (error) {
    console.error('Error listing images:', error);
    res.status(500).json({ error: 'Failed to list images' });
  }
});

// API: Git operations
app.post('/api/git/init', async (req, res) => {
  try {
    await execPromise('git init');
    await execPromise('git add .');
    await execPromise('git commit -m "Initial commit"');
    res.json({ success: true, message: 'Git repository initialized' });
  } catch (error) {
    console.error('Error initializing git:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/git/backup', async (req, res) => {
  try {
    const { remote, message } = req.body;

    // Add all changes
    await execPromise('git add .');

    // Commit
    const commitMessage = message || `Backup ${new Date().toISOString()}`;
    await execPromise(`git commit -m "${commitMessage}" || true`); // Don't fail if nothing to commit

    // Push if remote is provided
    if (remote) {
      // Check if remote exists
      try {
        await execPromise('git remote get-url origin');
      } catch {
        // Remote doesn't exist, add it
        await execPromise(`git remote add origin ${remote}`);
      }

      await execPromise('git push -u origin main || git push -u origin master');
    }

    res.json({ success: true, message: 'Backup completed' });
  } catch (error) {
    console.error('Error during backup:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/git/status', async (req, res) => {
  try {
    const { stdout } = await execPromise('git status --porcelain');
    const hasChanges = stdout.trim().length > 0;
    res.json({ hasChanges, status: stdout });
  } catch (error) {
    res.json({ hasChanges: false, error: 'Not a git repository' });
  }
});

// Serve main app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
(async () => {
  await initializeWiki();
  await buildPageIndex();
  app.listen(PORT, () => {
    console.log(`Massive Wiki running on http://localhost:${PORT}`);
  });
})();
