# Massive Wiki - User Manual

A simple, fast wiki document management system with file-based storage and GitHub Flavored Markdown.

## Table of Contents

- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [Wikilinks](#wikilinks)
- [Special Pages](#special-pages)
- [Navigation](#navigation)
- [Editing Pages](#editing-pages)
- [Creating Pages](#creating-pages)
- [Renaming Pages](#renaming-pages)
- [Images](#images)
- [Git Backup](#git-backup)
- [Admin Panel](#admin-panel)
- [Configuration](#configuration)

## Overview

Massive Wiki is a lightweight wiki system that stores pages as Markdown files on disk. It features:

- **File-based storage**: All pages stored as `.md` files in the `pages/` directory
- **GitHub Flavored Markdown**: Full GFM support including tables, code blocks, etc.
- **Global wikilinks**: Link to any page from anywhere using `[[PageName]]` syntax
- **Hierarchical organization**: Pages can be organized in folders
- **Git integration**: Built-in backup to remote repositories
- **No database**: Everything is stored in plain text files

## Directory Structure

```
massiveWiki/
├── pages/                    # All wiki content pages
│   ├── index.md             # Home page (required)
│   ├── guides.md            # Root-level page
│   ├── guides/              # Folder for guides section
│   │   ├── index.md         # guides can be both a page AND a folder
│   │   └── quick-start.md
│   └── computers/
│       └── atari.md
├── _wiki/                   # Special pages and config
│   ├── _sidebar.md          # Right sidebar content
│   ├── _footer.md           # Global footer content
│   └── _config.json         # Wiki configuration
├── images/                  # Uploaded images
├── public/                  # Frontend files (HTML, CSS, JS)
└── server.js                # Backend server
```

## Wikilinks

### Global Wikilink System

Massive Wiki uses a **global page index** that maps page names to their locations. This means:

- `[[Atari]]` will find and link to `computers/atari.md` no matter where you are in the wiki
- Page names are **globally unique** - there should only be one page with a given name
- You don't need to know the full path to link to a page

### Wikilink Syntax

**Basic syntax:**
```markdown
[[PageName]]
```
- Links to the page named "PageName" (case-insensitive, spaces converted to hyphens)
- Displays "PageName" as the link text
- Example: `[[Atari]]` → links to and displays "Atari"

**Display text syntax:**
```markdown
[[PageName|Display Text]]
```
- Links to "PageName" but displays "Display Text"
- Example: `[[index|Home]]` → links to index but displays "Home"

**Explicit path syntax:**
```markdown
[[computers/atari]]
```
- You can use full paths if needed
- Example: `[[guides/quick-start]]`

### Link Colors

- **Blue links**: Page exists
- **Red links**: Page doesn't exist yet (clicking creates it)

### How the Index Works

1. On server startup, all `.md` files in `pages/` are scanned
2. A global index is built mapping page names to paths
3. When you write `[[Atari]]`, it looks up "atari" in the index
4. The index rebuilds automatically when pages are created, renamed, or deleted

**Console output on startup:**
```
Page index built: 23 entries
```

## Special Pages

Special pages are stored in the `_wiki/` directory and provide global functionality.

### Right Sidebar (`_sidebar.md`)

- Appears on the right side of every page
- Can contain navigation links, quick links, or any markdown content
- Supports wikilinks

**Example:**
```markdown
## Quick Links

- [[index|Home]]
- [[guides|Guides]]
- [[computers/atari|Atari]]

## Resources

- [Markdown Guide](https://guides.github.com/features/mastering-markdown/)
```

### Global Footer (`_footer.md`)

- Appears at the bottom of every page (below all content and sidebars)
- Spans the full width of the page
- Useful for copyright, credits, or site-wide information

**Example:**
```markdown
---
**Massive Wiki** | [Admin](/_admin) | Built with Node.js and Markdown
```

### Configuration (`_config.json`)

Controls wiki behavior and appearance.

**Example:**
```json
{
  "wikiName": "Massive Wiki",
  "wikiDescription": "A simple, fast wiki document management system",
  "showSidebar": true,
  "showGlobalFooter": true,
  "theme": "default",
  "enableWikilinks": true,
  "defaultHomePage": "index"
}
```

**Configuration options:**
- `wikiName`: Name displayed in header
- `showSidebar`: Show/hide right sidebar
- `showGlobalFooter`: Show/hide global footer
- `enableWikilinks`: Enable/disable wikilink processing

## Navigation

### Breadcrumbs

- Appear at the top of every page
- Show the current page path
- Clickable to navigate up the hierarchy
- Example: `Home > guides > quick-start`

### Left Sidebar - Page Tree

- Hierarchical view of all pages
- Shows folder structure
- Tree connecting lines for visual hierarchy
- Arrow indicators (▸ ▾) for expandable folders

**Tree item types:**
- **Page**: Just a markdown file (e.g., `computers/atari.md`)
- **Folder**: Just a directory with children
- **Page-Parent**: Both a page AND a folder (e.g., `guides.md` + `guides/` folder)

**Interactions:**
- Click arrow to expand/collapse folders
- Click page name to navigate to that page
- Active page highlighted in blue

## Editing Pages

1. Navigate to the page you want to edit
2. Click the **Edit** button in the header
3. Edit the markdown content in the textarea
4. File path shown above the editor
5. Click **Save** to save changes
6. Click **Cancel** to discard changes
7. Click **Preview** to see rendered markdown in a new window

### Editor Features

- Full GitHub Flavored Markdown support
- Monospace font for editing
- Insert Image button for adding images
- Preview opens in new window
- Markdown Help link to GFM guide

## Creating Pages

### Method 1: Via New Page Button

1. Click **+ New** button in header
2. Enter page title (e.g., "My New Page")
3. Enter path (e.g., "category/page-name")
4. Click **Create**
5. Page is created at `pages/category/page-name.md`

**Path examples:**
- `getting-started` → creates `pages/getting-started.md`
- `guides/intro` → creates `pages/guides/intro.md`

### Method 2: Via Red Wikilinks

1. Add a wikilink to a non-existent page: `[[NewPage]]`
2. Save the page
3. Link appears in red
4. Click the red link to create the page
5. Page is created at root level: `pages/newpage.md`

## Renaming Pages

The rename feature automatically updates all references to a page across the entire wiki.

1. Navigate to the page you want to rename
2. Click **Rename** button in header
3. Current name is displayed
4. Enter new name (only letters, numbers, hyphens)
5. If other pages link to this page, you'll see a warning with the count
6. Click **Rename** to proceed

**What happens:**
- The `.md` file is renamed
- If a corresponding folder exists, it's also renamed
- All wikilinks `[[OldName]]` → `[[NewName]]` across all pages
- All markdown links `[text](oldname)` → `[text](newname)` across all pages
- The page index is rebuilt

**Name validation:**
- Only letters, numbers, and hyphens allowed
- Spaces are automatically converted to hyphens
- Names are case-insensitive (stored as lowercase)

## Images

### Uploading Images

1. Click **Edit** on a page
2. Click **Insert Image** button
3. Choose **Upload New** tab
4. Select an image file
5. Click **Upload**
6. Image is uploaded to `images/` directory
7. Markdown code is inserted: `![image](path)`

### Using Existing Images

1. Click **Insert Image** button
2. Choose **Use Existing** tab
3. Click on an image thumbnail
4. Markdown code is inserted

### Image Organization

- All images stored in `images/` directory
- Unique filenames generated on upload
- Images can be referenced from any page using relative paths

## Git Backup

Massive Wiki can backup your content to a Git repository.

### First Time Setup

1. Click **Backup** button in header
2. Enter your remote repository URL (e.g., `https://github.com/username/repo.git`)
3. Enter a commit message
4. Click **Backup Now**

**What happens:**
- Git repository initialized in `_wiki/` directory
- All pages committed
- Remote repository added (if URL provided)
- Changes pushed to remote

### Subsequent Backups

1. Click **Backup** button
2. Leave URL empty (already configured)
3. Enter commit message
4. Click **Backup Now**

**What happens:**
- Changes committed
- Pushed to remote repository

### Manual Git Operations

You can also use standard Git commands in the `_wiki/` directory:

```bash
cd _wiki
git status
git log
git push
```

## Admin Panel

Access via the **⚙️ Admin** button (purple button in header).

### Features

**Special Pages Management:**
- Edit `_sidebar.md` (right sidebar)
- Edit `_footer.md` (global footer)
- Quick access to special page editors

**Configuration:**
- Edit `_config.json`
- Modify wiki settings
- Change wiki name, enable/disable features

### Editing Special Pages

1. Click **Admin** button
2. Click **Edit** on a special page
3. Edit markdown content in modal
4. Click **Save**
5. Changes appear immediately (refresh page to see)

## Configuration

Edit configuration via Admin Panel or directly edit `_wiki/_config.json`.

### Available Settings

```json
{
  "wikiName": "Your Wiki Name",
  "wikiDescription": "Description of your wiki",
  "showSidebar": true,
  "showGlobalFooter": true,
  "theme": "default",
  "enableWikilinks": true,
  "defaultHomePage": "index"
}
```

**Settings explained:**

- **wikiName**: Displayed in the header logo
- **wikiDescription**: Metadata (future use)
- **showSidebar**: `true` shows right sidebar, `false` hides it
- **showGlobalFooter**: `true` shows global footer, `false` hides it
- **theme**: Theme selection (currently only "default")
- **enableWikilinks**: `true` processes `[[wikilinks]]`, `false` treats as literal text
- **defaultHomePage**: Name of the home page (usually "index")

## Technical Details

### Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla JavaScript (no frameworks)
- **Markdown**: marked.js with GitHub Flavored Markdown
- **Storage**: File system (no database)

### Port

- Default port: `3000`
- Access at: `http://localhost:3000`

### Starting the Server

```bash
npm start
```

### Page Index

The page index is built on startup and stored in memory. It maps:
- Simple names: `"atari" → "computers/atari"`
- Full paths: `"computers/atari" → "computers/atari"`

This allows `[[Atari]]` to find the page regardless of location.

### API Endpoints

- `GET /api/page/:path` - Get page content
- `POST /api/page/:path` - Save page content
- `POST /api/create` - Create new page
- `POST /api/rename` - Rename page and update references
- `DELETE /api/page/:path` - Delete page
- `GET /api/tree` - Get page tree for sidebar
- `GET /api/special/:page` - Get special page content
- `POST /api/special/:page` - Save special page
- `GET /api/config` - Get configuration
- `POST /api/config` - Save configuration
- `POST /api/git/backup` - Git backup

## Best Practices

### Page Naming

- Use lowercase with hyphens: `quick-start`, `getting-started`
- Keep names unique across the wiki
- Avoid special characters
- Use descriptive names: `atari-2600` not `a2600`

### Organization

- Group related pages in folders: `guides/`, `computers/`, `projects/`
- Use `index.md` files in folders for section landing pages
- Keep the folder hierarchy relatively flat (2-3 levels max)

### Wikilinks

- Prefer `[[PageName]]` for internal links (global lookup)
- Use `[[PageName|Display Text]]` for better readability
- Use standard markdown links `[text](url)` for external links

### Sidebar

- Keep sidebar concise (top 5-10 links)
- Group links by category
- Use wikilinks for internal navigation

### Git Backups

- Commit regularly with meaningful messages
- Back up before major changes
- Use descriptive commit messages

## Troubleshooting

### Page not found

- Check if the page exists in `pages/` directory
- Verify the file has `.md` extension
- Check the page index was built (console shows "Page index built: X entries")

### Wikilink not working

- Ensure wikilinks are enabled in `_config.json`
- Check page name spelling
- Verify page exists (should be blue link, not red)
- Look for the page in the left sidebar tree

### Sidebar not showing

- Check `_wiki/_sidebar.md` exists
- Verify `showSidebar: true` in `_config.json`
- Check browser console for errors

### Git backup fails

- Verify Git is installed: `git --version`
- Check remote URL is correct
- Ensure you have push access to the remote repository
- Check `_wiki/` directory has `.git` folder

## Future Enhancements

Potential features for future development:

- Full-text search across all pages
- Page templates
- Version history viewer
- Dark mode theme
- Export to PDF/HTML
- Tag system
- Recent changes page
- Page analytics
- Multi-user support with authentication
- Real-time collaborative editing
- Mobile-responsive improvements
- Custom CSS themes
- Plugin system

---

**Last Updated**: 2025-11-08
**Version**: 1.0
**Repository**: https://github.com/yourusername/massive-wiki
