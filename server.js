require('dotenv').config();

const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { marked } = require('marked');
const { execFile } = require('child_process');
const util = require('util');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const sanitizeHtml = require('sanitize-html');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const crypto = require('crypto');

const execFilePromise = util.promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3200;

// Initialize Supabase client (null when credentials are not yet configured)
let supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

// ---------------------------------------------------------------------------
// XSS: sanitize HTML produced by marked before sending to clients.
// We use an allowlist of safe tags and attributes; everything else is stripped.
// ---------------------------------------------------------------------------
const SANITIZE_OPTIONS = {
  allowedTags: [
    // Headings / structure
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'blockquote', 'pre', 'hr', 'br', 'div', 'article', 'section',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'caption',
    'figure', 'figcaption',
    // Inline
    'a', 'em', 'strong', 'code', 'kbd', 'del', 's', 'ins', 'mark',
    'span', 'abbr', 'cite', 'sub', 'sup', 'small', 'b', 'i', 'u',
    // Media
    'img',
  ],
  allowedAttributes: {
    // wikilinks use class / data-page / data-exists
    'a': ['href', 'title', 'target', 'rel', 'class', 'data-page', 'data-exists'],
    'img': ['src', 'alt', 'title', 'width', 'height'],
    // syntax-highlighting libraries add classes
    'code': ['class'],
    'pre':  ['class'],
    'span': ['class'],
    'div':  ['class'],
    'th': ['align', 'scope'],
    'td': ['align'],
    'col': ['span'],
    'table': ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    'img': ['http', 'https', 'data'],
    'a':   ['http', 'https', 'mailto'],
  },
  allowProtocolRelative: false, // blocks //evil.com hrefs
};

function sanitize(html) {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

// ---------------------------------------------------------------------------
// File upload: only allow genuine image types; SVG is excluded because
// browsers execute <script> inside SVG served with the image/svg+xml MIME type.
// ---------------------------------------------------------------------------
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const ALLOWED_EXTENSIONS = /\.(jpe?g|png|gif|webp)$/i;

function imageFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.test(file.originalname)) {
    return cb(Object.assign(new Error('Only JPEG, PNG, GIF and WebP images are allowed'), { code: 'INVALID_FILE_TYPE' }), false);
  }
  cb(null, true);
}

// ---------------------------------------------------------------------------
// Rate limiting — limits are configurable via env so tests can use low values.
// ---------------------------------------------------------------------------
const READ_LIMIT_MAX  = parseInt(process.env.RATE_LIMIT_MAX       || '500', 10);
const WRITE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_WRITE_MAX || '60',  10);
const LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10);

const readLimiter = rateLimit({
  windowMs: LIMIT_WINDOW_MS,
  max: READ_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const writeLimiter = rateLimit({
  windowMs: LIMIT_WINDOW_MS,
  max: WRITE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Strict rate limiter for the one-time setup endpoint (5 attempts per hour)
const setupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many setup attempts, please try again later.' },
});

// Rate limiter for the local admin login (10 attempts per 15 minutes)
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

// Middleware to verify JWT token from Supabase
async function verifyAuth(req) {
  if (!supabase) return null; // Supabase not yet configured

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch (error) {
    console.error('Error verifying token:', error);
    return null;
  }
}

// Middleware: require a valid Supabase session OR local admin session for mutating endpoints
async function requireAuth(req, res, next) {
  // Local admin session (permanent failsafe — works even without Supabase configured)
  if (req.session && req.session.adminLoggedIn) {
    req.user = { email: req.session.adminUser.email, isLocalAdmin: true };
    return next();
  }
  // Supabase JWT
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(503).json({ error: 'Authentication not configured on this server.' });
  }
  const user = await verifyAuth(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required', message: 'You must be logged in to perform this action.' });
  }
  req.user = user;
  next();
}

// Resolve a user-supplied relative path against a trusted base directory.
// Returns the resolved absolute path, or null if the path would escape baseDir.
function safePath(baseDir, userInput) {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(path.join(baseDir, userInput));
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    return null;
  }
  return resolved;
}

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
const ADMIN_FILE = path.join(WIKI_HOME, '_wiki', '_admin.json');

