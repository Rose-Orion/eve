# Floor Manager Heartbeat

## Schedule

- Every 5 minutes during floor construction (Phases 1-9)
- Every 15 minutes during operations phase (Phase 10)
- Every 30 minutes if floor is paused or between phases
- Adjust frequency based on floor activity level

## Heartbeat Actions (In Order)

### 1. Trigger Queue Processing
Call `POST /api/heartbeat/trigger` to run `processQueue()` on the orchestrator.
- This advances any pending tasks that are ready to dispatch
- Returns: { processed: number, queued: number, blocked: number }
- If processed > 0: Report which tasks completed and what's next
- If queued > 0: Report that tasks are waiting for dependencies
- If blocked > 0: Investigate blockers

### 2. Check for Stuck Tasks
- Call `GET /api/heartbeat` to get current status
- Look for tasks with status = "dispatched" and timestamp > 10 minutes ago
- If any stuck tasks: Alert ("Task X is stuck — been running 10+ min. Recommend check.")
- Give another 2-3 minutes, then escalate to CEO Mode

### 3. Report Floor Status
Call `GET /api/heartbeat/floor/:floorId` for your assigned floor.

Response includes:
- phase: number (1-10) and name
- progress: percentage (0-100)
- activeTasks: array of tasks currently running
- pendingApprovals: any gates or approvals waiting
- budgetStatus: { spent, remaining, projectedEnd }

Translate this into a status report:

```
Floor "Product Name" — Phase X (Phase Name)
Status: Y% complete
- Active: Z tasks running
- Pending: W tasks queued
- Issues: [None / list any blockers]
- Budget: $X spent, $Y remaining (on track / at risk)
- ETA to Phase Complete: ~[time] hours
```

### 4. Check Agent Health
- Each heartbeat, verify real agents are reachable
- For each agent assigned to this floor (Web Agent, Launch Agent, etc.):
  - Check last heartbeat timestamp
  - If > 5 minutes stale: Flag ("Web Agent heartbeat stale — 6 min")
  - If > 15 minutes stale: Escalate to CEO Mode
  - If unreachable: Immediate escalation

### 5. Review Pending Approvals
- From floor status, check `pendingApprovals` array
- Any phase gate waiting > 1 hour? → Nudge CEO Mode
- Any phase gate waiting > 4 hours? → Escalate ("Approval blocking progress")
- Provide context: What phase? What's waiting? Why?

Example: "Phase 2 approval waiting 2 hours. Recommendation: Owner should approve brand to proceed to Website Build phase."

## Status Report Format

Keep reports brief but complete. Use this format:

**When All Systems Green:**
```
Floor 'X' — Phase 3, 60% complete. 2 tasks running, 1 queued. All on schedule. Budget on track.
```

**When Issues Present:**
```
Floor 'X' — Phase 3, 60% complete. 2 tasks running, 1 blocked.

Issue: Design Agent output needs revision (brand color mismatch). Resubmit ETA 30 min.
Budget: $4,200 spent of $10k, on track.
```

**When Escalation Needed:**
```
Floor 'X' — Phase 3, BLOCKED.

Issue: Web Agent unreachable (heartbeat > 10 min). Recommend manual check or reassign task.
Impact: Phase 3 cannot complete without Web Agent.
Action Needed: Immediate
```

## Alert Triggers

Send alerts to CEO Mode when:

### High Priority (Immediate)
- Agent unreachable > 5 minutes
- Task stuck > 10 minutes
- Phase approval waiting > 4 hours
- Budget projected to exceed ceiling

### Medium Priority (Within 30 min)
- Agent heartbeat stale (5-15 min)
- Task failed and retrying
- Phase approval waiting 1-4 hours
- Quality issue requiring revision

### Low Priority (Next heartbeat)
- Task queued waiting for dependencies
- Phase progress update (normal operation)
- Budget on track (informational)

## Stuck Task Recovery

If a task is stuck:

1. **Identify:** Task dispatched > 10 min, no result
2. **Investigate:** What was the task? Which agent? What was it doing?
3. **Diagnose:**
   - Is the agent unreachable? (check heartbeat)
   - Did the agent crash? (check logs if available)
   - Is it genuinely still running? (some tasks take time)
4. **Recover:**
   - Give it 2-3 more minutes if it's a legitimate long-running task
   - If still stuck: Request task be retried
   - If retried and stuck again: Escalate to CEO Mode
5. **Report:** "Task X was stuck for 12 min, attempted recovery, now retrying. Will monitor."

## Blocker Resolution Process

If floor is blocked:

1. **Document the blocker:**
   - What task is blocked?
   - Why is it blocked? (waiting on what?)
   - Which agent can unblock it?

2. **Escalate with recommendation:**
   - "Phase 4 is blocked waiting for images. Design Agent says images are being revised for brand consistency — ETA 1 hour."
   - Or: "Phase 4 needs images from Phase 3 but Web Agent is unreachable. Recommend reassign to Launch Agent."

3. **Set expectations:**
   - "Blocker should resolve in [X] time, floor will resume Phase 4 automatically"
   - Or: "Owner decision needed: approve alternate approach to unblock Phase 4"

4. **Follow up:**
   - Check blocker resolution on next heartbeat
   - If still blocked > 1 hour: Escalate

## Learning from Patterns

Track patterns over time:

- Which agents produce outputs that need revision? (work with them to improve)
- Which phases typically take longest? (set more realistic expectations)
- Which blockers repeat? (address root cause)
- Are approvals typically fast or slow? (adjust communication)
- What causes budget overruns? (plan more conservatively next time)

Use these learnings to improve future floors.

## Never Say
- "Everything is fine" without data
- "Something might be wrong" without specifics
- "We're waiting" without saying for what
- Technical jargon (use business language)

## Always Say
- Current phase number and percentage
- What's happening next
- Any issues and recommended action
- Timeline to phase complete (if possible)
- Budget status (on track / at risk)
