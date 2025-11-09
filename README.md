# Massive Wiki

A simple, fast, and awesome wiki document management system built with Node.js.

## Features

- **Simple & Fast**: File-based storage with no database overhead
- **GitHub Flavored Markdown**: Write in pure markdown, no WYSIWYG editor
- **Wikilinks**: Use `[[PageName]]` syntax to create interconnected pages
  - Existing pages show as blue links
  - Non-existent pages show as red links (create on click)
  - Automatically creates child pages in hierarchy
- **Hierarchical Organization**:
  - Pages stored in hierarchical folders
  - Images in separate directory structure
- **Intuitive Navigation**:
  - Breadcrumb navigation showing current location
  - Sidebar with complete page hierarchy
- **Git Backup**: One-click backup to remote GitHub repositories
- **Footer Support**: Pages can include custom footer content
- **Image Management**: Upload and insert images easily
- **Clean UI**: Modern, responsive design

## Quick Start

### Prerequisites

- Node.js (v14 or higher)
- npm

### Installation

1. Clone or download this repository
2. Navigate to the project directory
3. Install dependencies:

```bash
npm install
```

4. Start the server:

**Default location** (creates `wiki-data/` in current directory):
```bash
npm start
```

**Custom location** (specify your own directory):
```bash
node server.js --home /path/to/your/wiki
```

5. Open your browser to:

```
http://localhost:3000
```

### First Run Initialization

On first run, Massive Wiki automatically creates the directory structure:

```
Wiki home directory: /path/to/your/wiki
First run detected - initializing wiki structure...
✓ Created home.md
✓ Created getting-started.md
✓ Created _sidebar.md
✓ Created _footer.md
✓ Created _config.json
✓ Wiki initialization complete!
Page index built: 2 entries
Massive Wiki running on http://localhost:3000
```

## Project Structure

```
massiveWiki/
├── wiki-data/ (or your custom --home directory)
│   ├── pages/              # All wiki pages (markdown files)
│   │   ├── home.md        # Home page (protected)
│   │   └── getting-started.md
│   ├── images/            # All uploaded images
│   └── _wiki/             # Special pages and config
│       ├── _sidebar.md    # Right sidebar content
│       ├── _footer.md     # Global footer content
│       └── _config.json   # Wiki configuration
├── public/                # Frontend assets
│   ├── css/style.css
│   ├── js/app.js
│   └── index.html
├── server.js              # Express server
├── Manual.md              # Comprehensive documentation
├── package.json
└── README.md
```

## Usage

### Creating Pages

1. Click the **+ New** button in the header
2. Enter a page title and path
3. Use forward slashes to create hierarchy:
   - `intro` → Creates `pages/intro.md`
   - `guides/tutorial` → Creates `pages/guides/tutorial.md`

### Editing Pages

1. Navigate to any page
2. Click the **Edit** button
3. Write your content in GitHub Flavored Markdown
4. Click **Save** when done

### Adding Images

1. Click **Edit** on a page
2. Click the **Insert Image** button
3. Either:
   - Upload a new image
   - Select from existing images
4. The markdown will be inserted at cursor position

### Using Wikilinks

Wikilinks make it easy to create interconnected pages, just like Wikipedia!

1. **Syntax**: Use double brackets around any page name: `[[PageName]]`
2. **Existing pages**: Show as blue links and navigate directly
3. **Non-existent pages**: Show as red links
4. **Auto-create**: Clicking a red link automatically creates the page

**Global Page Lookup:**
Wikilinks are **global** - they search the entire wiki for matching pages:
- `[[Atari]]` finds and links to `computers/atari.md` from anywhere
- No need to know the full path
- Page names are globally unique

**Examples:**
```markdown
Welcome to [[home]]!

Check out my [[Projects]] page!
Learn about [[Atari]] and [[Nintendo]] consoles.
Read the [[getting-started|Getting Started]] guide.
```

**Display Text:**
Use `[[PageName|Display Text]]` to show custom link text:
- `[[home|Home Page]]` - Links to home but displays "Home Page"

**Tips:**
- Page names are case-insensitive
- Spaces become hyphens: `[[My Page]]` → `/my-page`
- Link freely to build your knowledge graph!

### Page Footers

Add a footer to any page by separating it with a horizontal rule:

```markdown
# Main Content

Your page content here...

---
*Last updated: 2025-11-07*
```

Everything after the `---` becomes the footer.

### Git Backup

#### First Time Setup

1. Create a new GitHub repository
2. Click the **Backup** button
3. Enter your repository URL: `https://github.com/username/my-wiki.git`
4. Add a commit message (optional)
5. Click **Backup Now**

#### Regular Backups

1. Click the **Backup** button
2. Leave remote URL empty
3. Add commit message
4. Click **Backup Now**

## Markdown Support

Massive Wiki supports GitHub Flavored Markdown including:

- Headers (H1-H6)
- **Bold**, *italic*, ~~strikethrough~~
- Lists (ordered and unordered)
- Code blocks with syntax highlighting
- Tables
- Blockquotes
- Links and images
- Task lists
- Horizontal rules
- **Wikilinks** (`[[PageName]]`) - Create interconnected pages

## API Endpoints

The server exposes these REST API endpoints:

### Pages
- `GET /api/page/*` - Get page content
- `POST /api/page/*` - Save page content
- `POST /api/create` - Create new page
- `DELETE /api/page/*` - Delete page

### Navigation
- `GET /api/tree` - Get complete page hierarchy

### Images
- `GET /api/images` - List all images
- `POST /api/upload-image` - Upload new image

### Git Operations
- `POST /api/git/init` - Initialize git repository
- `POST /api/git/backup` - Backup to remote
- `GET /api/git/status` - Check git status

## Configuration

### Port

Change the port by editing `server.js`:

```javascript
const PORT = 3000; // Change this to your preferred port
```

### Styling

Customize the appearance by editing:
- `public/css/style.css` - Main stylesheet
- CSS variables at the top of the file for quick theme changes

## Technologies Used

- **Backend**: Node.js + Express
- **Markdown**: marked (GitHub Flavored Markdown)
- **File Upload**: multer
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Version Control**: Git

## Development

### Running in Development Mode

```bash
npm run dev
```

### Project Goals

- **Simplicity**: Easy to understand and modify
- **Speed**: Fast page loads with minimal overhead
- **Reliability**: File-based storage is simple and robust
- **Portability**: Everything in simple files, easy to backup

## Tips & Best Practices

1. **Use descriptive page names**: `getting-started/installation` is better than `gs/inst`
2. **Organize with folders**: Group related pages together
3. **Backup regularly**: Use the backup feature after significant changes
4. **Write clear commit messages**: Help your future self understand changes
5. **Keep images optimized**: Compress images before uploading

## Troubleshooting

### Server won't start
- Check if port 3000 is already in use
- Ensure Node.js is installed: `node --version`
- Delete `node_modules` and run `npm install` again

### Pages not loading
- Check the browser console for errors
- Verify the file exists in the `pages/` directory
- Check file permissions

### Git backup fails
- Ensure git is installed: `git --version`
- Check your GitHub credentials
- Try using SSH instead of HTTPS URL

## Contributing

Feel free to:
- Report bugs
- Suggest features
- Submit pull requests
- Improve documentation

## License

MIT License - feel free to use this for any project!

## Author

Built with Claude Code

---

Made with ❤️ and markdown