// Returns true once the admin account has been created via /setup
function isAdminConfigured() {
  return fsSync.existsSync(ADMIN_FILE);
}

// Initialize wiki directory structure.
// Accepts an optional wikiHome override so unit tests can use a temp dir.
async function initializeWiki(wikiHome = WIKI_HOME) {
  const pagesDir = path.join(wikiHome, 'pages');
  const imagesDir = path.join(wikiHome, 'images');
  const wikiDir   = path.join(wikiHome, '_wiki');

  console.log(`Wiki home directory: ${wikiHome}`);

  // Check if this is first run
  const homePagePath = path.join(pagesDir, 'home.md');
  const isFirstRun = !fsSync.existsSync(homePagePath);

  // Create directories
  await fs.mkdir(wikiHome,   { recursive: true });
  await fs.mkdir(pagesDir,   { recursive: true });
  await fs.mkdir(imagesDir,  { recursive: true });
  await fs.mkdir(wikiDir,    { recursive: true });

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
- All your pages are stored in: \`${pagesDir}\`
- Images are stored in: \`${imagesDir}\`

Happy wiki-ing!
`;
    await fs.writeFile(path.join(pagesDir, 'getting-started.md'), gettingStartedContent, 'utf-8');
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
    await fs.writeFile(path.join(wikiDir, '_sidebar.md'), sidebarContent, 'utf-8');
    console.log('✓ Created _sidebar.md');

    // Create _footer.md
    const footerContent = `---
**Massive Wiki** | Powered by Markdown | [Admin](/admin)
`;
    await fs.writeFile(path.join(wikiDir, '_footer.md'), footerContent, 'utf-8');
    console.log('✓ Created _footer.md');

    // Create secure.md (protected page)
    const secureContent = `# Secure Page

This is a protected page that requires authentication to view.

## Authentication Status

This page is automatically protected when authentication is enabled in the Admin panel.

## How Authentication Works

1. Go to the **Admin Panel** (gear button in the header)
2. Navigate to the **Authentication** section
3. Follow the setup instructions to configure Supabase
4. Toggle **Enable Authentication** and save
5. Create user accounts via the Supabase dashboard links
6. Log in to access this page

## What's Protected

When authentication is enabled, this "Secure" page requires login to view. You can add more pages to the protected list by editing the configuration.
`;
    await fs.writeFile(path.join(pagesDir, 'secure.md'), secureContent, 'utf-8');
    console.log('✓ Created secure.md (protected page)');

    // Create _config.json
    const config = {
      wikiName: "Massive Wiki",
      wikiDescription: "A simple, fast wiki document management system",
      showSidebar: true,
      showGlobalFooter: true,
      theme: "default",
      enableWikilinks: true,
      defaultHomePage: "home",
      authEnabled: false,
      protectedPages: ["secure"]
    };
    await fs.writeFile(path.join(wikiDir, '_config.json'), JSON.stringify(config, null, 2), 'utf-8');
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
    // Always lowercase the extension to avoid .JPG / .PNG surprises
    cb(null, uniqueSuffix + path.extname(file.originalname).toLowerCase());
  }
});
const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
});

// Trust the first proxy (nginx) — required for correct IP detection and secure cookies behind a reverse proxy
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Subpath / reverse-proxy helpers
// ---------------------------------------------------------------------------

// Returns the pathname prefix from BASE_URL, e.g. "/wiki" from
// "https://apps.diller.org/wiki".  Empty string when BASE_URL is not set.
function getBasePath() {
  if (!process.env.BASE_URL) return '';
  try {
    return new URL(process.env.BASE_URL).pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
}

// Injects a <base> tag and window.APP_BASE into HTML so that:
//   • all relative asset paths (css/style.css, js/app.js …) resolve correctly
//     regardless of the URL depth the browser is visiting
//   • JS code can prepend APP_BASE to absolute API paths (/api/…)
function injectMeta(html) {
  const base = getBasePath();
  const baseHref = base ? base + '/' : '/';
  const injection = `<base href="${baseHref}">\n    <script>window.APP_BASE = '${base}';</script>`;
  return html.replace('<head>', `<head>\n    ${injection}`);
}

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      // 'unsafe-inline' is required by the openPreview() document.write() feature
      scriptSrc:   ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com"],
      imgSrc:      ["'self'", "data:", "blob:"],
      connectSrc:  ["'self'", ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : [])],
      objectSrc:   ["'none'"],
      frameAncestors: ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // would break the Supabase CDN script
}));
app.use('/api/', readLimiter);
app.use(express.json());

