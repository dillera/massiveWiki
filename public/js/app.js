// State
let currentPage = 'home';
let isEditing = false;
let wikiConfig = null;
let currentSpecialPage = null;

// DOM Elements
const content = document.getElementById('content');
const footer = document.getElementById('footer');
const breadcrumbs = document.getElementById('breadcrumbs');
const tree = document.getElementById('tree');
const viewMode = document.getElementById('viewMode');
const editMode = document.getElementById('editMode');
const editor = document.getElementById('editor');
const notification = document.getElementById('notification');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    loadTree();
    loadSidebar();
    loadGlobalFooter();
    handleRouting();
    setupEventListeners();

    // Handle browser back/forward
    window.addEventListener('popstate', handleRouting);
});

// Event Listeners
function setupEventListeners() {
    // Navigation
    document.getElementById('editBtn').addEventListener('click', enterEditMode);
    document.getElementById('saveBtn').addEventListener('click', savePage);
    document.getElementById('cancelBtn').addEventListener('click', exitEditMode);
    document.getElementById('newPageBtn').addEventListener('click', () => openModal('newPageModal'));
    document.getElementById('renameBtn').addEventListener('click', openRenameModal);
    document.getElementById('deleteBtn').addEventListener('click', openDeleteModal);
    document.getElementById('backupBtn').addEventListener('click', () => openModal('backupModal'));
    document.getElementById('adminBtn').addEventListener('click', openAdmin);
    document.getElementById('refreshTreeBtn').addEventListener('click', loadTree);

    // New page modal
    document.getElementById('createPageBtn').addEventListener('click', createNewPage);

    // Delete modal
    document.getElementById('executeDeleteBtn').addEventListener('click', executeDelete);

    // Image handling
    document.getElementById('imageBtn').addEventListener('click', openImageModal);
    document.getElementById('uploadImageBtn').addEventListener('click', uploadImage);

    // Backup modal
    document.getElementById('executeBackupBtn').addEventListener('click', executeBackup);

    // Rename modal
    document.getElementById('executeRenameBtn').addEventListener('click', executerename);
    document.getElementById('newPageName').addEventListener('input', validatePageName);

    // Admin panel
    document.getElementById('exitAdminBtn').addEventListener('click', exitAdmin);
    document.querySelectorAll('.edit-special').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const page = e.target.dataset.page;
            openSpecialPageEditor(page);
        });
    });
    document.getElementById('editConfigBtn').addEventListener('click', openConfigEditor);
    document.getElementById('saveSpecialPageBtn').addEventListener('click', saveSpecialPage);
    document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);

    // Preview button
    document.getElementById('previewBtn').addEventListener('click', openPreview);

    // Modal closing
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            closeModal(modal.id);
        });
    });

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabName = e.target.dataset.tab;
            switchTab(tabName);
        });
    });

    // Click outside modal to close
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });
    });
}

// Routing
function handleRouting() {
    const path = window.location.pathname;
    currentPage = path === '/' ? 'home' : path.slice(1);
    loadPage(currentPage);
    updateBreadcrumbs();
}

function navigateTo(path) {
    const url = path === 'home' ? '/' : `/${path}`;
    window.history.pushState({}, '', url);
    handleRouting();
}

// Load page content
async function loadPage(path) {
    try {
        const response = await fetch(`/api/page/${path}`);

        if (!response.ok) {
            if (response.status === 404) {
                content.innerHTML = `
                    <h1>Page Not Found</h1>
                    <p>The page "${path}" doesn't exist yet.</p>
                    <button onclick="createPageAtPath('${path}')" class="btn btn-primary">Create This Page</button>
                `;
                footer.innerHTML = '';
                return;
            }
            throw new Error('Failed to load page');
        }

        const data = await response.json();
        content.innerHTML = data.content;
        footer.innerHTML = data.footer;

        // Store raw content for editing
        editor.setAttribute('data-raw', data.raw);

        // Highlight current page in tree
        highlightTreeItem(path);

        // Attach wikilink click handlers
        attachWikilinkHandlers();
    } catch (error) {
        showNotification('Error loading page', 'error');
        console.error(error);
    }
}

// Wikilink handling
function attachWikilinkHandlers() {
    // Attach click handlers to all wikilinks
    document.querySelectorAll('.wikilink').forEach(link => {
        link.addEventListener('click', handleWikilinkClick);
    });
}

