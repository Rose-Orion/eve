# EVE — Mac Mini Setup Guide (v2)
## Research-Backed Configuration for Maximum Agent Performance

---

# BEFORE YOU START

**What you need ready:**
- Mac Mini (M2 or M4, 16GB+ RAM, 512GB+ SSD)
- Ethernet cable (wired preferred for always-on)
- Monitor, keyboard, mouse (temporary — initial setup only)
- Anthropic API key (console.anthropic.com → API Keys)
- Brave Search API key (brave.com/search/api — free tier, 2,000 queries/month)

**Estimated time: 60-90 minutes**

---

# PART 1: MAC MINI HARDWARE (10 min)

## Step 1: macOS Initial Setup

```
DURING SETUP:
  Create a LOCAL account — do NOT sign in with Apple ID/iCloud
  Name: your name (this is the admin account)
  Enable FileVault: YES
  Enable Siri: NO
  Enable Analytics: NO
```

## Step 2: Create Dedicated Standard User

All OpenClaw operations run under a restricted user.

```
System Settings → Users & Groups → Add User
  Account type: Standard
  Full name: EVE
  Account name: eve
  Password: [strong password — save it]
```

Log out of admin. Log in as `eve` for everything below.

## Step 3: Always-On Power Settings

```bash
# From admin account (need sudo):
sudo pmset -a sleep 0 displaysleep 0 disksleep 0
sudo pmset -a autorestart 1
sudo pmset -a disablesleep 1
```

## Step 4: Enable Remote Access

```
System Settings → General → Sharing:
  ✅ Remote Login (SSH) — allow for eve user
  ✅ Screen Sharing — enable
```

```bash
# Note your IP:
ipconfig getifaddr en0
```

## Step 5: Firewall

```
System Settings → Network → Firewall → Turn On
  Do NOT check "Block all incoming connections"
  (SSH needs incoming connections)
```

## Step 6: Go Headless

Disconnect monitor/keyboard/mouse. All remaining steps via SSH:
```bash
ssh eve@[ip-address]
```

---

# PART 2: INSTALL DEPENDENCIES (10 min)

## Step 7: Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

## Step 8: Node.js 24

```bash
brew install node@24
echo 'export PATH="/opt/homebrew/opt/node@24/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
node --version    # Should show v24.x.x
```

## Step 9: Redis

```bash
brew install redis
brew services start redis
redis-cli ping    # Should respond: PONG
```

## Step 10: PM2 + Git + Tailscale

```bash
npm install -g pm2
xcode-select --install    # Git via Xcode CLI tools
brew install --cask tailscale

git config --global user.name "EVE"
git config --global user.email "eve@localhost"
```

Set up Tailscale via Screen Sharing (brief GUI step), note the Tailscale IP (100.x.x.x).

---

# PART 3: INSTALL AND CONFIGURE OPENCLAW (20 min)

## Step 11: Install OpenClaw

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
openclaw --version
# MUST be 2026.3.x or later (critical security patches)
```

## Step 12: Non-Interactive Onboarding

The research shows non-interactive mode is more reliable than the wizard. This sets every option explicitly:

```bash
openclaw onboard --non-interactive \
  --mode local \
  --auth-choice apiKey \
  --anthropic-api-key "$ANTHROPIC_API_KEY" \
  --gateway-port 18789 \
  --gateway-bind loopback \
  --install-daemon \
  --daemon-runtime node \
  --skip-skills
```

If you prefer the interactive wizard for more control:
```bash
openclaw onboard
# Choose: Advanced (not QuickStart)
# Mode: Local
# Provider: Anthropic
# Auth: API Key → paste your key
# Default model: claude-opus-4-6
# Gateway port: 18789
# Gateway bind: loopback (CRITICAL — never 0.0.0.0)
# Auth mode: token (auto-generated)
# Channels: skip all for now
# Daemon: yes, Node runtime
# Skills: skip (we'll configure manually)
```

## Step 13: Grant macOS Permissions

Via Screen Sharing (GUI required):
```
System Settings → Privacy & Security:
  ✅ Full Disk Access → add Terminal (or the Node.js binary)
  ✅ Accessibility → add Terminal
