// Auth state
let supabaseClient = null;
let currentUser = null;
let authConfig = null;

// Initialize Supabase client
async function initializeAuth() {
    try {
        // Get Supabase config from server
        const response = await fetch('/api/auth/config');
        authConfig = await response.json();

        // Check if auth is enabled
        if (!authConfig.authEnabled) {
            console.log('Authentication is disabled');
            updateAuthUI(false);
            return;
        }

        // Check if Supabase is configured
        if (!authConfig.hasSupabaseConfig) {
            console.warn('Authentication is enabled but Supabase is not configured');
            updateAuthUI(false);
            return;
        }

        // Initialize Supabase client using the CDN-loaded library
        supabaseClient = supabase.createClient(authConfig.supabaseUrl, authConfig.supabaseAnonKey);

        // Check current session
        const { data: { session } } = await supabaseClient.auth.getSession();

        if (session) {
            currentUser = session.user;
            updateAuthUI(true);
        } else {
            updateAuthUI(false);
        }

        // Listen for auth changes
        supabaseClient.auth.onAuthStateChange((event, session) => {
            console.log('Auth state changed:', event);

            if (session) {
                currentUser = session.user;
                updateAuthUI(true);
            } else {
                currentUser = null;
                updateAuthUI(false);
            }
        });

    } catch (error) {
        console.error('Error initializing auth:', error);
    }
}

// Update UI based on auth state
function updateAuthUI(isAuthenticated) {
    const loginBtn = document.getElementById('loginBtn');
    const userMenu = document.getElementById('userMenu');
    const userEmail = document.getElementById('userEmail');

    if (isAuthenticated && currentUser) {
        loginBtn.style.display = 'none';
        userMenu.style.display = 'flex';
        userEmail.textContent = currentUser.email;
    } else {
        loginBtn.style.display = 'inline-block';
        userMenu.style.display = 'none';
        userEmail.textContent = '';
    }
}

// OAuth sign-in with GitHub
async function signInWithGitHub() {
    if (!supabaseClient) {
        showNotification('Authentication is not configured. Please enable it in the Admin panel.', 'error');
        return;
    }

    try {
        console.log('Initiating GitHub OAuth...');
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'github',
            options: {
                redirectTo: window.location.origin
            }
        });

        if (error) throw error;

        console.log('GitHub OAuth initiated:', data);
        // OAuth will redirect, so modal will close automatically
        closeModal('loginModal');

    } catch (error) {
        console.error('GitHub login error:', error);
        showNotification(error.message || 'GitHub login failed', 'error');
    }
}

// OAuth sign-in with Discord
async function signInWithDiscord() {
    if (!supabaseClient) {
        showNotification('Authentication is not configured. Please enable it in the Admin panel.', 'error');
        return;
    }

    try {
        console.log('Initiating Discord OAuth...');
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'discord',
            options: {
                redirectTo: window.location.origin
            }
        });

        if (error) throw error;

        console.log('Discord OAuth initiated:', data);
        // OAuth will redirect, so modal will close automatically
        closeModal('loginModal');

    } catch (error) {
        console.error('Discord login error:', error);
        showNotification(error.message || 'Discord login failed', 'error');
    }
}

// Logout function
async function executeLogout() {
    try {
        const { error } = await supabaseClient.auth.signOut();

        if (error) throw error;

        showNotification('Logged out successfully', 'success');

    } catch (error) {
        console.error('Logout error:', error);
        showNotification('Logout failed', 'error');
    }
}

// Get current user
function getCurrentUser() {
    return currentUser;
}

// Check if user is authenticated
function isAuthenticated() {
    return currentUser !== null;
}

// Get current access token for API requests
async function getAccessToken() {
    if (!supabaseClient) {
        return null;
    }

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        return session?.access_token || null;
    } catch (error) {
        console.error('Error getting access token:', error);
        return null;
    }
}

// Initialize auth when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initializeAuth();

    // Set up event listeners
    document.getElementById('loginBtn').addEventListener('click', () => openModal('loginModal'));
    document.getElementById('githubLoginBtn').addEventListener('click', signInWithGitHub);
    document.getElementById('discordLoginBtn').addEventListener('click', signInWithDiscord);
    document.getElementById('logoutBtn').addEventListener('click', executeLogout);
});
