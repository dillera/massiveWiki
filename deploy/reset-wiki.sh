#!/usr/bin/env bash
# =============================================================================
# reset-wiki.sh — Reset massiveWiki to a clean first-run state
#
# Removes all wiki content, config, and the admin account so the server
# will go back through the initial setup wizard on next start.
# The .env file is preserved.
#
# Usage:
#   bash deploy/reset-wiki.sh
# =============================================================================

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WIKI_DATA="$APP_DIR/wiki-data"

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

info() { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()   { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()  { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }

echo ""
echo "============================================================"
echo "  massiveWiki — reset to clean state"
echo "  App dir   : $APP_DIR"
echo "  Wiki data : $WIKI_DATA"
echo "============================================================"
echo ""

warn "This will permanently delete:"
echo "   • All wiki pages  (wiki-data/pages/)"
echo "   • All uploaded images  (wiki-data/images/)"
echo "   • Admin account  (wiki-data/_wiki/_admin.json)"
echo "   • Wiki config  (wiki-data/_wiki/_config.json)"
echo "   • Special pages  (wiki-data/_wiki/_sidebar.md, _footer.md)"
echo ""
warn "The .env file will NOT be touched."
echo ""
read -r -p "Are you sure you want to reset? Type YES to confirm: " confirm
if [ "$confirm" != "YES" ]; then
    echo "Aborted."
    exit 0
fi

echo ""

# Stop the service if running (Linux systemd only)
SERVICE_NAME="massivewiki"
if command -v systemctl &>/dev/null && systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    info "Stopping $SERVICE_NAME service..."
    if [ "$(id -u)" -eq 0 ]; then
        systemctl stop "$SERVICE_NAME"
    else
        sudo systemctl stop "$SERVICE_NAME"
    fi
    ok "Service stopped."
    RESTART_AFTER=true
else
    RESTART_AFTER=false
fi

# Remove wiki content
if [ -d "$WIKI_DATA/pages" ]; then
    rm -rf "$WIKI_DATA/pages"
    ok "Removed wiki-data/pages/"
fi

if [ -d "$WIKI_DATA/images" ]; then
    rm -rf "$WIKI_DATA/images"
    ok "Removed wiki-data/images/"
fi

# Remove admin account and wiki config files individually
for f in _admin.json _config.json _sidebar.md _footer.md; do
    target="$WIKI_DATA/_wiki/$f"
    if [ -f "$target" ]; then
        rm -f "$target"
        ok "Removed wiki-data/_wiki/$f"
    fi
done

# Recreate empty directories so the server starts cleanly
mkdir -p "$WIKI_DATA/pages" "$WIKI_DATA/images" "$WIKI_DATA/_wiki"
ok "Recreated empty directories."

# Restart the service if we stopped it
if $RESTART_AFTER; then
    info "Restarting $SERVICE_NAME service..."
    if [ "$(id -u)" -eq 0 ]; then
        systemctl start "$SERVICE_NAME"
    else
        sudo systemctl start "$SERVICE_NAME"
    fi
    ok "Service restarted."
fi

echo ""
echo "============================================================"
ok "Reset complete!"
echo ""
echo "  Next: restart the server (if not already done) and visit"
echo "  the wiki — you will be redirected to the setup wizard."
echo "============================================================"
echo ""
