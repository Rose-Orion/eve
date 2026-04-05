# EVE Troubleshooting Guide

## Server Won't Start

### Issue: Port 3000 already in use
```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or change the port
PORT=3001 npx tsx src/index.ts
```

### Issue: ANTHROPIC_API_KEY not set
```bash
# Verify environment variable
echo $ANTHROPIC_API_KEY

# Set it
export ANTHROPIC_API_KEY="sk-..."

# Start again
npm run start
```

### Issue: Redis connection failed
```bash
# Check if Redis is running
redis-cli ping
# Should respond: PONG

# Start Redis (if not running)
redis-server

# Or with Homebrew
brew services start redis
```

### Issue: Database connection failed
```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1"

# Verify DATABASE_URL is set
echo $DATABASE_URL

# Check Supabase dashboard for connection status
```

## Budget Issues

### Budget Exceeded - Tasks Blocked
**Error**: "Budget exceeded for floor {floorId}"

**Solution**:
1. Check current spend: `curl http://localhost:3000/api/costs/summary?floorId={floorId}`
2. Review recent high-cost operations (usually Opus model tasks)
3. Wait for pending task approvals to complete
4. Contact owner for budget increase
5. If urgent, can restart with reduced model tier (use Sonnet instead of Opus)

### Budget Alert Not Received
1. Check event bus is running: `curl http://localhost:3000/api/health`
2. Verify notifications are configured
3. Check logs: `pm2 logs eve-orchestrator | grep "budget"`

### Unexpected High Spend
1. Check task history: `curl http://localhost:3000/api/floors/{floorId}/tasks`
2. Look for tasks with high token counts
3. Review cost events: `curl http://localhost:3000/api/costs/{floorId}`
4. Common culprits:
   - Multiple Opus retries
   - Large image/video generations
   - Bulk copy generation

## Task Issues

### Task Stuck in "WORKING" State
1. Check if agent is responsive: `curl http://localhost:3000/api/health`
2. Check logs for agent errors: `pm2 logs eve-orchestrator | grep {taskId}`
3. Wait 5 minutes (agents may be processing large requests)
4. If still stuck, force task to FAILED:
   ```bash
   curl -X PATCH http://localhost:3000/api/tasks/{taskId} \
     -H "Authorization: Bearer $EVE_API_KEY" \
     -d '{"status":"failed"}'
   ```

### Task Fails Repeatedly (3+ retries)
1. Check task prompt for security violations: Grep guardian checks
2. Check for budget issues
3. Check agent logs: `pm2 logs eve-orchestrator | grep {agentId}`
4. Task automatically escalates to Floor Manager after 3 failures

### Task Waiting for Approval
1. Check pending approvals: `curl http://localhost:3000/api/approvals?status=pending`
2. Review the task output carefully
3. Approve or reject with feedback
4. Owner can also check dashboard at http://localhost:3000

### Approval Takes Too Long
1. Verify notification was sent to owner
2. Check notification logs: `pm2 logs eve-orchestrator | grep "notification"`
3. Manually ping owner (email/Slack)
4. Can proceed with auto-approval in emergency (not recommended)

## Agent Issues

### Agent Unresponsive
**Error**: "Agent {agentId} not responding"

1. Check agent health: `curl http://localhost:3000/api/health`
2. Check agent logs: `pm2 logs eve-orchestrator | grep {agentId}`
3. Restart the agent (for real agents): `openclaw restart --agent {agentId}`
4. If virtual agent: restart orchestrator
5. Failed tasks will retry up to 3 times automatically

### Agent Memory Exceeded
1. Check orchestrator memory: `curl http://localhost:3000/api/health`
2. Check for memory leaks in logs
3. Restart orchestrator: `pm2 restart eve-orchestrator`
4. Reduce concurrent agents if persistent

### Floor Manager Not Responding
Floor Manager is critical. If unresponsive:
1. Check OpenClaw gateway: `openclaw status --deep`
2. Check agent health: `openclaw chat --agent floor-manager --message "test"`
3. Restart agent: `openclaw restart --agent floor-manager`
4. All tasks requiring escalation will queue until available

## Integration Issues

### Anthropic API Key Expired
1. Check key status: `curl http://localhost:3000/api/health/integrations`
2. Should return: `{ status: 'ok' }`
3. If expired, update key: `export ANTHROPIC_API_KEY="sk-new..."`
4. Restart orchestrator: `pm2 restart eve-orchestrator`

### Stripe Payment Processing Failed
1. Check Stripe dashboard for errors
2. Verify Stripe API key is current: `curl http://localhost:3000/api/health/integrations`
3. Check customer's payment method is valid
4. Retry payment through dashboard

### FAL Image Generation Failing
1. Check FAL API key: `curl http://localhost:3000/api/health/integrations`
2. Check FAL status page for service issues
3. Check generated image dimensions are valid (512x512 to 1024x1024)
4. Review logs: `pm2 logs eve-orchestrator | grep "fal"`

