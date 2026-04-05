# EVE Operations Guide

## Starting EVE

### Development Mode
```bash
npm run dev
# or
npx tsx src/index.ts
```

### Production with PM2
```bash
pm2 start "npx tsx src/index.ts" --name eve-orchestrator --instances 1
pm2 save
pm2 startup
```

### Restart EVE
```bash
pm2 restart eve-orchestrator
# or full stop/start
pm2 stop eve-orchestrator && pm2 start eve-orchestrator
```

## Daily Operations Checklist

### Morning
- [ ] Check orchestrator health: `curl http://localhost:3000/api/health`
- [ ] Verify all integrations are online: `curl http://localhost:3000/api/health/integrations`
- [ ] Check floor list and active operations: `curl http://localhost:3000/api/floors`
- [ ] Review budget usage: `curl http://localhost:3000/api/costs/summary`
- [ ] Check logs for any errors: `pm2 logs eve-orchestrator`

### Throughout Day
- Monitor active tasks via Dashboard (http://localhost:3000)
- Approve pending gates/reviews as needed
- Monitor budget alerts (thresholds: 50%, 75%, 90%)
- Check for failed or stuck tasks

### End of Day
- Ensure no critical tasks are blocked
- Review daily spend summary
- Back up important outputs
- Archive logs if needed

## Monitoring

### Health Endpoints

**System Health**
```bash
curl http://localhost:3000/api/health
# Returns: { status: 'ok', uptime: number, agents: {...}, memory: {...} }
```

**Integration Status**
```bash
curl http://localhost:3000/api/health/integrations
# Returns: array of integration checks (Anthropic, FAL, OpenAI, Stripe, etc.)
```

**Heartbeat**
```bash
curl http://localhost:3000/api/heartbeat
# Returns: { status: 'alive', timestamp, activeFloors, activeTasks }
```

### Logs

**View logs in real-time**
```bash
pm2 logs eve-orchestrator
```

**View logs for a specific component**
```bash
pm2 logs eve-orchestrator | grep "budget"
pm2 logs eve-orchestrator | grep "Guardian"
pm2 logs eve-orchestrator | grep "ERROR"
```

**Log file location**
```
~/.pm2/logs/eve-orchestrator-out.log
~/.pm2/logs/eve-orchestrator-error.log
```

## Common Tasks

### Create a New Floor
```bash
curl -X POST http://localhost:3000/api/floors \
  -H "Authorization: Bearer $EVE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "businessIdea": "A D2C brand selling sustainable water bottles",
    "budget": 50000,
    "owner": "john@example.com"
  }'
```

### Check Floor Status
```bash
curl http://localhost:3000/api/floors/:floorId \
  -H "Authorization: Bearer $EVE_API_KEY"
```

### List All Tasks for a Floor
```bash
curl "http://localhost:3000/api/floors/:floorId/tasks" \
  -H "Authorization: Bearer $EVE_API_KEY"
```

### Approve a Task Review
```bash
curl -X POST http://localhost:3000/api/approvals/:approvalId \
  -H "Authorization: Bearer $EVE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "approved": true, "feedback": "Looks good!" }'
```

### Check Budget Usage
```bash
curl "http://localhost:3000/api/costs/summary?floorId=:floorId" \
  -H "Authorization: Bearer $EVE_API_KEY"
```

## Backup & Recovery

### Backup Database
```bash
# Supabase automatic backups (enabled by default)
# Manual backup:
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```

### Restore from Backup
```bash
psql $DATABASE_URL < backup-20240401.sql
```

### Backup Floor Outputs
```bash
# All floor files are stored in ./floors/:floorId
tar -czf floors-backup-$(date +%Y%m%d).tar.gz floors/
```

### Redis Persistence
```bash
# Redis dump.rdb is auto-saved
# Manual save:
redis-cli BGSAVE
```

## Budget Management

### Set Floor Budget
Budget is set at floor creation. To view current spending:
```bash
curl "http://localhost:3000/api/costs/summary?floorId=:floorId" \
  -H "Authorization: Bearer $EVE_API_KEY"
```

### Budget Alert Thresholds
- 50% spent: Advisory alert
- 75% spent: Warning alert
- 90% spent: Critical alert
- 100% spent: Budget exceeded - tasks blocked

### Reset Budget (Emergency)
Contact the system admin with owner approval. This should be rare.

## Environment Variables

Key environment variables for operation:
```
ANTHROPIC_API_KEY       # Required - Claude API access
FAL_KEY                 # For image/video generation
OPENAI_API_KEY          # For GPT image text-in-image
STRIPE_SECRET_KEY       # For payment processing
ELEVENLABS_API_KEY      # For voice generation
META_ACCESS_TOKEN       # For Meta/Instagram integration
TIKTOK_ACCESS_TOKEN     # For TikTok integration
PRINTFUL_API_KEY        # For print-on-demand
EVE_API_KEY             # API authentication (optional)
DATABASE_URL            # Supabase PostgreSQL connection
REDIS_URL               # Redis connection
NODE_ENV                # Should be "production"
```

## Performance Tuning

### Increase Concurrency
Edit `src/config/types.ts`:
```typescript
DEFAULT_CONCURRENCY: {
  maxConcurrentAgents: 6,      // Default 4
  maxOpusAgents: 3,             // Default 2
  maxAgentsPerFloor: 3,         // Default 2
  minDelayBetweenDispatchMs: 1000, // Default 2000
}
```

### Optimize Token Usage
- Reduce gold standard examples (fewer 'gold' examples in prompts)
- Use shorter brand context
- Use Sonnet/Haiku for non-critical tasks
- Use Opus only for Foundation and Launch phases

## Troubleshooting

See TROUBLESHOOTING.md for common issues and solutions.