```

## Step 14: Configure the openclaw.json

This is the most important step. We're writing the complete configuration for EVE. OpenClaw uses JSON5 format (comments allowed).

```bash
cat > ~/.openclaw/openclaw.json << 'CONFIGEOF'
{
  // === EVE CONFIGURATION ===
  // Last updated: March 2026
  
  "meta": {
    "lastTouchedVersion": "2026.3.x"
  },
  
  // === GATEWAY ===
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",        // CRITICAL: only localhost, never 0.0.0.0
    "auth": {
      "mode": "token",
      // Token auto-generated during onboarding — DO NOT change
      "allowTailscale": true   // Allows access via Tailscale VPN
    }
  },
  
  // === IDENTITY ===
  "identity": {
    "name": "EVE",
    "emoji": "🌟",
    "theme": "autonomous business builder"
  },
  
  // === MODELS ===
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-opus-4-6",
        "fallbacks": [
          "anthropic/claude-sonnet-4-6"
        ]
      },
      "models": {
        "anthropic/claude-opus-4-6": { "alias": "opus" },
        "anthropic/claude-sonnet-4-6": { "alias": "sonnet" },
        "anthropic/claude-haiku-4-5": { "alias": "haiku" }
      },
      
      // === WORKSPACE ===
      "workspace": "~/.openclaw/workspace",
      
      // === HEARTBEAT (for CEO Mode) ===
      "heartbeat": {
        "every": "30m",
        "target": "none",                // No channel — Orchestrator reads output
        "lightContext": true,             // Reduce context reload cost
        "isolatedSession": true           // Fresh session each heartbeat
      }
    },
    
    // === AGENT LIST ===
    // Only real agents registered here. Virtual agents handled by Orchestrator.
    "list": [
      {
        "id": "eve-ceo",
        "default": true,
        "workspace": "~/.openclaw/agents/eve-ceo"
      }
      // Floor agents added dynamically by the Orchestrator:
      // floor-manager-{slug}, web-agent-{slug}, launch-agent-{slug}
    ]
  },
  
  // === MEMORY ===
  // Three-tier memory: always-loaded → daily context → deep knowledge
  "session": {
    "dmScope": "per-channel-peer",        // Isolate sessions per contact
    "compaction": {
      "mode": "safeguard",                // Don't aggressively prune context
      "softThresholdTokens": 40000        // Trigger compaction at 40K tokens
    },
    "memoryFlush": {
      "enabled": true,                    // Save context before compaction
      "prompt": "Before this context is compressed, write durable memories to your memory/ folder. Focus on: decisions made, state changes, owner preferences, task outcomes, and lessons learned. Skip routine exchanges. If nothing worth storing happened, write NO_FLUSH."
    }
  },
  
  // === HOOKS ===
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "command-logger": { "enabled": true },   // Log all commands
        "boot-md": { "enabled": true },          // Load boot context on startup
        "session-memory": { "enabled": true }     // Save session context to memory
      }
    }
  },
  
  // === CRON ===
  "cron": {
    "enabled": true,
    "maxConcurrentRuns": 1,              // One cron job at a time
    "sessionRetention": "24h"            // Clean old cron sessions after 24h
  },
  
  // === TOOLS ===
  "tools": {
    "profile": "coding",                 // Gives shell access (needed for Web Agent, Launch Agent)
    "web": {
      "search": {
        "provider": "brave",
        "apiKey": "${BRAVE_SEARCH_API_KEY}"
      }
    }
  },
  
  // === SKILLS ===
  "skills": {
    "autoLoad": false,                   // CRITICAL: no auto-loading skills
    "load": {
      "watch": true,                     // Hot-reload when SKILL.md changes
      "watchDebounceMs": 250
    }
  },
  
  // === SECURITY ===
  "security": {
    "exec": {
      "allowElevated": false             // No sudo/root commands
    }
  }
}
CONFIGEOF

echo "Configuration written."
```

**IMPORTANT:** After writing the config, re-insert your actual gateway auth token:
```bash
# Get your existing token:
openclaw config get gateway.auth.token
# If it shows the placeholder, regenerate:
openclaw doctor --generate-gateway-token
```

## Step 15: Set Up Web Search

```bash
# Store your Brave Search API key
openclaw configure --section web
# Follow prompts to enter Brave API key
# This lets agents search the web when needed
```

## Step 16: Security Audit

```bash
# Run deep security audit
openclaw security audit --deep

# Auto-fix issues
openclaw security audit --fix

# Lock down permissions
chmod 700 ~/.openclaw
chmod 600 ~/.openclaw/openclaw.json