### Meta/TikTok Token Expired
1. Check token status: `curl http://localhost:3000/api/health/integrations`
2. If expired, re-authenticate through OAuth flow
3. Update token in environment
4. Restart orchestrator

## Security Issues

### PII Detected in Output
**Error**: "Output contains PII (email/phone/SSN)"

1. Review the rejected output
2. Identify what PII was found
3. Adjust agent prompt to not request customer data
4. Re-run task with modified prompt
5. Check guardian rules: `src/security/guardian.ts`

### Unauthorized API Access
**Error**: "Invalid or expired token" (401/403)

1. Check your API key: `echo $EVE_API_KEY`
2. Verify it matches server's configured key
3. If using session token, may be expired (24 hour limit)
4. Request new magic link or API key

### Budget Over-spend Suspected
1. Audit cost records: Review all cost events
2. Check for rogue agents making expensive calls
3. Review task history for anomalies
4. Check logs for suspicious activity
5. Enable budget tracing: Increase log level to DEBUG

## Database Issues

### Connection Pool Exhausted
**Error**: "No more connections available"

1. Check active connections: `SELECT count(*) FROM pg_stat_activity;`
2. Restart orchestrator: `pm2 restart eve-orchestrator`
3. If persistent, check for connection leaks in code
4. Reduce max concurrent agents

### Data Corruption Detected
1. Check database integrity: `PRAGMA integrity_check;` (SQLite) or `pg_dump ... | pg_restore`
2. Restore from latest backup
3. Investigate root cause in logs
4. If urgent, contact Supabase support

### Slow Queries
1. Check slow query log: Enable in Supabase dashboard
2. Add indexes: Review `migrations/` for index definitions
3. Batch queries where possible
4. Increase database compute if persists

## Performance Issues

### Orchestrator Slow
1. Check memory: `curl http://localhost:3000/api/health`
2. Check CPU usage: `top | grep node`
3. Check active agents: `curl http://localhost:3000/api/health`
4. Reduce concurrent agents if needed
5. Clear old task history (archive to S3)

### Dashboard Slow
1. Check API response times: `npx tsx tests/performance-baseline.ts`
2. If API slow, see "Orchestrator Slow" above
3. Clear browser cache: Ctrl+Shift+Delete
4. Check browser console for errors: F12 > Console

### Memory Leak Suspected
1. Monitor memory over time: `watch -n 1 'ps aux | grep "tsx src/index"'`
2. If memory consistently increases, likely a leak
3. Check recent changes in code
4. Restart orchestrator and monitor: `pm2 restart eve-orchestrator`
5. Enable Node.js heap snapshots if needed

## Emergency Procedures

### Orchestrator Crash - Restart Immediately
```bash
pm2 restart eve-orchestrator
# Or
pm2 kill && pm2 start "npx tsx src/index.ts" --name eve-orchestrator
```

### Budget Runaway - Emergency Stop
```bash
# Pause all task dispatch
curl -X POST http://localhost:3000/api/admin/pause-dispatch \
  -H "Authorization: Bearer $EVE_API_KEY"

# Review what happened
curl http://localhost:3000/api/costs/summary \
  -H "Authorization: Bearer $EVE_API_KEY"

# Resume when safe
curl -X POST http://localhost:3000/api/admin/resume-dispatch \
  -H "Authorization: Bearer $EVE_API_KEY"
```

### Security Incident - Immediate Actions
1. Rotate API keys: Update all integration keys
2. Review logs: Check for unauthorized access
3. Pause dispatch: Prevent further damage
4. Investigate: Identify what was accessed/modified
5. Restore: Roll back any malicious changes from backup
6. Post-mortem: Document and prevent future incidents

### Database Down - Use Read-Only Mode
1. Check database status: `pg_isready`
2. If down, temporary files stored locally
3. Resume operations when database restored
4. Sync local state back to database

## Getting Help

### Check Logs Thoroughly
```bash
# Last 100 lines
pm2 logs eve-orchestrator --lines 100

# Filter by keyword
pm2 logs eve-orchestrator | grep "error\|ERROR\|Error"

# Real-time monitoring
pm2 logs eve-orchestrator --follow
```

### Run Diagnostic Tests
```bash
# Smoke test
npx tsx tests/smoke-test.ts

# Security audit
npx tsx tests/security-audit.ts

# Performance baseline
npx tsx tests/performance-baseline.ts
```

### Collect Debug Info
1. Run diagnostics above
2. Gather logs (last 1000 lines)
3. Get system info: `uname -a`
4. Get Node.js version: `node --version`
5. Get installed dependencies: `npm list --depth=0`
6. Share with support team

### Support Resources
- CLAUDE.md - Project overview
- ARCHITECTURE.md - System design
- OPERATIONS.md - Standard operations
- specs/ - Detailed specifications
