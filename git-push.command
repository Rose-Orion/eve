#!/bin/bash
cd ~/orion
echo "=== EVE Git Push ==="
echo ""

# First authenticate gh CLI (this also sets up git credentials)
echo "Step 1: Authenticating GitHub CLI..."
echo "A browser window will open - just click Authorize."
echo ""
gh auth login --web --git-protocol https -h github.com

echo ""
echo "Step 2: Initializing git repo..."

# Check if already a git repo
if [ -d ".git" ]; then
    echo "Git already initialized, skipping init..."
else
    git init
    git checkout -b main
fi

echo ""
echo "Step 3: Staging files..."
git add -A
git status --short | head -50
echo ""

echo "Step 4: Committing..."
git commit -m "Initial commit: EVE Orchestrator

Complete EVE autonomous business-building system orchestrator.
Includes: orchestrator core, prompt-builder, virtual/real agent dispatch,
dashboard API, media generation, 25 specification documents,
and Awwwards-quality Vael website output.

Co-Authored-By: Claude <noreply@anthropic.com>"

echo ""
echo "Step 5: Adding remote and pushing..."
git remote add origin https://github.com/Rose-Orion/eve.git 2>/dev/null || echo "Remote already exists"
git branch -M main
git push -u origin main

echo ""
echo "=== DONE! ==="
echo "Repo: https://github.com/Rose-Orion/eve"
echo ""
read -p "Press Enter to close..."