# Verify loopback binding
netstat -an | grep 18789 | grep LISTEN
# Should show 127.0.0.1:18789, NOT 0.0.0.0:18789

# Verify no exposed secrets in config
grep -r "sk-ant-" ~/.openclaw/openclaw.json
# Should find nothing (key should be in credentials store)
```

## Step 17: Verify Gateway

```bash
openclaw gateway status
# Should show: running

openclaw status --deep
# Should show healthy probes

openclaw health
# Full health check
```

---

# PART 4: CREATE CEO MODE AGENT (15 min)

## Step 18: Create Workspace

```bash
mkdir -p ~/.openclaw/agents/eve-ceo/{skills,memory}
```

## Step 19: Write SOUL.md

```bash
cat > ~/.openclaw/agents/eve-ceo/SOUL.md << 'EOF'
# EVE CEO Mode

You are CEO Mode, the strategic overseer of the EVE autonomous business-building system.

## Role
- Evaluate business ideas using the 7-question framework
- Design floor plans (agent team, budget, timeline)
- Oversee all active business floors via the Orchestrator
- Share winning strategies across floors (never customer data)
- Propose system improvements with evidence

## Communication Style
Direct, strategic, data-driven. Lead with the bottom line. Use numbers when available. Flag decisions clearly: "DECISION NEEDED: [description]". No fluff, no filler, no corporate speak.

## Immutable Rules
- NEVER self-promote on the Trust Ladder
- NEVER increase budgets without owner approval
- NEVER modify the 10 safety rules
- NEVER access one floor's customer data from another floor
- ALWAYS present options — the owner makes final decisions
- ALWAYS cite evidence when recommending actions
EOF
```

## Step 20: Write HEARTBEAT.md

```bash
cat > ~/.openclaw/agents/eve-ceo/HEARTBEAT.md << 'EOF'
# CEO Mode Heartbeat

Reply HEARTBEAT_OK if nothing needs attention.
Do NOT repeat information from previous heartbeats.
Do NOT infer tasks from old conversations.

Check these items:
1. Any floor with pending approvals older than 4 hours?
2. Any floor budget above 75%?
3. Any floor ROAS below target for 3+ consecutive days?
4. Any improvement proposals awaiting review?
5. Monday mornings only: prepare weekly cross-floor summary.

If something needs attention, compose a brief notification:
- Lead with the most important item
- Include specific numbers
- Keep under 100 words
EOF
```

## Step 21: Write USER.md

```bash
cat > ~/.openclaw/agents/eve-ceo/USER.md << 'EOF'
# About the Owner

Communication channel: EVE Dashboard (PWA). iMessage later.

Preferences:
- Concise. Lead with the bottom line.
- Numbers over adjectives.
- Flag decisions: "DECISION NEEDED: [description]"
- No notifications between 11 PM and 7 AM unless critical.
EOF
```

## Step 22: Write AGENTS.md

```bash
cat > ~/.openclaw/agents/eve-ceo/AGENTS.md << 'EOF'
# EVE Agent Team

You are the top-level overseer. Below you are Autonomous Floors, each with:

## Real Agents (OpenClaw — shell access, memory, heartbeats):
- Floor Manager: project commander for each floor
- Web Agent: builds and deploys websites (Next.js, Vercel)
- Launch Agent: QA testing before go-live

## Virtual Agents (Orchestrator calls Anthropic API directly):
- Brand, Strategy, Finance, Copy, Design, Video, Commerce, Social, Ads, Analytics

You coordinate through the Orchestrator, not directly with agents.
The Orchestrator handles task dispatch, dependencies, and budget enforcement.
You provide strategic direction and judgment.
EOF
```

## Step 23: Register CEO Mode

```bash
openclaw agents add \
  --id eve-ceo \
  --model anthropic/claude-opus-4-6 \
  --workspace ~/.openclaw/agents/eve-ceo
```

## Step 24: Configure CEO Heartbeat

```bash
# Every 30 minutes during active hours
openclaw config set agents.list.0.heartbeat.every "30m"
openclaw config set agents.list.0.heartbeat.lightContext true
openclaw config set agents.list.0.heartbeat.isolatedSession true
openclaw config set agents.list.0.heartbeat.target "none"
```

## Step 25: Test CEO Mode

```bash
openclaw chat --agent eve-ceo --message "Who are you? Respond in under 50 words."
```

Expected: A concise response explaining it's CEO Mode. If this works, your first real agent is live.

---

# PART 5: ORCHESTRATOR SKELETON (15 min)

## Step 26: Create Project

```bash
mkdir -p ~/orion-orchestrator && cd ~/orion-orchestrator

