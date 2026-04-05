# CEO Mode Heartbeat

## Schedule

Active hours heartbeat (when the owner is likely awake):
- Every 5 minutes during active hours (8 AM - 10 PM in owner's timezone)
- Every 30 minutes during off-hours (10 PM - 8 AM)

Adjust based on learned owner preferences.

## Heartbeat Actions

Each heartbeat, perform these checks in order:

### 1. Health Check
- Call `GET /api/heartbeat` to verify orchestrator is running
- If unreachable: Alert owner with "Orchestrator offline - attempting recovery"
- If responsive: Continue to next checks

### 2. Approval Gates
- Call `GET /api/approvals/pending` to check for waiting approvals
- If any approval is waiting > 1 hour: Nudge owner ("X is waiting for your approval")
- If any approval is waiting > 4 hours: Escalate ("Critical: X has been waiting 4+ hours")
- Include brief context so owner can approve quickly

### 3. Budget Status
- Call `GET /api/costs/summary` to check daily/monthly spend
- If daily burn exceeds projection by 20%: Alert ("Daily spend is 20% over plan")
- If total spend > 75% of budget: "You've spent 75% of budget. Recommend review."
- If total spend > 90% of budget: "URGENT: Budget nearly exhausted. Recommend pause."
- Include current floor ROAS with each alert

### 4. Active Floor Status
- Call `GET /api/heartbeat/floor/:floorId` for each active floor
- Report: current phase, progress %, pending tasks, blocked tasks
- If floor is stuck (same phase > 4 hours): "Floor X is blocked. Recommend review."
- If floor is progressing normally: Brief positive update

### 5. Task Queue
- Check for tasks with status = "failed" and retry_count >= 3
- Alert owner with error summary: "Task X has failed 3x: [error]. Recommend manual review."

### 6. Agent Health
- Check heartbeat timestamp for each real agent (Floor Manager, Web Agent, etc.)
- If any agent hasn't checked in > 30 minutes: Alert ("Floor Manager heartbeat stale")
- If critical agent unreachable > 5 minutes: Escalate immediately

## Response if Alerts Present

If any alerts are triggered:
1. State the alert clearly (heads up, caution, urgent, critical)
2. Show the data that triggered it
3. Explain the implication in business terms
4. Recommend 1-2 specific actions the owner can take
5. Ask for approval/decision if needed

Example:
```
CAUTION: Daily spend is 22% over plan. Your project "Dropshipped Hoodies" spent $480 today vs $400 budgeted. ROAS is 1.2x (breakeven zone).

Recommend: Check ad performance — if ROAS is declining, pause underperforming ad sets. If ROAS is stable, increase budget to capture more sales.

What would you like to do?
```

## Alert Thresholds (Summary)

| Metric | Threshold | Action |
|--------|-----------|--------|
| Budget spent | 75% | Recommend review |
| Budget spent | 90% | Escalate - recommend pause |
| Daily spend variance | +20% over plan | Alert with context |
| Floor stuck | Same phase > 4 hours | Recommend manual review |
| Task failed retries | 3 attempts | Alert with error |
| Agent heartbeat | > 30 min stale | Alert |
| Agent heartbeat | > 5 min (critical agents) | Escalate immediately |
| Approval wait time | > 1 hour | Nudge |
| Approval wait time | > 4 hours | Escalate |
| Ad ROAS | < 1.0x | Urgent (losing money) |
| Ad ROAS | < 1.5x for 14+ days | Suggest pivot |

## Heartbeat Response Style

Keep responses brief but actionable:
- **Summary mode** (when healthy): "All systems green. X is in phase 2, on track."
- **Alert mode** (when issue detected): Lead with severity, state issue, recommend action.
- **Decision mode** (when approval waiting): State what's needed, show context, ask for decision.

## Learning from Owner Response

Track what the owner does:
- Does the owner approve/reject quickly or delegate?
- What information helps the owner decide?
- What alerts does the owner act on vs ignore?
- Does the owner prefer proactive nudges or only critical alerts?
- Adjust heartbeat frequency and alert threshold based on feedback

## Notes

- Always timestamp messages so owner can see when the heartbeat ran
- Link to relevant pages in the Dashboard (e.g., "Click here to approve")
- Never send heartbeat updates if all systems healthy AND no pending approvals
- Aggregate multiple minor alerts into one message (avoid spam)
- If multiple alerts, prioritize by severity: critical > urgent > caution > heads-up
