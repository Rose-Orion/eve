# EVE API Reference

## Quick Start

**Base URL**: `http://localhost:3000`

**Authentication**:
```bash
# Option 1: API Key
curl -H "Authorization: Bearer $EVE_API_KEY" http://localhost:3000/api/floors

# Option 2: Magic Link (via dashboard)
POST /api/auth/magic-link { "email": "owner@example.com" }

# Option 3: Supabase JWT
curl -H "Authorization: Bearer {jwt_token}" http://localhost:3000/api/floors
```

## Endpoints by Category

### Health & Status

#### Get System Health
```bash
GET /api/health
```
Response:
```json
{
  "status": "ok",
  "uptime": 3600000,
  "version": "0.1.0",
  "memory": {
    "heapUsed": 125000000,
    "heapTotal": 250000000,
    "rss": 350000000
  },
  "agents": {
    "active": 2,
    "total": 14,
    "realAgents": ["floor-manager", "web-agent"]
  },
  "database": "connected",
  "redis": "connected"
}
```

#### Get Integration Health
```bash
GET /api/health/integrations
```
Response:
```json
{
  "integrations": [
    { "name": "Anthropic", "status": "ok" },
    { "name": "FAL", "status": "ok" },
    { "name": "OpenAI", "status": "ok" },
    { "name": "Stripe", "status": "missing", "message": "Key not configured" },
    { "name": "ElevenLabs", "status": "ok" },
    { "name": "Printful", "status": "ok" },
    { "name": "Meta", "status": "expiring", "expiresAt": "2024-04-15T00:00:00Z" },
    { "name": "TikTok", "status": "ok" }
  ]
}
```

#### Heartbeat
```bash
GET /api/heartbeat
```
Response:
```json
{
  "status": "alive",
  "timestamp": "2024-04-01T10:30:00Z",
  "activeFloors": 3,
  "activeTasks": 7
}
```

### Floors (Businesses)

#### Create Floor
```bash
POST /api/floors
Authorization: Bearer $EVE_API_KEY
Content-Type: application/json

{
  "businessIdea": "A D2C brand selling sustainable water bottles",
  "budget": 50000,
  "owner": "john@example.com",
  "industry": "ecommerce",
  "targetAudience": "Women 25-40, eco-conscious"
}
```
Response: `201 Created`
```json
{
  "id": "floor-uuid",
  "businessIdea": "...",
  "status": "initializing",
  "budget": 50000,
  "spent": 0,
  "phase": 0,
  "createdAt": "2024-04-01T10:00:00Z",
  "owner": "john@example.com"
}
```

#### List Floors
```bash
GET /api/floors
Authorization: Bearer $EVE_API_KEY
```
Response: `200 OK`
```json
{
  "floors": [
    {
      "id": "floor-1",
      "businessIdea": "...",
      "status": "working",
      "phase": 3,
      "budget": 50000,
      "spent": 12500
    }
  ],
  "total": 1,
  "page": 1
}
```

#### Get Floor Details
```bash
GET /api/floors/:floorId
Authorization: Bearer $EVE_API_KEY
```
Response:
```json
{
  "id": "floor-1",
  "businessIdea": "...",
  "status": "working",
  "phase": 3,
  "phaseName": "Website Build",
  "budget": 50000,
  "spent": 12500,
  "owner": "john@example.com",
  "createdAt": "2024-04-01T10:00:00Z",
  "updatedAt": "2024-04-01T14:30:00Z",
  "outputDir": "./floors/floor-1",
  "brandVoice": "Playful, authentic, conversational",
  "targetAudience": "Women 25-40, eco-conscious"
}
```

#### Get Floor Stats
```bash
GET /api/floors/:floorId/stats
Authorization: Bearer $EVE_API_KEY
```
Response:
```json
{
  "taskCount": 47,
  "tasksCompleted": 32,
  "tasksFailed": 2,
  "tasksReview": 3,
  "tasksQueued": 10,
  "totalTokens": 125000,
  "lastActivity": "2024-04-01T14:30:00Z"
}
```

### Tasks

#### List Tasks (Floor)
```bash
GET /api/floors/:floorId/tasks
Authorization: Bearer $EVE_API_KEY
?status=completed&phase=3&limit=20&offset=0
```
Response:
```json
{
  "tasks": [
    {
      "id": "task-uuid",
      "floorId": "floor-1",
      "phase": 3,
      "status": "completed",
      "assignedAgent": "copy-agent",
      "taskType": "write-description",
      "description": "Write product description",
      "result": "Elegant, durable water bottles for the eco-conscious...",
      "cost": 150,
      "costTokens": 1250,
      "retryCount": 0,
      "createdAt": "2024-04-01T10:00:00Z",
      "completedAt": "2024-04-01T10:05:00Z"
    }
  ],
  "total": 47,
  "page": 1
}
```

