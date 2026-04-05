#!/bin/bash
echo "=== GitHub CLI Authentication ==="
echo "This will open your browser to authenticate."
echo "Just click 'Authorize' when prompted."
echo ""
gh auth login --web --git-protocol https -h github.com
echo ""
echo "=== Auth complete! Now running git setup... ==="
echo ""

cd ~/orion

# Check if already a git repo
if [ -d ".git" ]; then
    echo "Git already initialized, skipping init..."
else
    git init
    git checkout -b main
fi

git add -A
echo ""
echo "Files staged:"
git status --short | head -40
echo ""

git commit -m "Initial commit: EVE Orchestrator

Complete EVE autonomous business-building system orchestrator.
Includes: orchestrator core, prompt-builder, virtual/real agent dispatch,
dashboard API, media generation, 25 specification documents,
and Awwwards-quality Vael website output.

Co-Authored-By: Claude <noreply@anthropic.com>"

echo ""
echo "Creating GitHub repo Rose-Orion/eve..."
gh repo create Rose-Orion/eve --private --source=. --push --description "EVE - Autonomous business-building system orchestrator"

echo ""
echo "=== DONE! ==="
echo "Repo: https://github.com/Rose-Orion/eve"
echo ""
read -p "Press Enter to close..."