// ---------------------------------------------------------------------------
// Session middleware — used for the local admin failsafe account.
// Auto-generates SESSION_SECRET and saves it to .env if not already set,
// so sessions survive server restarts without manual configuration.
// ---------------------------------------------------------------------------
if (!process.env.SESSION_SECRET) {
  const generated = crypto.randomBytes(32).toString('hex');
  process.env.SESSION_SECRET = generated;
  const envPath = path.join(__dirname, '.env');
  try {
    let envContent = '';
    try { envContent = fsSync.readFileSync(envPath, 'utf8'); } catch { /* new file */ }
    if (!envContent.includes('SESSION_SECRET=')) {
      envContent += `\nSESSION_SECRET=${generated}\n`;
      fsSync.writeFileSync(envPath, envContent, { mode: 0o600 });
      console.log('Generated and saved SESSION_SECRET to .env');
    }
  } catch (e) {
    console.warn('Could not save SESSION_SECRET to .env:', e.message);
  }
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ---------------------------------------------------------------------------
// Setup-mode guard: redirect all requests to /setup until the admin account
// has been created. Must run BEFORE express.static so that visiting / does
// not serve index.html before the guard has a chance to redirect.
// Static assets (css/js/images) and the setup routes are exempt.
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  if (isAdminConfigured()) return next();
  const exempt = ['/setup', '/api/setup', '/css/', '/js/', '/images/', '/favicon'];
  if (exempt.some(p => req.path.startsWith(p))) return next();
  // API calls get a JSON error instead of a redirect
  if (req.path.startsWith('/api/')) {
    return res.status(503).json({ error: 'Server not yet configured. Complete setup at /setup.' });
  }
  res.redirect(getBasePath() + '/setup');
});

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
  const filePath = safePath(PAGES_DIR, pagePath + '.md');
  if (!filePath) return false;
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

    // Convert to HTML and sanitize to prevent XSS
    const html = sanitize(marked.parse(processedContent));

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

    // Check if page is protected and requires authentication
    try {
      const configPath = path.join(WIKI_DIR, '_config.json');
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      // If auth is enabled and page is protected
      if (config.authEnabled && config.protectedPages && config.protectedPages.includes(pagePath)) {
        // Accept local admin session as well as Supabase JWT
        const localAdmin = req.session && req.session.adminLoggedIn;
        const user = localAdmin ? req.session.adminUser : await verifyAuth(req);

        if (!user) {
          return res.status(401).json({
            error: 'Authentication required',
            message: 'This page requires authentication to view. Please log in.'
          });
        }

        console.log(`User ${user.email} accessing protected page: ${pagePath}`);
      }
    } catch (configError) {
      console.error('Error checking auth config:', configError);
      // Continue without auth check if config is missing
    }

    const filePath = safePath(PAGES_DIR, pagePath + '.md');
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid page path' });
    }

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

    // Convert to HTML and sanitize to prevent XSS
    const html = sanitize(marked.parse(processedMain));
    const footerHtml = processedFooter ? sanitize(marked.parse(processedFooter)) : '';

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

// Tighter rate limit on all mutating endpoints
app.use([
  '/api/page', '/api/create', '/api/rename', '/api/special',
  '/api/config', '/api/upload-image', '/api/logo', '/api/git',
], writeLimiter);

// API: Save page
app.post('/api/page/*', requireAuth, async (req, res) => {
  try {
    let pagePath = req.params[0] || 'home';
    if (pagePath.startsWith('/')) pagePath = pagePath.slice(1);

    const filePath = safePath(PAGES_DIR, pagePath + '.md');
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid page path' });
    }
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

    if (!safePath(PAGES_DIR, pagePath + '.md')) {
      return res.status(400).json({ error: 'Invalid page path' });
    }

    const exists = await pageExists(pagePath);
    res.json({ exists });
  } catch (error) {
    console.error('Error checking page existence:', error);
    res.status(500).json({ error: 'Failed to check page' });
  }
});

