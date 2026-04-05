#!/bin/bash
cd ~/orion

echo "=== EVE Git Setup ==="
echo ""

# Check gh auth
echo "Checking GitHub CLI auth..."
if ! gh auth status 2>/dev/null; then
    echo ""
    echo "ERROR: gh CLI not authenticated."
    echo "Run: gh auth login"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi
echo "✓ GitHub CLI authenticated"
echo ""

# Init git
echo "Initializing git repo..."
git init
git checkout -b main

# Add all files
echo "Adding files..."
git add -A

# Show what's being committed
echo ""
echo "Files to commit:"
git status --short | head -40
echo ""

# Commit
echo "Creating initial commit..."
git commit -m "Initial commit: EVE Orchestrator

Complete EVE autonomous business-building system orchestrator.
Includes: orchestrator core, prompt-builder, virtual/real agent dispatch,
dashboard API, media generation, 25 specification documents,
and Awwwards-quality Vael website output.

Co-Authored-By: Claude <noreply@anthropic.com>"

echo ""
echo "✓ Initial commit created"

# Create GitHub repo
echo ""
echo "Creating GitHub repo Rose-Orion/eve..."
gh repo create Rose-Orion/eve --private --source=. --push --description "EVE - Autonomous business-building system orchestrator"

echo ""
echo "=== Done! ==="
echo "Repo: https://github.com/Rose-Orion/eve"
echo ""
read -p "Press Enter to close..."