#### Get Task Details
```bash
GET /api/tasks/:taskId
Authorization: Bearer $EVE_API_KEY
```
Response:
```json
{
  "id": "task-uuid",
  "floorId": "floor-1",
  "phase": 3,
  "status": "review",
  "assignedAgent": "copy-agent",
  "taskType": "write-description",
  "description": "Write product description",
  "prompt": "<role>...</role><task>...</task>",
  "result": "Product copy here...",
  "cost": 150,
  "retryCount": 0,
  "createdAt": "2024-04-01T10:00:00Z",
  "startedAt": "2024-04-01T10:02:00Z",
  "completedAt": "2024-04-01T10:05:00Z",
  "review": {
    "status": "pending",
    "feedbackNeeded": "Needs more emphasis on sustainability",
    "approvalRequired": true
  }
}
```

#### Cancel Task
```bash
DELETE /api/tasks/:taskId
Authorization: Bearer $EVE_API_KEY
```
Response: `204 No Content`

### Approvals (Reviews)

#### List Pending Approvals
```bash
GET /api/approvals
Authorization: Bearer $EVE_API_KEY
?status=pending&floorId=floor-1
```
Response:
```json
{
  "approvals": [
    {
      "id": "approval-uuid",
      "taskId": "task-uuid",
      "floorId": "floor-1",
      "status": "pending",
      "type": "review",
      "content": "Product copy for water bottles...",
      "requestedAt": "2024-04-01T10:05:00Z",
      "expiresAt": "2024-04-02T10:05:00Z"
    }
  ],
  "total": 3,
  "page": 1
}
```

#### Submit Approval
```bash
POST /api/approvals/:approvalId
Authorization: Bearer $EVE_API_KEY
Content-Type: application/json

{
  "approved": true,
  "feedback": "Looks great! A bit more emphasis on durability would be good.",
  "approvalToken": "optional-hmac-token-for-financial-transactions"
}
```
Response: `200 OK`
```json
{
  "id": "approval-uuid",
  "status": "approved",
  "approvedAt": "2024-04-01T14:30:00Z",
  "approvedBy": "john@example.com"
}
```

#### Reject Approval
```bash
POST /api/approvals/:approvalId/reject
Authorization: Bearer $EVE_API_KEY
Content-Type: application/json

{
  "reason": "Copy needs to address pain points more directly",
  "rerun": true
}
```
Response: `200 OK`

### Costs & Budget

#### Get Cost Summary
```bash
GET /api/costs/summary
Authorization: Bearer $EVE_API_KEY
?floorId=floor-1
```
Response:
```json
{
  "totalSpent": 12500,
  "totalBudget": 50000,
  "remaining": 37500,
  "percentageUsed": 25,
  "byAgent": {
    "copy-agent": 2500,
    "design-agent": 3000,
    "video-agent": 4000,
    "brand-agent": 3000
  },
  "byModel": {
    "opus": 7500,
    "sonnet": 4500,
    "haiku": 500
  },
  "alerts": [
    {
      "threshold": 0.5,
      "triggeredAt": "2024-04-01T12:00:00Z",
      "message": "50% of budget consumed"
    }
  ]
}
```

#### Get Cost History
```bash
GET /api/costs/:floorId
Authorization: Bearer $EVE_API_KEY
?days=7&limit=100
```
Response:
```json
{
  "costs": [
    {
      "id": "cost-uuid",
      "taskId": "task-uuid",
      "agent": "copy-agent",
      "model": "sonnet",
      "tokens": 1250,
      "costCents": 150,
      "timestamp": "2024-04-01T10:05:00Z"
    }
  ],
  "total": 25,
  "totalCostCents": 12500
}
```

### Chat & Communication

#### Send Message to Floor Manager
```bash
POST /api/chat/:floorId
Authorization: Bearer $EVE_API_KEY
Content-Type: application/json

{
  "message": "Can you prioritize the website design phase?",
  "attachments": ["file-uuid-1", "file-uuid-2"]
}
```
Response: `201 Created`
```json
{
  "id": "message-uuid",
  "floorId": "floor-1",
  "from": "owner",
  "to": "floor-manager",
  "message": "...",
  "timestamp": "2024-04-01T14:30:00Z",
  "read": false
}
```

#### Get Chat History
```bash
GET /api/chat/:floorId
Authorization: Bearer $EVE_API_KEY
?limit=50&offset=0
```
Response:
```json
{
  "messages": [
    {
      "id": "message-uuid",
      "floorId": "floor-1",
      "from": "floor-manager",
      "message": "Foundation Sprint complete. Ready for your review.",
      "timestamp": "2024-04-01T12:00:00Z",
      "read": true
    }
  ],
  "total": 47
}
```