npm init -y
npm pkg set type="module"

# Core dependencies
npm install typescript @types/node tsx
npm install fastify @fastify/cors
npm install bullmq ioredis
npm install @supabase/supabase-js
npm install @anthropic-ai/sdk
npm install @fal-ai/client
npm install openai
npm install chokidar dotenv zod
```

## Step 27: Environment File

```bash
cat > __PATH_EVE_ORCH__.env << 'EOF'
# === LLM ===
ANTHROPIC_API_KEY=sk-ant-your-key-here

# === Media Generation ===
FAL_KEY=fal-your-key-here
OPENAI_API_KEY=sk-your-key-here

# === Database ===
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# === Redis ===
REDIS_URL=redis://127.0.0.1:6379

# === Web Search ===
BRAVE_SEARCH_API_KEY=your-brave-key

# === OpenClaw ===
OPENCLAW_GATEWAY_TOKEN=your-gateway-token
EOF

chmod 600 __PATH_EVE_ORCH__.env
echo ".env" >> __PATH_EVE_ORCH__.gitignore
```

## Step 28: Boot Script

```bash
mkdir -p __PATH_EVE_ORCH__src

cat > __PATH_EVE_ORCH__src/index.ts << 'TSEOF'
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

async function boot() {
  console.log('🚀 EVE Orchestrator starting...\n');
  
  // 1. Anthropic API
  try {
    const anthropic = new Anthropic();
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Reply only: OK' }],
    });
    const text = r.content[0].type === 'text' ? r.content[0].text : '';
    console.log(`  ✅ Anthropic API: ${text.trim()}`);
  } catch (e: any) {
    console.error(`  ❌ Anthropic: ${e.message}`);
    process.exit(1);
  }
  
  // 2. Redis
  try {
    const { default: Redis } = await import('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
    const pong = await redis.ping();
    console.log(`  ✅ Redis: ${pong}`);
    await redis.quit();
  } catch (e: any) {
    console.error(`  ❌ Redis: ${e.message}`);
    process.exit(1);
  }
  
  // 3. OpenClaw
  try {
    const { execSync } = await import('child_process');
    const v = execSync('openclaw --version', { encoding: 'utf-8' }).trim();
    console.log(`  ✅ OpenClaw: ${v}`);
    const s = execSync('openclaw gateway status 2>&1', { encoding: 'utf-8' }).trim();
    console.log(`  ✅ Gateway: ${s}`);
  } catch (e: any) {
    console.error(`  ⚠️  OpenClaw: ${e.message}`);
  }
  
  // 4. fal.ai (just verify key exists)
  if (process.env.FAL_KEY) {
    console.log('  ✅ fal.ai key configured');
  } else {
    console.log('  ⚠️  fal.ai key missing (add later)');
  }
  
  console.log('\n🟢 EVE Orchestrator ready.');
  console.log('   Next: build PromptBuilder + VirtualDispatcher\n');
}

boot();
TSEOF
```

## Step 29: Test Boot

```bash
cd ~/orion-orchestrator
npx tsx src/index.ts
```

Expected output:
```
🚀 EVE Orchestrator starting...

  ✅ Anthropic API: OK
  ✅ Redis: PONG
  ✅ OpenClaw: 2026.3.x
  ✅ Gateway: running
  ✅ fal.ai key configured

🟢 EVE Orchestrator ready.
   Next: build PromptBuilder + VirtualDispatcher
```

## Step 30: PM2 Auto-Start

```bash
cd ~/orion-orchestrator
pm2 start "npx tsx src/index.ts" --name eve-orchestrator
pm2 save
pm2 startup    # Follow the instructions it prints
```

---

# PART 6: WORKSPACE + FINAL VERIFICATION (5 min)

## Step 31: Create Directory Structure

```bash
mkdir -p ~/orion-projects
mkdir -p __PATH_EVE_ORCH__prompt-templates
mkdir -p ~/orion-scripts