async function handleWikilinkClick(e) {
    e.preventDefault();

    const link = e.currentTarget;
    const pagePath = link.dataset.page;
    const exists = link.dataset.exists === 'true';
    const title = link.textContent;

    if (exists) {
        // Page exists, just navigate to it
        navigateTo(pagePath);
    } else {
        // Page doesn't exist, create it first
        try {
            const response = await fetch('/api/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: pagePath, title: title })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to create page');
            }

            showNotification(`Created new page: ${title}`, 'success');

            // Reload tree to show new page
            await loadTree();

            // Navigate to the new page
            navigateTo(pagePath);
        } catch (error) {
            showNotification(`Error creating page: ${error.message}`, 'error');
            console.error(error);
        }
    }
}

// Breadcrumbs
function updateBreadcrumbs() {
    const parts = currentPage.split('/').filter(p => p);

    let html = '<a href="/">Home</a>';
    let path = '';

    parts.forEach((part, index) => {
        path += (path ? '/' : '') + part;
        const isLast = index === parts.length - 1;
        const displayName = part.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        if (isLast) {
            html += `<span class="separator">/</span><span>${displayName}</span>`;
        } else {
            html += `<span class="separator">/</span><a href="/${path}">${displayName}</a>`;
        }
    });

    breadcrumbs.innerHTML = html;

    // Add click handlers to breadcrumb links
    breadcrumbs.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(link.getAttribute('href').slice(1) || 'home');
        });
    });
}

// Tree navigation
async function loadTree() {
    try {
        const response = await fetch('/api/tree');
        const treeData = await response.json();
        tree.innerHTML = buildTreeHTML(treeData);

        // Add click handlers
        tree.querySelectorAll('.tree-item').forEach(item => {
            // Handle expand icon clicks
            const expandIcon = item.querySelector('.tree-expand-icon');
            if (expandIcon) {
                expandIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleFolder(item);
                });
            }

            // Handle name clicks
            const nameSpan = item.querySelector('.tree-name');
            if (nameSpan) {
                nameSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const path = item.dataset.path;

                    // Only navigate if the item has content
                    if (item.classList.contains('tree-page') || item.classList.contains('tree-page-parent')) {
                        navigateTo(path);
                    } else if (item.classList.contains('tree-folder')) {
                        // For folders without content, just toggle
                        toggleFolder(item);
                    }
                });
            }
        });

        // Highlight current page
        highlightTreeItem(currentPage);
    } catch (error) {
        showNotification('Error loading tree', 'error');
        console.error(error);
    }
}

function buildTreeHTML(items, level = 0) {
    let html = '';

    items.forEach(item => {
        const hasChildren = item.children && item.children.length > 0;

        if (item.type === 'page-parent') {
            // Page with content AND children - clickable name + expandable
            html += `
                <div class="tree-item-container">
                    <div class="tree-item tree-page-parent" data-path="${item.path}" data-has-children="true">
                        <span class="tree-expand-icon">▸</span>
                        <span class="tree-name">${item.name}</span>
                    </div>
                    <div class="tree-children">
                        ${buildTreeHTML(item.children, level + 1)}
                    </div>
                </div>
            `;
        } else if (item.type === 'page') {
            // Page with content but no children - just clickable
            html += `
                <div class="tree-item tree-page" data-path="${item.path}" data-has-children="false">
                    <span class="tree-name">${item.name}</span>
                </div>
            `;
        } else if (item.type === 'folder') {
            // Folder without content - just expandable
            html += `
                <div class="tree-item-container">
                    <div class="tree-item tree-folder" data-path="${item.path}" data-has-children="true">
                        <span class="tree-expand-icon">▸</span>
                        <span class="tree-name">${item.name}</span>
                    </div>
                    <div class="tree-children">
                        ${buildTreeHTML(item.children, level + 1)}
                    </div>
                </div>
            `;
        }
    });

    return html;
}

function toggleFolder(itemElement) {
    const container = itemElement.closest('.tree-item-container');
    if (!container) return;

    const children = container.querySelector('.tree-children');
    const expandIcon = itemElement.querySelector('.tree-expand-icon');

    if (children) {
        children.classList.toggle('expanded');
        itemElement.classList.toggle('expanded');

        // Rotate the expand icon
        if (expandIcon) {
            if (children.classList.contains('expanded')) {
                expandIcon.textContent = '▾';
            } else {
                expandIcon.textContent = '▸';
            }
        }
    }
}