// API: Create new page
app.post('/api/create', requireAuth, async (req, res) => {
  try {
    const { path: pagePath, title } = req.body;

    if (!pagePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const filePath = safePath(PAGES_DIR, pagePath + '.md');
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid page path' });
    }

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
app.delete('/api/page/*', requireAuth, async (req, res) => {
  try {
    let pagePath = req.params[0];
    if (pagePath.startsWith('/')) pagePath = pagePath.slice(1);

    if (pagePath === 'home') {
      return res.status(400).json({ error: 'Cannot delete home page' });
    }

    const filePath = safePath(PAGES_DIR, pagePath + '.md');
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid page path' });
    }
    const folderPath = safePath(PAGES_DIR, pagePath);
    if (!folderPath) {
      return res.status(400).json({ error: 'Invalid page path' });
    }

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
app.post('/api/rename', requireAuth, async (req, res) => {
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

    const oldFilePath = safePath(PAGES_DIR, oldPath + '.md');
    const newFilePath = safePath(PAGES_DIR, newPath + '.md');
    const oldFolderPath = safePath(PAGES_DIR, oldPath);
    const newFolderPath = safePath(PAGES_DIR, newPath);

    if (!oldFilePath || !newFilePath || !oldFolderPath || !newFolderPath) {
      return res.status(400).json({ error: 'Invalid page path' });
    }

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
    const filePath = safePath(WIKI_DIR, `${page}.md`);
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid page name' });
    }

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
app.post('/api/special/:page', requireAuth, async (req, res) => {
  try {
    const { page } = req.params;
    const { content } = req.body;

    if (!content && content !== '') {
      return res.status(400).json({ error: 'Content is required' });
    }

    const filePath = safePath(WIKI_DIR, `${page}.md`);
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid page name' });
    }
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
app.post('/api/config', requireAuth, async (req, res) => {
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

// API: Get Supabase config for client
app.get('/api/auth/config', async (req, res) => {
  try {
    // Load wiki config to check if auth is enabled
    const configPath = path.join(WIKI_DIR, '_config.json');
    let authEnabled = false;

    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      authEnabled = config.authEnabled || false;
    } catch {
      authEnabled = false;
    }

    res.json({
      authEnabled,
      supabaseUrl: process.env.SUPABASE_URL || null,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
      hasSupabaseConfig: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
      localAdminConfigured: isAdminConfigured(),
      localAdminLoggedIn: !!(req.session && req.session.adminLoggedIn),
      baseUrl: process.env.BASE_URL || null,
    });
  } catch (error) {
    console.error('Error loading auth config:', error);
    res.status(500).json({ error: 'Failed to load auth config' });
  }
});

// API: Save Supabase credentials — writes to .env and hot-reloads the client
app.post('/api/auth/supabase-config', requireAuth, async (req, res) => {
  const { supabaseUrl, supabaseAnonKey } = req.body || {};

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(400).json({ error: 'supabaseUrl and supabaseAnonKey are required.' });
  }

  const url = supabaseUrl.trim();
  const key = supabaseAnonKey.trim();

  if (!/^https:\/\/[a-zA-Z0-9-]+\.supabase\.co$/.test(url)) {
    return res.status(400).json({ error: 'Invalid Supabase URL. Expected format: https://your-project.supabase.co' });
  }
  if (!key.startsWith('eyJ')) {
    return res.status(400).json({ error: 'Invalid anon key format. Paste the full key from your Supabase project settings.' });
  }

  try {
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    try { envContent = fsSync.readFileSync(envPath, 'utf8'); } catch { /* file may not exist yet */ }

    // Update existing lines or append
    if (/^SUPABASE_URL=/m.test(envContent)) {
      envContent = envContent.replace(/^SUPABASE_URL=.*/m, `SUPABASE_URL=${url}`);
    } else {
      envContent += `\nSUPABASE_URL=${url}`;
    }
    if (/^SUPABASE_ANON_KEY=/m.test(envContent)) {
      envContent = envContent.replace(/^SUPABASE_ANON_KEY=.*/m, `SUPABASE_ANON_KEY=${key}`);
    } else {
      envContent += `\nSUPABASE_ANON_KEY=${key}`;
    }

    fsSync.writeFileSync(envPath, envContent, { mode: 0o600 });

    // Hot-reload: update process.env and recreate the client — no restart needed
    process.env.SUPABASE_URL = url;
    process.env.SUPABASE_ANON_KEY = key;
    supabase = createClient(url, key);

    console.log('Supabase configuration updated and client reloaded.');
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving Supabase config:', err);
    res.status(500).json({ error: 'Failed to save Supabase configuration.' });
  }
});

// API: Upload image
app.post('/api/upload-image', requireAuth, (req, res) => {
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

// API: Upload logo
app.post('/api/logo/upload', requireAuth, (req, res) => {
  upload.single('logo')(req, res, async (err) => {
    if (err) {
      console.error('Multer error:', err);
      return res.status(500).json({ error: 'Failed to upload logo', details: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      // Remove any existing logo files
      const files = await fs.readdir(IMAGES_DIR);
      const existingLogos = files.filter(f => f.startsWith('_logo.'));
      for (const logo of existingLogos) {
        await fs.unlink(path.join(IMAGES_DIR, logo));
      }

      // Rename uploaded file to _logo.<ext>
      const ext = path.extname(req.file.filename);
      const logoName = `_logo${ext}`;
      const oldPath = path.join(IMAGES_DIR, req.file.filename);
      const newPath = path.join(IMAGES_DIR, logoName);

      await fs.rename(oldPath, newPath);

      const logoUrl = `/images/${logoName}`;
      res.json({ success: true, url: logoUrl, filename: logoName });
    } catch (error) {
      console.error('Error processing logo:', error);
      res.status(500).json({ error: 'Failed to process logo' });
    }
  });
});

// API: Get logo
app.get('/api/logo', async (req, res) => {
  try {
    const files = await fs.readdir(IMAGES_DIR);
    const logo = files.find(f => f.startsWith('_logo.') && /\.(jpg|jpeg|png)$/i.test(f));

    if (logo) {
      res.json({ exists: true, url: `/images/${logo}` });
    } else {
      res.json({ exists: false });
    }
  } catch (error) {
    console.error('Error checking logo:', error);
    res.status(500).json({ error: 'Failed to check logo' });
  }
});

// API: Delete logo
app.delete('/api/logo', requireAuth, async (req, res) => {
  try {
    const files = await fs.readdir(IMAGES_DIR);
    const existingLogos = files.filter(f => f.startsWith('_logo.'));

    for (const logo of existingLogos) {
      await fs.unlink(path.join(IMAGES_DIR, logo));
    }

    res.json({ success: true, message: 'Logo deleted' });
  } catch (error) {
    console.error('Error deleting logo:', error);
    res.status(500).json({ error: 'Failed to delete logo' });
  }
});

// API: Git operations
app.post('/api/git/init', requireAuth, async (req, res) => {
  try {
    await execFilePromise('git', ['init'], { cwd: WIKI_HOME });
    await execFilePromise('git', ['add', '.'], { cwd: WIKI_HOME });
    await execFilePromise('git', ['commit', '-m', 'Initial commit'], { cwd: WIKI_HOME });
    res.json({ success: true, message: 'Git repository initialized' });
  } catch (error) {
    console.error('Error initializing git:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/git/backup', requireAuth, async (req, res) => {
  try {
    const { remote, message } = req.body;

    // Validate remote URL format if provided
    if (remote && !/^(https?:\/\/|git@|ssh:\/\/)[\w.@:/~-]+$/.test(remote)) {
      return res.status(400).json({ error: 'Invalid remote URL format' });
    }

    const commitMessage = (typeof message === 'string' && message.trim())
      ? message.trim()
      : `Backup ${new Date().toISOString()}`;

    // Add all changes
    await execFilePromise('git', ['add', '.'], { cwd: WIKI_HOME });

    // Commit — ignore failure when there is nothing new to commit
    try {
      await execFilePromise('git', ['commit', '-m', commitMessage], { cwd: WIKI_HOME });
    } catch {
      // Nothing to commit, that's ok
    }

    // Push if remote is provided
    if (remote) {
      try {
        await execFilePromise('git', ['remote', 'get-url', 'origin'], { cwd: WIKI_HOME });
      } catch {
        await execFilePromise('git', ['remote', 'add', 'origin', remote], { cwd: WIKI_HOME });
      }

      try {
        await execFilePromise('git', ['push', '-u', 'origin', 'main'], { cwd: WIKI_HOME });
      } catch {
        await execFilePromise('git', ['push', '-u', 'origin', 'master'], { cwd: WIKI_HOME });
      }
    }

    res.json({ success: true, message: 'Backup completed' });
  } catch (error) {
    console.error('Error during backup:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/git/status', requireAuth, async (req, res) => {
  try {
    const { stdout } = await execFilePromise('git', ['status', '--porcelain'], { cwd: WIKI_HOME });
    const hasChanges = stdout.trim().length > 0;
    res.json({ hasChanges, status: stdout });
  } catch (error) {
    res.json({ hasChanges: false, error: 'Not a git repository' });
  }
});

// ---------------------------------------------------------------------------
// Initial setup routes
// ---------------------------------------------------------------------------

// Serve setup page (only before admin is created)
app.get('/setup', (req, res) => {
  if (isAdminConfigured()) return res.redirect(process.env.BASE_URL || '/');
  const html = fsSync.readFileSync(path.join(__dirname, 'public', 'setup.html'), 'utf8');
  res.send(injectMeta(html));
});

// Create the admin account (one-time, rate-limited)
app.post('/api/setup', setupLimiter, async (req, res) => {
  if (isAdminConfigured()) {
    return res.status(409).json({ error: 'Admin account already configured.' });
  }

  const { username, email, password } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are all required.' });
  }

  // Validate username: letters, numbers, hyphens, underscores only
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–32 characters (letters, numbers, hyphens, underscores).' });
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  if (password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const adminData = {
      username,
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    // mode 0o600 = owner read/write only
    fsSync.writeFileSync(ADMIN_FILE, JSON.stringify(adminData, null, 2), { mode: 0o600 });
    console.log(`Admin account created for: ${email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Error creating admin account:', err);
    res.status(500).json({ error: 'Failed to create admin account.' });
  }
});

// Serve admin login page
app.get('/admin-login', (req, res) => {
  const html = fsSync.readFileSync(path.join(__dirname, 'public', 'admin-login.html'), 'utf8');
  res.send(injectMeta(html));
});

// Authenticate with local admin credentials (rate-limited)
app.post('/api/admin-login', adminLoginLimiter, async (req, res) => {
  if (!isAdminConfigured()) {
    return res.status(503).json({ error: 'Admin account not configured. Complete /setup first.' });
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required.' });
  }

  try {
    const adminData = JSON.parse(fsSync.readFileSync(ADMIN_FILE, 'utf8'));
    const usernameMatch = username === adminData.username;
    // Always run bcrypt.compare to prevent timing-based username enumeration
    const passwordMatch = await bcrypt.compare(password, adminData.passwordHash);

    if (!usernameMatch || !passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    req.session.adminLoggedIn = true;
    req.session.adminUser = { username: adminData.username, email: adminData.email };
    console.log(`Local admin logged in: ${adminData.email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Error during admin login:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// Destroy local admin session
app.post('/api/admin-logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ---------------------------------------------------------------------------
// Serve main app
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  const html = fsSync.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  res.send(injectMeta(html));
});

// Start server only when run directly (not when imported by tests)
if (require.main === module) {
  (async () => {
    await initializeWiki();
    await buildPageIndex();
    app.listen(PORT, () => {
      console.log(`Massive Wiki running on http://localhost:${PORT}`);
    });
  })();
}

// Export for unit testing
module.exports = { sanitize, imageFilter, initializeWiki };
