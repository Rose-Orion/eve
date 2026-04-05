#!/bin/bash
# Double-click this file to restart the EVE orchestrator with the latest code changes.
cd "$(dirname "$0")"
echo "Restarting EVE orchestrator..."
pm2 restart eve-orchestrator 2>/dev/null || pm2 start ecosystem.config.cjs
echo ""
echo "Done. Checking status..."
sleep 2
pm2 list
echo ""
echo "Tailing logs (Ctrl+C to stop)..."
pm2 logs eve-orchestrator --lines 30