function highlightTreeItem(path) {
    tree.querySelectorAll('.tree-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.path === path) {
            item.classList.add('active');

            // Expand all parent containers
            let parent = item.parentElement;
            while (parent && parent !== tree) {
                if (parent.classList.contains('tree-children')) {
                    parent.classList.add('expanded');

                    // Find the parent tree-item and update its expand icon
                    const container = parent.closest('.tree-item-container');
                    if (container) {
                        const parentItem = container.querySelector('.tree-item');
                        if (parentItem) {
                            parentItem.classList.add('expanded');
                            const expandIcon = parentItem.querySelector('.tree-expand-icon');
                            if (expandIcon) {
                                expandIcon.textContent = '▾';
                            }
                        }
                    }
                }
                parent = parent.parentElement;
            }
        }
    });
}

// Edit mode
function enterEditMode() {
    isEditing = true;
    viewMode.style.display = 'none';
    editMode.style.display = 'flex';

    const raw = editor.getAttribute('data-raw') || '';
    editor.value = raw;

    // Update file path display
    const filePath = `pages/${currentPage}.md`;
    document.getElementById('editorFilePath').textContent = filePath;

    editor.focus();
}

function exitEditMode() {
    isEditing = false;
    editMode.style.display = 'none';
    viewMode.style.display = 'block';
}