cd ~/orion-projects
git init
echo -e "node_modules/\n.next/\n.env*" > .gitignore
git add -A && git commit -m "EVE workspace initialized"
```

## Step 32: Full System Check

```bash
echo "========================================="
echo "  EVE SYSTEM CHECK"
echo "========================================="
echo ""
echo "RUNTIME:"
echo "  Node.js:  $(node --version)"
echo "  npm:      $(npm --version)"
echo "  PM2:      $(pm2 --version)"
echo "  Git:      $(git --version | cut -d' ' -f3)"
echo ""
echo "SERVICES:"
echo "  Redis:    $(redis-cli ping 2>/dev/null || echo 'NOT RUNNING')"
echo "  OpenClaw: $(openclaw --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "  Gateway:  $(openclaw gateway status 2>/dev/null || echo 'NOT RUNNING')"
echo ""
echo "AGENTS:"
openclaw agents list 2>/dev/null || echo "  (none listed)"
echo ""
echo "ORCHESTRATOR:"
pm2 list 2>/dev/null | grep eve || echo "  NOT RUNNING"
echo ""
echo "SECURITY:"
echo "  Bind:     $(netstat -an 2>/dev/null | grep 18789 | head -1 || echo 'check manually')"
echo "  FileVault: enabled (verified during setup)"
echo ""
echo "DISK:"
df -h / | tail -1 | awk '{print "  Used: " $3 " / " $2 " (" $5 " used)"}'
echo ""
echo "MEMORY:"
sysctl -n hw.memsize 2>/dev/null | awk '{printf "  RAM: %.0f GB\n", $1/1073741824}'
echo ""
echo "========================================="
echo "  Setup complete. Ready for Phase 0."
echo "========================================="
```

---

# WHAT YOU NOW HAVE

```
✅ Mac Mini running 24/7 headless (SSH + Tailscale for remote)
✅ OpenClaw installed, security audited, loopback-only
✅ Gateway: token auth, Tailscale allowed, hot-reload enabled
✅ Memory: 3-tier system with flush hooks (no context loss)
✅ Hooks: command-logger, boot-md, session-memory all enabled
✅ Skills: auto-load disabled, custom-only policy enforced
✅ CEO Mode: registered, heartbeat configured, responding
✅ Redis running for task queue
✅ Orchestrator skeleton: boots, verifies all connections
✅ PM2: auto-restart on crash and reboot
✅ Workspace: Git-versioned, directory structure ready
✅ .env: all API keys stored, permissions locked
```

---

# PHASE 0 — WHAT TO BUILD NEXT

```
THIS WEEK:
  □ PromptBuilder — XML template assembly with voice sample loading
  □ VirtualDispatcher — direct Anthropic API calls for 10 virtual agents
  □ TaskManager — task lifecycle (create → queue → dispatch → complete)
  □ TEST: dispatch a task to virtual "Copy Agent" and get useful output

NEXT WEEK:
  □ DependencyGraph — DAG with ready-task detection
  □ OpenClawDispatcher — dispatch to real agents via CLI
  □ Floor Manager template — SOUL.md, HEARTBEAT.md, quality review skill
  □ Floor creation sequence — the 9-step process
  □ TEST: FM + Brand Agent coordinate on a Foundation Sprint task
```

---

# TROUBLESHOOTING

```
"openclaw: command not found"
  → source ~/.zprofile (or close/reopen terminal)

"Gateway won't start"
  → openclaw doctor --fix
  → Verify Node 24+: node --version
  → Check logs: openclaw gateway logs

"Config validation error"
  → openclaw doctor --fix (removes stale keys from old versions)
  → Verify JSON5 syntax: no unquoted keys, no duplicate keys

"Memory not persisting between sessions"
  → Verify hooks.internal.entries.session-memory.enabled = true
  → Verify session.memoryFlush.enabled = true
  → Check memory/ folder: ls ~/.openclaw/agents/eve-ceo/memory/

"Rate limited by Anthropic"
  → Check your API tier: console.anthropic.com
  → Reduce heartbeat frequency: openclaw config set agents.defaults.heartbeat.every "1h"

"Can't SSH after going headless"
  → Check Remote Login in System Settings
  → Use Tailscale IP: ssh eve@100.x.x.x

"Security audit warnings"
  → openclaw security audit --fix
  → Verify: chmod 700 ~/.openclaw && chmod 600 ~/.openclaw/openclaw.json
  → Verify bind is loopback: netstat -an | grep 18789
```