### Notifications

#### Get Notifications
```bash
GET /api/notifications
Authorization: Bearer $EVE_API_KEY
?unread=true&limit=20
```
Response:
```json
{
  "notifications": [
    {
      "id": "notif-uuid",
      "floorId": "floor-1",
      "type": "approval_needed",
      "title": "Foundation Sprint Approval Needed",
      "message": "Brand strategy and voice are ready for your review",
      "timestamp": "2024-04-01T14:30:00Z",
      "read": false,
      "actionUrl": "/approvals/approval-uuid"
    }
  ],
  "total": 5
}
```

#### Mark Notification as Read
```bash
PATCH /api/notifications/:notifId
Authorization: Bearer $EVE_API_KEY

{ "read": true }
```

## Error Responses

All errors follow this format:

```json
{
  "error": "Error description",
  "code": "ERROR_CODE",
  "status": 400,
  "timestamp": "2024-04-01T10:00:00Z"
}
```

### Common Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `FORBIDDEN` | 403 | Token valid but not authorized for this resource |
| `NOT_FOUND` | 404 | Resource does not exist |
| `CONFLICT` | 409 | Action conflicts with current state (e.g., floor already working) |
| `BUDGET_EXCEEDED` | 429 | Floor budget exhausted, task blocked |
| `RATE_LIMITED` | 429 | Too many requests or concurrent agents at limit |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `INTERNAL_ERROR` | 500 | Server error, check logs |
| `SERVICE_UNAVAILABLE` | 503 | Orchestrator or dependency down |

## Webhook Events

Optional webhooks for real-time notifications:

```bash
POST /api/webhooks/subscribe
Authorization: Bearer $EVE_API_KEY
Content-Type: application/json

{
  "event": "task:completed",
  "url": "https://yourdomain.com/webhook",
  "floorId": "floor-1"
}
```

### Webhook Payload Examples

**Task Completed**:
```json
{
  "event": "task:completed",
  "timestamp": "2024-04-01T10:05:00Z",
  "taskId": "task-uuid",
  "floorId": "floor-1",
  "agent": "copy-agent",
  "cost": 150
}
```

**Approval Needed**:
```json
{
  "event": "approval:needed",
  "timestamp": "2024-04-01T14:30:00Z",
  "approvalId": "approval-uuid",
  "floorId": "floor-1",
  "type": "review",
  "expiresIn": 86400
}
```

**Budget Alert**:
```json
{
  "event": "budget:alert",
  "timestamp": "2024-04-01T12:00:00Z",
  "floorId": "floor-1",
  "threshold": 0.5,
  "spent": 25000,
  "budget": 50000
}
```

## Rate Limits

```
API calls: 1000/hour per API key
Webhooks: 10/second per endpoint
Socket connections: 100/server
Task dispatch: 1/2 seconds (enforced at dispatcher)
```

## Authentication Methods

### 1. API Key (Most Secure for Automation)
```bash
curl -H "Authorization: Bearer sk-your-api-key" http://localhost:3000/api/floors
```

### 2. Magic Link (Dashboard)
```bash
# Step 1: Request magic link
curl -X POST http://localhost:3000/api/auth/magic-link \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com"}'

# Step 2: User clicks link in email
# Step 3: Redirected to dashboard with session token

# Step 4: Use session token in API calls
curl -H "Authorization: Bearer {session-token}" http://localhost:3000/api/floors
```

### 3. Supabase JWT (OAuth)
```bash
# After OAuth login through Supabase
curl -H "Authorization: Bearer {jwt-token}" http://localhost:3000/api/floors
```

## Examples

### Full Workflow

```bash
# 1. Create floor
FLOOR=$(curl -X POST http://localhost:3000/api/floors \
  -H "Authorization: Bearer $EVE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "businessIdea": "Sustainable water bottles",
    "budget": 50000,
    "owner": "john@example.com"
  }' | jq -r '.id')

# 2. Monitor progress
curl http://localhost:3000/api/floors/$FLOOR \
  -H "Authorization: Bearer $EVE_API_KEY" | jq '.phase'

# 3. Check pending approvals
curl http://localhost:3000/api/approvals?floorId=$FLOOR \
  -H "Authorization: Bearer $EVE_API_KEY"

# 4. Approve task
curl -X POST http://localhost:3000/api/approvals/approval-uuid \
  -H "Authorization: Bearer $EVE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"approved": true}'

# 5. Check final costs
curl http://localhost:3000/api/costs/summary?floorId=$FLOOR \
  -H "Authorization: Bearer $EVE_API_KEY"
```