async function savePage() {
    const raw = editor.value;

    try {
        const response = await fetch(`/api/page/${currentPage}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: raw })
        });

        if (!response.ok) throw new Error('Failed to save');

        showNotification('Page saved successfully', 'success');
        exitEditMode();
        loadPage(currentPage);
    } catch (error) {
        showNotification('Error saving page', 'error');
        console.error(error);
    }
}

function openPreview() {
    const raw = editor.value;

    // Create a new window for preview
    const previewWindow = window.open('', 'Preview', 'width=800,height=600');

    // Build preview HTML
    const previewHTML = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Preview - ${currentPage}</title>
            <link rel="stylesheet" href="/css/style.css">
            <style>
                body {
                    padding: 2rem;
                    max-width: 900px;
                    margin: 0 auto;
                }
            </style>
        </head>
        <body>
            <div class="content-view">
                <div id="preview-content"></div>
            </div>
            <script>
                // Get the markdown content from opener
                const markdown = ${JSON.stringify(raw)};

                // Render it using the API
                fetch('/api/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: markdown,
                        currentPage: ${JSON.stringify(currentPage)}
                    })
                })
                .then(res => res.json())
                .then(data => {
                    document.getElementById('preview-content').innerHTML = data.html;
                })
                .catch(err => {
                    document.getElementById('preview-content').innerHTML = '<p>Error loading preview</p>';
                });
            </script>
        </body>
        </html>
    `;

    previewWindow.document.write(previewHTML);
    previewWindow.document.close();
}

// Create new page
async function createNewPage() {
    const title = document.getElementById('pageTitle').value.trim();
    const path = document.getElementById('pagePath').value.trim();

    if (!title || !path) {
        showNotification('Please fill in all fields', 'error');
        return;
    }

    try {
        const response = await fetch('/api/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, title })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to create page');
        }

        showNotification('Page created successfully', 'success');
        closeModal('newPageModal');
        loadTree();
        navigateTo(path);

        // Clear form
        document.getElementById('pageTitle').value = '';
        document.getElementById('pagePath').value = '';
    } catch (error) {
        showNotification(error.message, 'error');
        console.error(error);
    }
}

// Helper function to create page at specific path
window.createPageAtPath = function(path) {
    document.getElementById('pagePath').value = path;
    document.getElementById('pageTitle').value = path.split('/').pop().replace(/-/g, ' ');
    openModal('newPageModal');
};

// Image handling
async function openImageModal() {
    openModal('imageModal');
    loadImageList();
}

async function loadImageList() {
    try {
        const response = await fetch('/api/images');
        const images = await response.json();

        const imageList = document.getElementById('imageList');
        imageList.innerHTML = images.map(img => `
            <div class="image-item" onclick="insertImage('/images/${img}')">
                <img src="/images/${img}" alt="${img}">
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading images:', error);
    }
}

async function uploadImage() {
    const fileInput = document.getElementById('imageFile');
    const file = fileInput.files[0];

    if (!file) {
        showNotification('Please select an image', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('image', file);

    try {
        const response = await fetch('/api/upload-image', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Failed to upload');

        const data = await response.json();
        insertImage(data.url);
        showNotification('Image uploaded successfully', 'success');
        closeModal('imageModal');
        fileInput.value = '';
    } catch (error) {
        showNotification('Error uploading image', 'error');
        console.error(error);
    }
}

function insertImage(url) {
    const markdown = `![Image](${url})`;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;

    editor.value = text.substring(0, start) + markdown + text.substring(end);
    editor.focus();
    editor.selectionStart = editor.selectionEnd = start + markdown.length;

    updatePreview();
    closeModal('imageModal');
}

// Git backup
async function executeBackup() {
    const remote = document.getElementById('remoteUrl').value.trim();
    const message = document.getElementById('commitMessage').value.trim();

    try {
        const response = await fetch('/api/git/backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ remote, message })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Backup failed');
        }

        showNotification('Backup completed successfully', 'success');
        closeModal('backupModal');

        // Clear form
        document.getElementById('remoteUrl').value = '';
        document.getElementById('commitMessage').value = '';
    } catch (error) {
        showNotification(`Backup error: ${error.message}`, 'error');
        console.error(error);
    }
}

// Page rename
async function openRenameModal() {
    if (currentPage === 'home') {
        showNotification('Cannot rename the home page', 'error');
        return;
    }

    // Get current page name (last part of path)
    const parts = currentPage.split('/');
    const currentName = parts[parts.length - 1];

    document.getElementById('currentPageName').value = currentName;
    document.getElementById('newPageName').value = currentName;

    // Load references
    try {
        const response = await fetch(`/api/references/${currentPage}`);
        const data = await response.json();

        if (data.count > 0) {
            document.getElementById('referencesCount').textContent = data.count;
            document.getElementById('referencesInfo').style.display = 'block';

            const refList = document.getElementById('referencesList');
            refList.innerHTML = data.references.map(ref =>
                `<div>📄 ${ref.file} (${ref.total} link${ref.total > 1 ? 's' : ''})</div>`
            ).join('');
        } else {
            document.getElementById('referencesInfo').style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading references:', error);
    }

    openModal('renameModal');
}

function validatePageName(e) {
    let value = e.target.value;

    // Replace spaces with hyphens
    value = value.replace(/\s+/g, '-');

    // Remove invalid characters
    value = value.replace(/[^a-z0-9-]/gi, '');

    // Update the input
    e.target.value = value.toLowerCase();
}

async function executerename() {
    const newName = document.getElementById('newPageName').value.trim();

    if (!newName) {
        showNotification('Please enter a new name', 'error');
        return;
    }

    if (!/^[a-z0-9-]+$/i.test(newName)) {
        showNotification('Page name can only contain letters, numbers, and hyphens', 'error');
        return;
    }

    try {
        const response = await fetch('/api/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                oldPath: currentPage,
                newName: newName
            })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to rename page');
        }

        const data = await response.json();

        showNotification(
            `Page renamed! ${data.updatedCount} page(s) updated.`,
            'success'
        );

        closeModal('renameModal');

        // Reload tree
        await loadTree();

        // Navigate to new path
        navigateTo(data.newPath);
    } catch (error) {
        showNotification(`Rename error: ${error.message}`, 'error');
        console.error(error);
    }
}

// Delete page
async function openDeleteModal() {
    if (currentPage === 'home') {
        showNotification('Cannot delete the home page', 'error');
        return;
    }

    // Set page name
    document.getElementById('deletePageName').textContent = currentPage;

    // Load children
    try {
        const response = await fetch(`/api/children/${currentPage}`);
        const data = await response.json();

        if (data.count > 0) {
            document.getElementById('childCount').textContent = data.count;
            document.getElementById('deleteWarning').style.display = 'block';

            const childList = document.getElementById('childrenList');
            childList.innerHTML = data.children.map(child =>
                `<div>📄 ${child}</div>`
            ).join('');
        } else {
            document.getElementById('deleteWarning').style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading children:', error);
    }

    openModal('deleteModal');
}

async function executeDelete() {
    try {
        const response = await fetch(`/api/page/${currentPage}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to delete page');
        }

        showNotification('Page deleted successfully', 'success');

        closeModal('deleteModal');

        // Reload tree
        await loadTree();

        // Navigate to home
        navigateTo('home');
    } catch (error) {
        showNotification(`Delete error: ${error.message}`, 'error');
        console.error(error);
    }
}

// Modal management
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.getElementById('uploadTab').classList.toggle('active', tabName === 'upload');
    document.getElementById('existingTab').classList.toggle('active', tabName === 'existing');

    if (tabName === 'existing') {
        loadImageList();
    }
}

// Notifications
function showNotification(message, type = 'info') {
    notification.textContent = message;
    notification.className = `notification ${type} show`;

    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// Config management
async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        wikiConfig = await response.json();

        // Update wiki name in header if configured
        if (wikiConfig.wikiName) {
            document.querySelector('.logo').textContent = wikiConfig.wikiName;
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
}

// Sidebar management
async function loadSidebar() {
    try {
        const response = await fetch('/api/special/_sidebar');
        const data = await response.json();

        if (data.content && wikiConfig?.showSidebar !== false) {
            // Render the sidebar markdown
            const previewResponse = await fetch('/api/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: data.content,
                    currentPage: currentPage
                })
            });
            const previewData = await previewResponse.json();
            document.getElementById('sidebarContent').innerHTML = previewData.html;
        } else {
            document.getElementById('rightSidebar').style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading sidebar:', error);
    }
}

// Global footer management
async function loadGlobalFooter() {
    try {
        const response = await fetch('/api/special/_footer');
        const data = await response.json();

        if (data.content && wikiConfig?.showGlobalFooter !== false) {
            // Render the footer markdown
            const previewResponse = await fetch('/api/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: data.content,
                    currentPage: currentPage
                })
            });
            const previewData = await previewResponse.json();
            document.getElementById('globalFooter').innerHTML = previewData.html;
        } else {
            document.getElementById('globalFooter').style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading global footer:', error);
    }
}

// Admin panel
function openAdmin() {
    document.getElementById('viewMode').style.display = 'none';
    document.getElementById('editMode').style.display = 'none';
    document.getElementById('adminView').style.display = 'block';
}

function exitAdmin() {
    document.getElementById('adminView').style.display = 'none';
    document.getElementById('viewMode').style.display = 'flex';
}

// Special page editor
async function openSpecialPageEditor(pageName) {
    currentSpecialPage = pageName;

    try {
        const response = await fetch(`/api/special/${pageName}`);
        const data = await response.json();

        document.getElementById('specialPageTitle').textContent = `Edit ${pageName.replace('_', '')}`;
        document.getElementById('specialPageEditor').value = data.content || '';

        openModal('specialPageModal');
    } catch (error) {
        showNotification('Error loading special page', 'error');
        console.error(error);
    }
}

async function saveSpecialPage() {
    if (!currentSpecialPage) return;

    const content = document.getElementById('specialPageEditor').value;

    try {
        const response = await fetch(`/api/special/${currentSpecialPage}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });

        if (!response.ok) throw new Error('Failed to save');

        showNotification('Special page saved successfully', 'success');
        closeModal('specialPageModal');

        // Reload sidebar or footer depending on which was edited
        if (currentSpecialPage === '_sidebar') {
            await loadSidebar();
        } else if (currentSpecialPage === '_footer') {
            await loadGlobalFooter();
        }
    } catch (error) {
        showNotification('Error saving special page', 'error');
        console.error(error);
    }
}

// Config editor
async function openConfigEditor() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();

        document.getElementById('configEditor').value = JSON.stringify(config, null, 2);

        openModal('configModal');
    } catch (error) {
        showNotification('Error loading config', 'error');
        console.error(error);
    }
}

async function saveConfig() {
    const configText = document.getElementById('configEditor').value;

    try {
        const config = JSON.parse(configText);

        const response = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        if (!response.ok) throw new Error('Failed to save');

        showNotification('Configuration saved successfully', 'success');
        closeModal('configModal');

        // Reload config
        await loadConfig();
        await loadSidebar();
        await loadGlobalFooter();
    } catch (error) {
        if (error instanceof SyntaxError) {
            showNotification('Invalid JSON syntax', 'error');
        } else {
            showNotification('Error saving config', 'error');
        }
        console.error(error);
    }
}

// Utility
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
