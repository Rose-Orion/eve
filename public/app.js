// ── EVE Dashboard SPA ─────────────────────────────────────────────────
// Single-page app with view-based routing, live API polling, glassmorphism UI

const API   = '';   // same origin
const TOKEN = 'eve-dev-key-change-in-production';

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${TOKEN}`,
};

// ── Router ───────────────────────────────────────────────────────────────
const router = {
  current: 'tower',
  params:  {},
  history: [],

  go(view, params = {}) {
    this.history.push({ view: this.current, params: this.params });
    this.current = view;
    this.params  = params;
    actionTracker.track('navigate', { view, params });
    render();
  },

  back() {
    const prev = this.history.pop();
    if (prev) { this.current = prev.view; this.params = prev.params; render(); }
    else       { this.go('tower'); }
  },
};

// ── Action Tracker ───────────────────────────────────────────────────────
const actionTracker = {
  actions: [],
  maxActions: 30,
  track(type, detail) {
    this.actions.push({ type, detail, route: router.current, params: { ...router.params }, ts: new Date().toISOString() });
    if (this.actions.length > this.maxActions) this.actions.shift();
  },
  getRecent(n = 15) { return this.actions.slice(-n); },
};

// ── State ────────────────────────────────────────────────────────────────
// Local overrides persist across loadState() polls so demo progress isn't reset
const localFloorState = JSON.parse(localStorage.getItem('eve-floor-state') || '{}');

function saveLocalFloorState() {
  localStorage.setItem('eve-floor-state', JSON.stringify(localFloorState));
}

function getLocalPhase(floorId) {
  // Always read fresh from localStorage so external updates (debug console) are picked up
  const stored = JSON.parse(localStorage.getItem('eve-floor-state') || '{}');
  return stored[floorId]?.phase ?? null;
}

function setLocalPhase(floorId, phase) {
  if (!localFloorState[floorId]) localFloorState[floorId] = {};
  localFloorState[floorId].phase = phase;
  saveLocalFloorState();
}

function getLocalBrand(floorId) {
  const stored = JSON.parse(localStorage.getItem('eve-floor-state') || '{}');
  return stored[floorId]?.brand ?? null;
}

function setLocalBrand(floorId, brandIndex) {
  if (!localFloorState[floorId]) localFloorState[floorId] = {};
  localFloorState[floorId].brand = brandIndex;

  // Capture the selected logo URL so the branded UI can show it immediately
  const letters = ['A','B','C'];
  const letter = letters[brandIndex] || 'A';
  const logoCache = state.gate1BrandLogos?.[floorId] || {};
  const candidates = logoCache[letter] || [];
  const choiceIdx = (state.gate1LogoChoice?.[floorId]?.[letter]) || 0;
  if (candidates[choiceIdx]) {
    localFloorState[floorId].logoUrl = candidates[choiceIdx];
  }

  saveLocalFloorState();
}

const state = {
  floors:       [],
  approvals:    [],
  costs:        null,
  activity:     [],
  improvements: [],
  feedback: [],
  systemLearnings: [],

  // Per-floor task cache: floorId → full task array
  floorTasks: {},

  // New-idea wizard
  idea:    { step: 1, description: '', answers: {}, questions: null, evaluation: null },

  // Gate 1 brand/strategy cache: floorId → parsed data
  gate1BrandData: {},         // floorId → brand[] (empty = not loaded yet or parse failed)
  gate1BrandStatus: {},       // floorId → 'loading' | 'parsed' | 'parse-failed' | 'no-task'
  gate1BrandLogos: {},        // floorId → { A: [url,url,url], B: [...], C: [...] } — logo candidates
  gate1LogoChoice: {},        // floorId → { A: 0, B: 0, C: 0 } — which candidate is selected per direction
  gate1StrategyData: {},

  // Backend theme data: floorId → { theme, cssVariables, googleFontsUrl }
  floorThemes: {},

  // Live data polling
  pollTimer: null,
};

// ── Budget refresh helper ─────────────────────────────────────────────────
// Re-fetches a single floor from the API and patches state.floors in-place.
// Called after budget-related tasks complete to ensure the widget reflects
// up-to-date spentCents / budgetCeilingCents without waiting for the poll.
async function refreshFloorBudget(floorId) {
  if (!floorId) return;
  try {
    const res = await fetch(API + `/api/floors/${floorId}`, {
      headers: { Authorization: headers.Authorization },
    });
    if (!res.ok) return;
    const updated = await res.json();
    if (!updated) return;
    const idx = state.floors.findIndex(f => f.id === floorId);
    if (idx > -1) {
      // Normalise snake_case → camelCase for budget fields
      const spentCents = updated.spentCents ?? updated.spent_cents ?? state.floors[idx].spentCents ?? 0;
      const budgetCeilingCents = updated.budgetCeilingCents ?? updated.budget_ceiling_cents ?? state.floors[idx].budgetCeilingCents ?? 0;
      state.floors[idx] = { ...state.floors[idx], ...updated, spentCents, budgetCeilingCents };
    }
    // Re-render if on a floor or tower view
    if (['tower', 'floor'].includes(router.current)) render();
  } catch (e) {
    console.warn('[refreshFloorBudget] failed for', floorId, e.message);
  }
}

// ── API helpers ──────────────────────────────────────────────────────────
async function api(method, path, body) {
  try {
    // Only send Content-Type when there's a body — Fastify rejects
    // Content-Type: application/json with an empty body on any method.
    const reqHeaders = body
      ? headers
      : { Authorization: headers.Authorization };
    const res = await fetch(API + path, {
      method,
      headers: reqHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      console.warn('API error', path, res.status, errBody?.error);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('API error', path, e.message);
    return null;
  }
}

// Snapshot of spentCents per floor from the previous poll — used to detect spend events
const _prevSpentCents = {};

// Snapshot of pending approval IDs from the previous poll — used to surface new approval toasts
const _prevApprovalIds = new Set();

// Called after every loadState() to detect newly-arrived approvals and
// surface them as an owner-facing toast notification.
function checkForNewApprovals() {
  const pending = state.approvals.filter(a => a.status === 'pending');
  const newArrivals = pending.filter(a => !_prevApprovalIds.has(a.id));

  if (newArrivals.length > 0 && _prevApprovalIds.size > 0) {
    // Only toast on arrivals after the first load (size > 0 guard prevents
    // a flood of toasts on initial page load when all approvals are "new").
    for (const a of newArrivals) {
      const floorName = floorDisplayName(state.floors.find(f => f.id === a.floorId)) || 'your floor';
      const label = a.phaseName || a.title || 'Review needed';
      toast(`🔴 ${label} — ${floorName} is waiting for your approval`, 'info');
    }
  }

  // Rebuild snapshot from current pending set
  _prevApprovalIds.clear();
  for (const a of pending) _prevApprovalIds.add(a.id);
}

async function fetchBrandLogos(floorId, parsedBrands, forceRegenerate = false) {
  const letters = ['A', 'B', 'C'];
  const directions = parsedBrands.slice(0, 3).map((b, i) => ({
    name: b.brandName || `Option ${letters[i]}`,
    logoDirection: b.logoDirection || '',
    colors: b.colors || ['#1A1A2E', '#D4AF37'],
    tagline: b.tagline || '',
    concept: b.concept || '',
    voice: b.voice || '',
    typography: b.typography || '',
  }));

  console.log(`[Logos] Requesting logo candidates for floor ${floorId}:`, directions.map(d => d.name), forceRegenerate ? '(regenerate)' : '');
  // logos[floorId] = { A: [url, url, url], B: [...], C: [...] }
  state.gate1BrandLogos[floorId] = { _loading: true };
  // Track which candidate the owner is viewing per direction (default 0)
  if (!state.gate1LogoChoice) state.gate1LogoChoice = {};
  if (!state.gate1LogoChoice[floorId]) state.gate1LogoChoice[floorId] = {};
  render();

  try {
    const body = { directions, regenerate: forceRegenerate || undefined };
    const res = await api('POST', `/api/floors/${floorId}/brand-logos`, body);
    if (res.logos) {
      state.gate1BrandLogos[floorId] = res.logos;
      const summary = Object.entries(res.logos).map(([k, v]) => `${k}:${Array.isArray(v) ? v.length : 1}`).join(', ');
      console.log(`[Logos] Received candidates for floor ${floorId}: ${summary}`, res.cached ? '(cached)' : '(generated)');
    } else {
      state.gate1BrandLogos[floorId] = {};
      console.warn(`[Logos] No logos returned for floor ${floorId}`);
    }
  } catch (err) {
    console.error(`[Logos] Failed to fetch logos for floor ${floorId}:`, err);
    state.gate1BrandLogos[floorId] = {};
  }
  render();
}

async function loadState() {
  const [floors, approvals, costs, improvements, feedback, learnings] = await Promise.all([
    api('GET', '/api/floors'),
    api('GET', '/api/approvals'),
    api('GET', '/api/costs/summary'),
    api('GET', '/api/improvements'),
    api('GET', '/api/feedback'),
    api('GET', '/api/feedback/learnings'),
  ]);
  state.floors       = (floors || []).map(f => {
    const localPhase = getLocalPhase(f.id);
    // Normalise snake_case → camelCase for budget fields (API may return either)
    const normalised = {
      ...f,
      spentCents:         f.spentCents         ?? f.spent_cents         ?? 0,
      budgetCeilingCents: f.budgetCeilingCents  ?? f.budget_ceiling_cents ?? 0,
      currentPhase:       f.currentPhase        ?? f.current_phase       ?? 1,
    };
    return localPhase !== null ? { ...normalised, currentPhase: localPhase } : normalised;
  });

  // Detect spend events: any floor whose spentCents increased since last poll
  // triggers a targeted floor refresh so the budget widget updates immediately.
  for (const f of state.floors) {
    const prev = _prevSpentCents[f.id];
    if (prev !== undefined && f.spentCents > prev) {
      // Non-blocking targeted refresh — updates state.floors[i] in-place
      refreshFloorBudget(f.id).catch(() => {});
    }
    // Update snapshot for next poll
    _prevSpentCents[f.id] = f.spentCents;
  }

  state.approvals    = approvals    || [];
  state.costs        = costs;
  state.improvements = improvements || [];
  state.feedback = feedback || [];
  state.systemLearnings = learnings || [];

  // Fetch cost breakdown by agent for the cost dashboard
  if (state.costs && state.floors.length > 0) {
    const firstFloor = state.floors[0];
    try {
      const byAgent = await api('GET', `/api/costs/${firstFloor.id}/by-agent`);
      if (byAgent) state.costs.byAgent = byAgent;
    } catch {}
  }

  // Load full task data for every floor — drives activity feed, progress, agent status, and brand gating
  const taskFetches = state.floors.map(f =>
    api('GET', `/api/floors/${f.id}/tasks`).then(tasks => ({ floorId: f.id, floorName: f.name, tasks: tasks || [] }))
  );
  const floorTaskData = await Promise.all(taskFetches);
  state.activity = buildRealActivity(floorTaskData, state.floors);

  // Cache full task list per floor + parse brand/strategy data eagerly
  for (const { floorId, tasks } of floorTaskData) {
    const previousTasks = state.floorTasks[floorId] || [];
    state.floorTasks[floorId] = tasks;

    // Detect budget-related task completions since last poll → refresh floor budget
    const BUDGET_TASK_TYPES = new Set(['budget-plan', 'budget-plan-redo', 'financial-projection']);
    const prevCompleted = new Set(previousTasks.filter(t => t.status === 'completed').map(t => t.id));
    const newlyCompleted = tasks.filter(
      t => t.status === 'completed' && BUDGET_TASK_TYPES.has(t.taskType) && !prevCompleted.has(t.id)
    );
    if (newlyCompleted.length > 0) {
      // Non-blocking — refresh budget data in background
      refreshFloorBudget(floorId).catch(() => {});
    }

    // Brand options — parse when task completes (re-parse if previous result was empty/placeholder)
    const brandTask = tasks.find(t => t.taskType === 'brand-options' && t.status === 'completed' && t.result);
    if (brandTask?.result) {
      const existing = state.gate1BrandData[floorId];
      const hasRealBrands = existing?.length > 0 && existing[0]?.brandName && !existing[0].brandName.startsWith('Option ');
      if (!hasRealBrands) {
        console.log(`[BrandLoad] Parsing brand-options result for floor ${floorId} (${brandTask.result.length} chars)`);
        const parsed = parseBrandOptionsMarkdown(brandTask.result);
        state.gate1BrandData[floorId] = parsed.length ? parsed : [];
        if (parsed.length > 0) {
          const allReal = parsed.every(b => b.brandName && !b.brandName.startsWith('Option '));
          state.gate1BrandStatus[floorId] = allReal ? 'parsed' : 'parse-failed';
          console.log(`[BrandLoad] Parsed ${parsed.length} brands:`, parsed.map(b => b.brandName));

          // Trigger logo generation if not already cached
          if (allReal && !state.gate1BrandLogos[floorId]) {
            fetchBrandLogos(floorId, parsed);
          }
        } else {
          state.gate1BrandStatus[floorId] = 'parse-failed';
          console.warn(`[BrandLoad] Parser returned 0 brands for floor ${floorId}. Result preview:`, brandTask.result.slice(0, 300));
        }
      }
    } else {
      const brandTaskAny = tasks.find(t => t.taskType === 'brand-options');
      if (brandTaskAny) {
        state.gate1BrandStatus[floorId] = 'loading';
        console.log(`[BrandLoad] brand-options task found but not completed+result. Status: ${brandTaskAny.status}, hasResult: ${!!brandTaskAny.result}`);
      } else {
        state.gate1BrandStatus[floorId] = 'no-task';
      }
      if (!(floorId in state.gate1BrandData)) state.gate1BrandData[floorId] = [];
    }

    // Strategy — cache raw text for gate1-strategy view
    const stratTask = tasks.find(t => t.taskType === 'business-strategy' && t.status === 'completed' && t.result);
    if (stratTask?.result) state.gate1StrategyData[floorId] = stratTask.result;

    // Brand Visual System (Phase 4) — extract full token set
    const bvsTask = tasks.find(t => t.taskType === 'brand-visual-system' && t.status === 'completed' && t.result);
    if (bvsTask?.result) {
      const extracted = parseBrandVisualSystem(bvsTask.result, floorId);
      if (extracted) {
        // Merge into floorThemes — only if backend theme endpoint hasn't already populated it
        if (!state.floorThemes[floorId]?.theme?.primaryColor) {
          state.floorThemes[floorId] = {
            ...state.floorThemes[floorId],
            theme: extracted,
            _source: 'brand-visual-system-task',
          };
          loadBrandFonts(floorId);
        }
      }
    }
  }

  // Fetch brand themes for all floors (non-blocking — 204 if not ready yet)
  await Promise.all(state.floors.map(async (f) => {
    try {
      const res = await fetch(API + `/api/floors/${f.id}/theme`, { headers: { Authorization: headers.Authorization } });
      if (res.ok && res.status !== 204) {
        state.floorThemes[f.id] = await res.json();
        loadBrandFonts(f.id);
      }
    } catch {}
  }));
}

const AGENT_META = {
  'brand-agent':        { icon: '🏷️', name: 'Brand Agent' },
  'strategy-agent':     { icon: '📊', name: 'Strategy Agent' },
  'finance-agent':      { icon: '💰', name: 'Finance Agent' },
  'copy-agent':         { icon: '✍️', name: 'Copy Agent' },
  'design-agent':       { icon: '🎨', name: 'Design Agent' },
  'video-agent':        { icon: '🎬', name: 'Video Agent' },
  'commerce-agent':     { icon: '🛍️', name: 'Commerce Agent' },
  'social-media-agent': { icon: '📣', name: 'Social Agent' },
  'ads-agent':          { icon: '📢', name: 'Ads Agent' },
  'analytics-agent':    { icon: '📈', name: 'Analytics Agent' },
  'floor-manager':      { icon: '🏢', name: 'Floor Manager' },
  'web-agent':          { icon: '🌐', name: 'Web Agent' },
};

const TASK_VERBS = {
  'brand-visual-system': 'built brand visual system',
  'logo-generation': 'generated brand logo',
  'brand-voice-guide': 'wrote brand voice guide',
  'brand-options': 'created brand direction options',
  'business-strategy': 'completed go-to-market strategy',
  'budget-plan': 'built financial projection',
  'product-catalog': 'built product catalog',
  'content-calendar': 'drafted content calendar',
  'email-welcome-sequence': 'wrote welcome email sequence',
  'promo-video-script': 'wrote promo video script',
  'launch-ad-campaign': 'built ad campaign plan',
  'analytics-setup': 'defined analytics tracking plan',
};

function buildRealActivity(floorTaskData, floors) {
  const items = [];
  const now = Date.now();

  for (const { floorName, tasks } of floorTaskData) {
    for (const task of tasks) {
      if (task.status !== 'completed' && task.status !== 'working' && task.status !== 'failed' && task.status !== 'escalated') continue;
      const meta = AGENT_META[task.assignedAgent] || { icon: '🤖', name: task.assignedAgent };
      const isFailed = task.status === 'failed' || task.status === 'escalated';
      const verb = isFailed
        ? `failed ${task.taskType.replace(/-/g, ' ')}`
        : (TASK_VERBS[task.taskType] || `completed ${task.taskType.replace(/-/g, ' ')}`);
      const completedAt = task.completedAt ? new Date(task.completedAt).getTime() : 0;
      const dispatchedAt = task.dispatchedAt ? new Date(task.dispatchedAt).getTime() : 0;
      const ts = completedAt || dispatchedAt || now;
      const minsAgo = Math.round((now - ts) / 60000);

      items.push({
        icon: isFailed ? '⚠️' : meta.icon,
        text: `${meta.name} ${verb} for ${floorName}`,
        time: minsAgo,
        floor: task.floorId,
        status: task.status,
        cost: task.actualCostCents,
        taskId: task.id,
        taskType: task.taskType,
      });
    }
  }

  if (items.length === 0) {
    items.push({ icon: '🌟', text: 'EVE is ready. Create your first business floor.', time: 0 });
  }

  return items.sort((a, b) => a.time - b.time).slice(0, 50);
}


function formatTime(mins) {
  if (mins === 0) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function fmtMoney(cents) {
  if (!cents) return '$0';
  return '$' + (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ── Toast ────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toast-out 300ms cubic-bezier(0.23,1,0.32,1) both';
    setTimeout(() => el.remove(), 310);
  }, 3500);
}

// ── Dashboard update banner ──────────────────────────────────────────────
function showDashboardUpdateBanner() {
  if (document.getElementById('dashboard-update-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'dashboard-update-banner';
  banner.innerHTML = `
    <span>🔧 Dashboard updated — refresh to see the latest fixes</span>
    <button onclick="location.reload()">Refresh Now</button>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--text-3);font-size:18px;cursor:pointer;padding:0 4px">✕</button>
  `;
  document.body.appendChild(banner);
}

// ── Modal ─────────────────────────────────────────────────────────────────
function showModal(html) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'eve-modal';
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
  overlay.innerHTML = `<div class="modal glass">${html}</div>`;
  document.body.appendChild(overlay);
}

function closeModal() {
  document.getElementById('eve-modal')?.remove();
}

function showDeliverablePreview(type, floorId) {
  const floor = state.floors.find(f => f.id === floorId) || { name: 'Your Brand', description: '' };
  const name = floorDisplayName(floor);
  const color = floorBrandColor(floor);

  if (type === 'Brand' || type === 'Logo') {
    const realBrands = state.gate1BrandData[floorId];
    const hasBrands  = Array.isArray(realBrands) && realBrands.length > 0;
    // Prefer backend selectedBrand index, then localStorage
    const backendBrandIdx = floor.selectedBrand?.index ?? null;
    const savedBrand = backendBrandIdx ?? getLocalBrand(floorId);
    const brandApprovedModal = savedBrand !== null && hasBrands;

    if (brandApprovedModal && hasBrands) {
      // Show full confirmed brand identity — prefer backend theme data
      const b = realBrands[savedBrand] || realBrands[0];
      const ft = state.floorThemes[floorId]?.theme;
      const mc1 = ft?.primaryColor || b.colors[0];
      const mc2 = ft?.secondaryColor || ft?.palette?.[1]?.hex || b.colors[1];
      const paletteSwatches = ft?.palette?.length
        ? ft.palette.map(s => ({ hex: s.hex, name: s.name }))
        : b.colors.map(c => ({ hex: c, name: c }));
      const mName = b.brandName || floor.selectedBrand?.name || name;
      const mTagline = b.tagline || floor.selectedBrand?.tagline || '';
      const fontInfo = ft?.headingFont ? `${ft.headingFont}${ft.bodyFont && ft.bodyFont !== ft.headingFont ? ' / ' + ft.bodyFont : ''}` : null;
      showModal(`
        <div class="modal-handle"></div>
        <div style="display:flex;height:5px;margin:-0px -0px 20px;border-radius:6px 6px 0 0;overflow:hidden">
          ${paletteSwatches.map(s => `<div style="flex:1;background:${s.hex}"></div>`).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">
          <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,${mc1},${mc2});display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">${b.emoji}</div>
          <div>
            <div style="font-size:18px;font-weight:800;font-family:var(--brand-font,inherit)">${mName}</div>
            <div style="font-size:12px;color:var(--text-3);font-style:italic;margin-top:2px">"${mTagline}"</div>
          </div>
        </div>
        <div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--text-3);margin-bottom:8px">COLORS</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
          ${paletteSwatches.slice(0, 8).map(s => `
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px" title="${s.name}">
            <div style="width:36px;height:36px;border-radius:8px;background:${s.hex};border:1px solid rgba(255,255,255,0.15)"></div>
            <span style="font-size:10px;color:var(--text-3);font-family:monospace">${s.hex}</span>
          </div>`).join('')}
        </div>
        ${fontInfo ? `
        <div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--text-3);margin-bottom:6px">TYPOGRAPHY</div>
        <div style="font-size:13px;color:var(--text-2);margin-bottom:16px;font-family:var(--brand-font,inherit)">${fontInfo}</div>` : ''}
        ${b.concept ? `
        <div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--text-3);margin-bottom:6px">CONCEPT</div>
        <div style="font-size:13px;color:var(--text-2);margin-bottom:16px">${b.concept}</div>` : ''}
        ${b.voiceAttrs?.length ? `
        <div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--text-3);margin-bottom:6px">VOICE</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
          ${b.voiceAttrs.slice(0,4).map(a => `<span style="background:rgba(255,255,255,0.07);border-radius:20px;padding:4px 10px;font-size:12px;color:var(--text-2)">${a}</span>`).join('')}
        </div>` : ''}
        <button class="btn btn-glass" onclick="closeModal()" style="width:100%">Close</button>
      `);
    } else if (hasBrands) {
      // No brand selected yet — show direction picker
      showModal(`
        <div class="modal-handle"></div>
        <div style="font-size:13px;font-weight:700;letter-spacing:1px;color:var(--text-3);text-transform:uppercase;margin-bottom:6px">Brand Direction</div>
        <div style="font-size:13px;color:var(--text-2);margin-bottom:20px">Review the Foundation Sprint to pick your brand direction.</div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px">
          ${realBrands.map((b, i) => {
            const selected = savedBrand === i;
            return `<div style="display:flex;align-items:center;gap:14px;border-radius:14px;padding:14px 16px;
                background:${selected ? `linear-gradient(135deg,${b.colors[0]}cc,${b.colors[1]}55)` : 'rgba(255,255,255,0.04)'};
                border:2px solid ${selected ? b.colors[1] : 'transparent'}">
              <div style="font-size:28px;flex-shrink:0">${b.emoji}</div>
              <div style="flex:1">
                <div style="font-size:14px;font-weight:700;margin-bottom:3px">${b.brandName}</div>
                <div style="display:flex;gap:5px;margin-bottom:4px">
                  ${b.colors.map(c => `<div style="width:12px;height:12px;border-radius:50%;background:${c};border:1px solid rgba(255,255,255,0.2)"></div>`).join('')}
                </div>
                <div style="font-size:11px;color:var(--text-3);font-style:italic">"${b.tagline}"</div>
              </div>
              ${selected ? `<div style="font-size:18px">✅</div>` : ''}
            </div>`;
          }).join('')}
        </div>
        <button class="btn btn-primary" onclick="closeModal(); router.go('gate1', {id:'${floorId}'})" style="width:100%;margin-bottom:8px">Go to Foundation Review →</button>
        <button class="btn btn-glass" onclick="closeModal()" style="width:100%">Close</button>
      `);
    } else {
      showModal(`
        <div class="modal-handle"></div>
        <div style="font-size:13px;font-weight:700;letter-spacing:1px;color:var(--text-3);text-transform:uppercase;margin-bottom:16px">Brand Direction</div>
        <div style="padding:24px;text-align:center;color:var(--text-3)">
          <div style="font-size:36px;margin-bottom:12px">🔨</div>
          <div style="font-size:14px">Brand Agent is still building your brand directions.</div>
          <div style="font-size:12px;margin-top:8px">Check back soon — you'll get a notification when it's ready to review.</div>
        </div>
        <button class="btn btn-glass" onclick="closeModal()" style="width:100%">Close</button>
      `);
    }
  } else if (type === 'Homepage') {
    showModal(`
      <div class="modal-handle"></div>
      <div style="font-size:13px;font-weight:700;letter-spacing:1px;color:var(--text-3);text-transform:uppercase;margin-bottom:20px">Homepage Preview</div>
      <div style="background:rgba(255,255,255,0.04);border-radius:12px;overflow:hidden;margin-bottom:20px">
        <div style="background:${color};padding:24px 20px;text-align:center">
          <div style="font-size:18px;font-weight:700;letter-spacing:2px;text-transform:uppercase">${name}</div>
          <div style="font-size:12px;opacity:0.8;margin-top:4px">${floor.description || 'Building something great'}</div>
          <div style="display:inline-block;margin-top:14px;background:white;color:#000;font-size:12px;font-weight:700;padding:8px 20px;border-radius:20px">Shop Now</div>
        </div>
        <div style="padding:16px">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            ${['👕','🧢','🎒'].map(e => `<div style="background:rgba(255,255,255,0.06);border-radius:8px;padding:14px;text-align:center;font-size:22px">${e}</div>`).join('')}
          </div>
          <div style="height:8px;background:rgba(255,255,255,0.05);border-radius:4px;margin-top:10px"></div>
          <div style="height:8px;background:rgba(255,255,255,0.05);border-radius:4px;margin-top:6px;width:60%"></div>
        </div>
      </div>
      <div style="font-size:13px;color:var(--text-2);line-height:1.6;margin-bottom:24px">Homepage is being built by the Web Agent. Live URL and full preview available once the Website phase completes.</div>
      <button class="btn btn-glass" onclick="closeModal()" style="width:100%">Close</button>
    `);
  } else if (type === 'Products') {
    const products = [
      { icon:'👕', name:`${name} Classic Tee`, price:'$34', status:'In development' },
      { icon:'🧢', name:`${name} Snapback`, price:'$28', status:'In development' },
      { icon:'🎒', name:`${name} Tote Bag`, price:'$22', status:'In development' },
    ];
    showModal(`
      <div class="modal-handle"></div>
      <div style="font-size:13px;font-weight:700;letter-spacing:1px;color:var(--text-3);text-transform:uppercase;margin-bottom:20px">Product Catalog</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">
        ${products.map(p => `
          <div style="display:flex;align-items:center;gap:14px;background:rgba(255,255,255,0.04);border-radius:12px;padding:14px">
            <div style="width:48px;height:48px;border-radius:10px;background:${color};display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">${p.icon}</div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:600">${p.name}</div>
              <div style="font-size:12px;color:var(--text-3);margin-top:2px">${p.status}</div>
            </div>
            <div style="font-size:15px;font-weight:700;color:${color}">${p.price}</div>
          </div>`).join('')}
      </div>
      <div style="font-size:13px;color:var(--text-2);line-height:1.6;margin-bottom:24px">Products are being configured with Printful by the Commerce Agent. Live listings available once the Products phase completes.</div>
      <button class="btn btn-glass" onclick="closeModal()" style="width:100%">Close</button>
    `);
  }
}

// ── Task Deliverable Viewer ──────────────────────────────────────────────
async function showTaskDeliverable(taskId) {
  try {
    const data = await api('GET', `/api/tasks/${taskId}/deliverable`);
    const meta = AGENT_META[data.assignedAgent] || { icon: '🤖', name: data.assignedAgent };
    const DELIVERABLE_LABELS = {
      'brand-options': 'Brand Identity', 'business-strategy': 'Strategy', 'budget-plan': 'Budget Plan',
      'brand-visual-system': 'Visual System', 'logo-generation': 'Logo', 'brand-voice-guide': 'Voice Guide', 'product-catalog': 'Product Catalog',
      'content-calendar': 'Content Calendar', 'email-welcome-sequence': 'Email Sequence', 'promo-video-script': 'Promo Video Script',
      'staging-review': 'Staging Review', 'copy-review': 'Copy Review', 'analytics-setup': 'Analytics Setup',
      'launch-ad-campaign': 'Ad Campaign', 'ad-creative-production': 'Ad Creatives', 'conversion-tracking': 'Conversion Tracking',
      'performance-review': 'Performance Review', 'content-refresh': 'Content Refresh', 'ad-optimization': 'Ad Optimization',
      'growth-report': 'Growth Report', 'strategy-revision': 'Strategy Update',
    };
    const deliverableName = DELIVERABLE_LABELS[data.taskType] || data.taskType.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const isDone = data.status === 'completed';
    const isFailed = data.status === 'failed' || data.status === 'escalated';
    const statusColor = isDone ? '#22c55e' : isFailed ? '#ef4444' : '#f59e0b';
    const statusLabel = isDone ? 'Completed' : isFailed ? 'Needs Retry' : data.status;
    const statusIcon = isDone ? '✅' : isFailed ? '❌' : '⏳';

    // Format the raw output into readable sections
    function formatDeliverableContent(raw) {
      if (!raw) return '';
      let html = escapeHtml(raw);
      // Bold markdown headers: # HEADER or **bold**
      html = html.replace(/^#\s+(.+)$/gm, '<div style="font-size:15px;font-weight:700;color:var(--text-1);margin:20px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">$1</div>');
      html = html.replace(/^##\s+(.+)$/gm, '<div style="font-size:14px;font-weight:700;color:var(--text-1);margin:16px 0 6px">$1</div>');
      html = html.replace(/^###\s+(.+)$/gm, '<div style="font-size:13px;font-weight:600;color:var(--text-2);margin:12px 0 4px">$1</div>');
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:var(--text-1)">$1</strong>');
      // List items
      html = html.replace(/^[-•]\s+(.+)$/gm, '<div style="padding-left:16px;position:relative;margin:3px 0"><span style="position:absolute;left:4px;color:var(--indigo)">•</span>$1</div>');
      // Numbered items
      html = html.replace(/^(\d+)\.\s+(.+)$/gm, '<div style="padding-left:20px;position:relative;margin:3px 0"><span style="position:absolute;left:0;color:var(--indigo);font-weight:600;font-size:12px">$1.</span>$2</div>');
      return html;
    }

    // Build metadata chips
    const chips = [];
    if (data.phaseNumber) chips.push({ label: `Phase ${data.phaseNumber}`, color: 'var(--indigo)' });
    if (data.attempts > 1) chips.push({ label: `${data.attempts} attempts`, color: 'var(--gold)' });
    if (data.council) chips.push({ label: `Council · ${data.council.proposalCount} agents`, color: '#a78bfa' });
    if (data.completedAt) {
      const elapsed = Date.now() - new Date(data.completedAt).getTime();
      const ago = elapsed < 3600000 ? `${Math.round(elapsed/60000)}m ago` : elapsed < 86400000 ? `${Math.round(elapsed/3600000)}h ago` : `${Math.round(elapsed/86400000)}d ago`;
      chips.push({ label: ago, color: 'var(--text-3)' });
    }

    // Output files section
    const filesHtml = data.outputFiles && data.outputFiles.length > 0 ? `
      <div style="margin-top:14px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-3);margin-bottom:8px;font-weight:600">Output Files</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${data.outputFiles.map(f => `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid var(--border)"><span style="font-size:14px">📎</span><span style="font-size:12px;color:var(--text-2)">${escapeHtml(typeof f === 'string' ? f : f.name || f.path || 'file')}</span></div>`).join('')}
        </div>
      </div>
    ` : '';

    // Council info section
    const councilHtml = data.council ? `
      <div style="margin-top:14px;padding:14px 16px;border-radius:var(--radius-sm);border:1px solid rgba(124,58,237,0.2);background:rgba(124,58,237,0.04)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="font-size:14px">🏛️</span>
          <span style="font-size:11px;font-weight:700;color:#a78bfa;letter-spacing:0.5px">COUNCIL DECISION</span>
          <span style="font-size:11px;color:var(--text-3);margin-left:auto">${fmtMoney(data.council.totalCostCents)}</span>
        </div>
        <div style="font-size:12px;color:var(--text-2);line-height:1.6;margin-bottom:12px;padding:10px 12px;background:rgba(255,255,255,0.02);border-radius:8px;border:1px solid var(--border)">${escapeHtml(data.council.rationale)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${data.council.proposals.map(p => `
            <button class="btn btn-glass btn-sm" style="font-size:11px;padding:4px 10px;${p.isWinner ? 'border-color:rgba(34,197,94,0.4);color:#22c55e;background:rgba(34,197,94,0.06)' : ''}"
              onclick="showCouncilProposal('${safeId(taskId)}', ${p.index})">
              ${p.isWinner ? '👑' : '📄'} ${p.index + 1}${p.isWinner ? ' Winner' : ''}${!p.success ? ' ✗' : ''}
            </button>
          `).join('')}
        </div>
      </div>
    ` : '';

    // Main content
    const contentHtml = data.result
      ? `<div class="deliverable-content">${formatDeliverableContent(data.result)}</div>`
      : `<div style="padding:32px;text-align:center;color:var(--text-3);font-size:13px">No output available yet.</div>`;

    showModal(`
      <div class="modal-handle"></div>

      <!-- Hero header -->
      <div class="deliverable-hero">
        <div class="deliverable-hero-icon">${meta.icon}</div>
        <div class="deliverable-hero-title">${deliverableName}</div>
        <div class="deliverable-hero-status" style="color:${statusColor}">${statusIcon} ${statusLabel}</div>
      </div>

      <!-- Metadata bar -->
      <div class="deliverable-meta-bar">
        <div class="deliverable-meta-agent">
          <span style="font-size:13px">${meta.icon}</span>
          <span>${meta.name}</span>
        </div>
        <div class="deliverable-meta-chips">
          ${chips.map(c => `<span class="deliverable-chip" style="border-color:${c.color}33;color:${c.color}">${c.label}</span>`).join('')}
        </div>
      </div>

      <!-- Output content -->
      ${contentHtml}

      <!-- Output files -->
      ${filesHtml}

      <!-- Council -->
      ${councilHtml}

      <!-- Actions -->
      <div class="deliverable-actions">
        ${isFailed ? `<button class="btn btn-primary btn-sm" onclick="retryTask('${safeId(taskId)}')">🔄 Retry Task</button>` : ''}
        <button class="btn btn-glass" onclick="closeModal()" style="flex:1">Close</button>
      </div>
    `);
  } catch (err) {
    toast('Failed to load deliverable', 'error');
  }
}

// ── Council Proposal Viewer ─────────────────────────────────────────────
async function showCouncilProposal(taskId, proposalIndex) {
  try {
    const data = await api('GET', `/api/tasks/${taskId}/council/${proposalIndex}`);
    showModal(`
      <div class="modal-handle"></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <span style="font-size:20px">${data.isWinner ? '✅' : '📄'}</span>
        <div style="flex:1">
          <div style="font-size:15px;font-weight:700">Proposal ${proposalIndex + 1}${data.isWinner ? ' — Winner' : ''}</div>
          <div style="font-size:11px;color:var(--text-3)">Cost: ${fmtMoney(data.costCents)}</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:12px;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:var(--radius-sm);border:1px solid var(--border);font-style:italic">${escapeHtml(data.persona)}</div>
      <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;font-size:13px;line-height:1.7;color:var(--text-2);max-height:55vh;overflow-y:auto;white-space:pre-wrap;word-break:break-word">${data.content ? escapeHtml(data.content) : '<span style="color:var(--text-3)">Agent failed to produce output.</span>'}</div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-glass" onclick="showTaskDeliverable('${safeId(taskId)}')" style="flex:1">Back to Deliverable</button>
        <button class="btn btn-glass" onclick="closeModal()">Close</button>
      </div>
    `);
  } catch (err) {
    toast('Failed to load proposal', 'error');
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeId(id) {
  return id ? id.replace(/[^a-zA-Z0-9\-_]/g, '') : '';
}

async function retryTask(taskId) {
  try {
    await api('POST', `/api/tasks/${taskId}/retry`);
    toast('Task re-queued! Agents will retry shortly.', 'success');
    closeModal();
    await loadState();
    render();
  } catch (err) {
    toast('Retry failed: ' + (err.message || 'Unknown error'), 'error');
  }
}

// ── Floor helpers ────────────────────────────────────────────────────────
function getFloorStatus(floor) {
  const s = floor.status || 'new';
  if (s === 'live')    return { label: '🟢 Live',    cls: 'badge-live' };
  if (s === 'building')return { label: '🔨 Building', cls: 'badge-build' };
  if (s === 'paused')  return { label: '⏸ Paused',   cls: 'badge-paused' };
  if (state.approvals.some(a => a.floorId === floor.id && a.status === 'pending'))
                       return { label: '🔴 Review',   cls: 'badge-review' };
  return               { label: '⚙️ Setting up', cls: 'badge-new' };
}

function getFloorProgress(floor) {
  const uiPhase = floor.currentPhase || 1;              // gate-based UI counter
  const completedGates = Math.max(0, uiPhase - 1);      // gates fully passed
  const tasks = state.floorTasks?.[floor.id] || [];
  const totalGates = 9;

  if (tasks.length > 0) {
    // Find the backend phase number that is currently active
    const activeBackendPhase =
      tasks.find(t => t.status === 'working')?.phaseNumber ||
      tasks.find(t => t.status === 'queued')?.phaseNumber ||
      tasks[tasks.length - 1]?.phaseNumber;

    if (activeBackendPhase) {
      const phaseTasks    = tasks.filter(t => t.phaseNumber === activeBackendPhase);
      const phaseCompleted = phaseTasks.filter(t => t.status === 'completed').length;
      const withinPhase   = phaseTasks.length > 0 ? phaseCompleted / phaseTasks.length : 0;
      return Math.min(100, Math.round(((completedGates + withinPhase) / totalGates) * 100));
    }
  }

  return Math.min(100, Math.round((completedGates / totalGates) * 100));
}

function floorBrandColor(floor) {
  // Prefer backend theme primary color
  const theme = state.floorThemes?.[floor.id]?.theme;
  if (theme?.primaryColor) return theme.primaryColor;
  // Use brand state colors if available
  if (floor.brandState) {
    try {
      const b = JSON.parse(floor.brandState);
      return b.primaryColor || '#6366f1';
    } catch {}
  }
  // Use selected brand color
  const sb = state.gate1BrandData?.[floor.id];
  if (sb?.length) {
    const idx = getLocalBrand(floor.id) ?? 0;
    if (sb[idx]?.colors?.[0]) return sb[idx].colors[0];
  }
  const palette = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ec4899'];
  const idx = floor.name ? floor.name.charCodeAt(0) % palette.length : 0;
  return palette[idx];
}

// ── Display name: selected brand wins after Pick This, then owner-set name ──
function floorDisplayName(floor) {
  if (!floor) return 'Your Business';
  // If user has picked a brand direction, use that brand's name as the business name
  const localIdx = getLocalBrand(floor.id);
  if (localIdx !== null) {
    const brand = state.gate1BrandData?.[floor.id]?.[localIdx];
    if (brand?.brandName) return brand.brandName;
  }
  // Backend-confirmed brand name
  if (floor.selectedBrand?.name) return floor.selectedBrand.name;
  // Fall back to floor name
  return floor.name || 'Your Business';
}

// ── Floor not found fallback ─────────────────────────────────────────────
function viewFloorNotFound(id) {
  return `
  ${renderTopNav({ back: true, backLabel: 'Tower', title: 'FLOOR NOT FOUND', backOnclick: "router.go('tower')" })}
  <div class="view-narrow">
    <div class="empty-state">
      <div class="empty-icon">🔍</div>
      <div class="empty-title">Floor not found</div>
      <div class="empty-sub">This floor may still be loading or no longer exists.${id ? '<br><span style="font-size:11px;color:var(--text-3);font-family:monospace">' + id + '</span>' : ''}</div>
    </div>
    <button class="btn btn-primary btn-full" onclick="loadState().then(() => render())">Retry</button>
    <button class="btn btn-glass btn-full" style="margin-top:8px" onclick="router.go('tower')">← Back to Tower</button>
  </div>`;
}

// ── Views ────────────────────────────────────────────────────────────────

function renderTopNav(opts = {}) {
  const pendingCount = state.approvals.filter(a => a.status === 'pending').length;
  const hasPending = pendingCount > 0;

  if (opts.back) {
    const backOnclick = opts.backOnclick || 'router.back()';
    const notifHtml = `
      <div style="position:relative;display:inline-flex">
        <button class="icon-btn" title="Notifications${hasPending ? ` (${pendingCount} pending)` : ''}" onclick="router.go('notifications')">🔔</button>
        ${hasPending ? `<div class="notif-badge" style="position:absolute;top:6px;right:6px"></div>` : ''}
      </div>`;
    return `
    <nav class="topnav">
      <button class="back-btn" onclick="${backOnclick}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M10 12L6 8l4-4"/>
        </svg>
        ${opts.backLabel || 'Back'}
      </button>
      <span style="font-size:14px;font-weight:600;color:var(--text-2);letter-spacing:0.3px">${opts.title || ''}</span>
      ${notifHtml}
    </nav>`;
  }

  // Tower-level nav: show notification bell with badge
  const towerPendingCount = state.approvals.filter(a => a.status === 'pending').length;
  const towerHasPending = towerPendingCount > 0;
  return `
  <nav class="topnav">
    <a class="topnav-logo" onclick="router.go('tower')" href="javascript:void(0)">
      <span class="star">✦</span>
      <span>EVE</span>
    </a>
    <div class="relative" style="position:relative">
      <button class="icon-btn" title="Notifications${towerHasPending ? ` (${towerPendingCount} pending)` : ''}" onclick="router.go('notifications')">🔔</button>
      ${towerHasPending ? `<div class="notif-badge" style="position:absolute;top:6px;right:6px"></div>` : ''}
    </div>
  </nav>`;
}

// ─── Tower ───────────────────────────────────────────────────────────────
function viewTower() {
  // Sort: live first, then by progress (most advanced phase first), then by creation order
  const allFloors = [...state.floors].sort((a, b) => {
    if (a.status === 'live' && b.status !== 'live') return -1;
    if (b.status === 'live' && a.status !== 'live') return 1;
    return (b.currentPhase || 1) - (a.currentPhase || 1);
  });

  const totalRevenue = allFloors.reduce((s, f) => s + (f.todayRevenueCents || 0), 0);
  const totalOrders  = allFloors.reduce((s, f) => s + (f.todayOrders || 0), 0);
  const totalAdSpend = allFloors.reduce((s, f) => s + (f.todayAdSpendCents || 0), 0);
  const totalProfit  = allFloors.reduce((s, f) => s + (f.todayProfitCents || 0), 0);

  const pendingApprovals = state.approvals.filter(a => a.status === 'pending');

  const floorCards = allFloors.map(floor => {
    const { label, cls } = getFloorStatus(floor);
    const pct   = getFloorProgress(floor);
    const color = floorBrandColor(floor);
    const isLive = floor.status === 'live';

    return `
    <div class="floor-card glass" style="--card-accent:linear-gradient(90deg,${color},${color}88)" onclick="router.go('floor', {id:'${floor.id}'})">
      <div class="floor-card-brand-glow" style="background:radial-gradient(ellipse at 30% 10%, ${color}55, ${color}11 50%, transparent 75%)"></div>
      <div class="floor-card-top">
        <div class="floor-name">${floorDisplayName(floor)}</div>
        <span class="floor-status-badge ${cls}">${label}</span>
      </div>
      <div class="floor-card-bottom">
        ${isLive ? `
          <div class="floor-revenue">${fmtMoney(floor.todayRevenueCents)} today</div>
          <div class="floor-detail">${floor.todayOrders || 0} orders · ${floor.goal || ''}</div>
        ` : `
          <div class="floor-detail" style="color:var(--text-2);font-size:14px">${floor.goal || ''}</div>
          ${pct > 0 ? `
          <div class="floor-progress" style="margin-top:14px">
            <div class="floor-progress-bar" style="width:${pct}%"></div>
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:6px">${pct}% complete</div>` : ''}
        `}
      </div>
    </div>`;
  }).join('');

  const pendingFeedback = state.feedback.filter(fb => fb.eveDecision === 'needs-approval' && fb.status === 'analyzed');

  const approvalItems = pendingApprovals.map(a => {
    let reviewDest;
    if (a.type === 'gate') {
      // Map backend phaseNumber to gate view — must be explicit, no silent fallback
      const GATE_PHASE_MAP = { 3: 'gate1', 5: 'content-production', 6: 'gate2', 8: 'gate3' };
      const gateView = GATE_PHASE_MAP[a.phaseNumber];
      if (!gateView) {
        console.warn(
          `[attention-cta] Unrecognised gate phaseNumber "${a.phaseNumber}" for approval "${a.id}" — ` +
          `routing to floor detail instead of a gate view. Add phaseNumber to GATE_PHASE_MAP.`
        );
      }
      const floor = state.floors.find(f => f.id === a.floorId);
      reviewDest = floor
        ? (gateView
            ? `router.go('${gateView}', {id:'${floor.id}'})`
            : `router.go('floor', {id:'${floor.id}'})`)   // safe floor fallback, never 'improvements'
        : `router.go('tower')`;
    } else {
      // Non-gate approvals (task reviews, feedback) — route to floor detail
      reviewDest = `router.go('floor', {id:'${a.floorId}'})`;
    }
    const label = a.type === 'gate'
      ? `Review ${a.phaseName || 'Foundation'} for ${floorDisplayName(state.floors.find(f=>f.id===a.floorId)) || 'floor'}`
      : (a.title || 'Approval needed');
    return `
    <div class="attention-item">
      <span class="attention-text"><span class="attention-dot">🔴</span>${label}</span>
      <button class="attention-cta" onclick="${reviewDest}">Review →</button>
    </div>`;
  }).join('');

  const feedbackItems = pendingFeedback.map(fb => {
    const floorName = floorDisplayName(state.floors.find(f => f.id === fb.floorId)) || 'Floor';
    // Route to floor detail so the owner sees the feedback in context,
    // NOT to 'improvements' which previously caused the wrong-view bug when
    // approvals hadn't fully loaded and this block rendered instead.
    const fbFloor = state.floors.find(f => f.id === fb.floorId);
    const fbDest = fbFloor
      ? `router.go('floor', {id:'${fbFloor.id}'})`
      : `router.go('improvements')`;
    return `
    <div class="attention-item">
      <span class="attention-text"><span class="attention-dot" style="color:#6366f1">🟣</span>Agent feedback: ${fb.eveAnalysis?.split('\\n')[0]?.slice(0, 60) || fb.message.slice(0, 60)} (${floorName})</span>
      <button class="attention-cta" onclick="${fbDest}">Review →</button>
    </div>`;
  }).join('');

  const hasAttention = pendingApprovals.length > 0 || pendingFeedback.length > 0;
  const attentionHtml = hasAttention ? (approvalItems + feedbackItems) :
    `<div style="display:flex;align-items:center;gap:12px;padding:4px 0">
       <div style="width:32px;height:32px;border-radius:50%;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">✓</div>
       <div>
         <div style="font-size:14px;color:var(--text-1);font-weight:500">Everything is running smoothly</div>
         <div style="font-size:12px;color:var(--text-3);margin-top:2px">Agents are working autonomously. You'll be notified when a decision is needed.</div>
       </div>
     </div>`;

  const activityHtml = state.activity.slice(0, 6).map(a => {
    // Replace internal floor name with confirmed brand name in activity text
    let actText = a.text;
    const actFloor = state.floors.find(f => f.id === a.floor);
    if (actFloor && actFloor.name && floorDisplayName(actFloor) !== actFloor.name) {
      actText = actText.replace(actFloor.name, floorDisplayName(actFloor));
    }
    return `
    <div class="activity-item">
      <div class="activity-icon">${a.icon}</div>
      <div class="activity-body">
        <div class="activity-text">${actText}</div>
        <div class="activity-time">${formatTime(a.time)}</div>
      </div>
    </div>`;
  }).join('');

  const towerAlertBanner = pendingApprovals.length > 0 ? `
  <div id="approval-alert-banner" style="
    display:flex; align-items:center; justify-content:space-between;
    gap:12px; padding:12px 20px;
    background:linear-gradient(135deg,rgba(239,68,68,0.18),rgba(245,158,11,0.12));
    border-bottom:1px solid rgba(239,68,68,0.35);
    position:sticky; top:57px; z-index:90;
    backdrop-filter:blur(16px);
  ">
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:18px;animation:attention-pulse 2s ease-in-out infinite">🔴</span>
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--text-1)">${pendingApprovals.length} approval${pendingApprovals.length > 1 ? 's' : ''} waiting for your decision</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:1px">EVE has paused and is waiting on you to continue building.</div>
      </div>
    </div>
    <button class="btn btn-primary btn-sm" style="flex-shrink:0;white-space:nowrap" onclick="router.go('notifications')">
      Review Now →
    </button>
  </div>` : '';

  return `
  ${renderTopNav()}
  ${towerAlertBanner}
  <div class="view">
    <div class="section">
      <div class="section-header">
        <span class="section-label">The Tower</span>
      </div>
      <div class="floor-grid">
        ${floorCards}
        <div class="new-floor-card" onclick="router.go('new-idea')">
          <div class="new-floor-icon">+</div>
          <div class="new-floor-label">New Floor</div>
          <div class="new-floor-sub">Tap to start a new idea</div>
        </div>
      </div>
    </div>

    ${allFloors.length > 0 ? `
    <div class="section">
      <div class="section-header"><span class="section-label">Today — All Floors</span></div>
      <div class="stat-strip">
        <div class="glass stat-card">
          <div class="stat-label">Revenue</div>
          <div class="stat-value">${fmtMoney(totalRevenue)}</div>
          ${totalRevenue > 0 ? '<div class="stat-delta up">▲ 15%</div>' : '<div class="stat-delta" style="color:var(--text-3)">Building</div>'}
        </div>
        <div class="glass stat-card">
          <div class="stat-label">Orders</div>
          <div class="stat-value">${totalOrders || '—'}</div>
          ${totalOrders > 0 ? '<div class="stat-delta up">▲ 8%</div>' : '<div class="stat-delta" style="color:var(--text-3)">Building</div>'}
        </div>
        <div class="glass stat-card">
          <div class="stat-label">Ad Spend</div>
          <div class="stat-value">${totalAdSpend > 0 ? fmtMoney(totalAdSpend) : '—'}</div>
          ${totalAdSpend > 0 ? '<div class="stat-delta down">▼ 3%</div>' : '<div class="stat-delta" style="color:var(--text-3)">Building</div>'}
        </div>
        <div class="glass stat-card">
          <div class="stat-label">Profit</div>
          <div class="stat-value">${totalProfit > 0 ? fmtMoney(totalProfit) : '—'}</div>
          ${totalProfit > 0 ? '<div class="stat-delta up">▲ 22%</div>' : '<div class="stat-delta" style="color:var(--text-3)">Building</div>'}
        </div>
      </div>
    </div>` : ''}

    <div class="section">
      <div class="section-header"><span class="section-label">Needs Attention</span></div>
      <div class="glass" style="padding:16px 18px">${attentionHtml}</div>
    </div>

    ${state.feedback.length > 0 || state.systemLearnings.length > 0 ? `
    <div class="section">
      <div class="section-header">
        <span class="section-label">EVE Intelligence</span>
        <button class="section-action" onclick="router.go('improvements')">View all →</button>
      </div>
      <div class="glass" style="padding:14px 16px">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="font-size:24px">🧠</div>
          <div style="flex:1">
            <div style="font-size:13px;color:var(--text-1);font-weight:600">${state.systemLearnings.length} system learnings · ${state.feedback.filter(fb => fb.status === 'applied').length} auto-applied</div>
            <div style="font-size:12px;color:var(--text-3)">EVE continuously improves from agent feedback</div>
          </div>
        </div>
      </div>
    </div>` : ''}

    <div class="section">
      <div class="section-header">
        <span class="section-label">Activity Feed</span>
        <button class="section-action" onclick="router.go('activity')">See all</button>
      </div>
      <div class="glass" style="padding:4px 16px">${activityHtml}</div>
    </div>
  </div>`;
}

// ─── New Idea — Step 1 ────────────────────────────────────────────────────
function viewNewIdea() {
  const step = state.idea.step;
  if (step === 1) return viewNewIdeaStep1();
  if (step === 2) return viewNewIdeaStep2();
  if (step === 3) return viewEvaluation();
  return viewNewIdeaStep1();
}

function viewNewIdeaStep1() {
  return `
  ${renderTopNav({ back: true, backLabel: 'Tower', title: 'NEW BUSINESS' })}
  <div class="view-narrow">
    <div class="stepper">
      <div class="step-dot active">1</div>
      <div class="step-line"></div>
      <div class="step-dot">2</div>
      <div class="step-line"></div>
      <div class="step-dot">3</div>
    </div>

    <div class="page-header">
      <div>
        <div class="page-title">What's your business idea?</div>
        <div class="page-subtitle">Describe it in your own words. EVE will ask follow-up questions.</div>
      </div>
    </div>

    <div class="glass" style="padding:28px">
      <div class="field">
        <textarea
          id="idea-input"
          class="textarea"
          placeholder="e.g. A subscription box for remote workers, a skincare brand for athletes, an online tutoring service..."
          style="min-height:140px"
          oninput="state.idea.description = this.value"
        >${state.idea.description}</textarea>
      </div>

      <div style="margin-bottom:20px">
        <div class="section-label" style="margin-bottom:12px">Or pick a category to get started</div>
        <div class="option-cards" style="grid-template-columns:repeat(3,1fr)">
          <div class="option-card" onclick="quickFill('E-commerce store selling physical products')">
            <div class="option-card-icon">🛍️</div>
            <div class="option-card-label">E-commerce</div>
          </div>
          <div class="option-card" onclick="quickFill('Online service or consulting business')">
            <div class="option-card-icon">💼</div>
            <div class="option-card-label">Service</div>
          </div>
          <div class="option-card" onclick="quickFill('Content brand with digital products')">
            <div class="option-card-icon">🎯</div>
            <div class="option-card-label">Content</div>
          </div>
        </div>
      </div>

      <button class="btn btn-primary btn-lg btn-full" onclick="goToStep2()">
        Continue →
      </button>
    </div>
  </div>`;
}

function quickFill(text) {
  state.idea.description = text;
  document.getElementById('idea-input').value = text;
}

async function goToStep2() {
  const desc = document.getElementById('idea-input')?.value || state.idea.description;
  if (!desc.trim()) { toast('Please describe your idea first', 'error'); return; }
  state.idea.description = desc;
  state.idea.step = 2;
  state.idea.questions = null; // triggers loading spinner
  state.idea.answers = {};
  render();

  // Fetch dynamic questions from AI
  const result = await api('POST', '/api/evaluate/questions', { idea: desc });
  if (result?.questions) {
    state.idea.questions = result.questions;
  } else {
    // Fallback if API fails
    state.idea.questions = [
      { id: 'customer', label: 'WHO IS YOUR TARGET CUSTOMER?', type: 'cards', options: [
        { v: 'gen-z', icon: '📱', label: 'Gen Z', sub: '18–26' },
        { v: 'millennial', icon: '💼', label: 'Millennials', sub: '27–42' },
        { v: 'broad', icon: '👥', label: 'Broad audience', sub: '25–55' },
      ]},
      { id: 'budget', label: "WHAT'S YOUR MONTHLY BUDGET?", type: 'cards', options: [
        { v: 'lean', icon: '💰', label: 'Lean', sub: '~$200/mo' },
        { v: 'mid', icon: '💰💰', label: 'Mid', sub: '~$500/mo' },
        { v: 'full', icon: '💰💰💰', label: 'Full Go', sub: '$1,000+/mo' },
      ]},
      { id: 'differentiator', label: 'WHAT MAKES YOU DIFFERENT?', type: 'text', placeholder: 'What unique angle does your business have?' },
    ];
  }
  render();
}

// ─── New Idea — Step 2 ───────────────────────────────────────────────────
function viewNewIdeaStep2() {
  const qs = state.idea.questions;

  // Still loading questions from AI
  if (!qs) {
    return `
    ${renderTopNav({ back: true, backLabel: 'Back', title: 'NEW BUSINESS' })}
    <div class="view-narrow">
      <div class="stepper">
        <div class="step-dot done">✓</div>
        <div class="step-line done"></div>
        <div class="step-dot active">2</div>
        <div class="step-line"></div>
        <div class="step-dot">3</div>
      </div>
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Generating tailored questions…</p>
      </div>
    </div>`;
  }

  const renderQuestion = (q) => {
    if (q.type === 'cards') {
      const sel = state.idea.answers[q.id] || '';
      return `
      <div class="field">
        <label class="field-label">${q.label}</label>
        <div class="option-cards">
          ${(q.options || []).map(o => `
            <div class="option-card ${sel === o.v ? 'selected' : ''}" onclick="selectAnswer('${q.id}','${o.v}')">
              <div class="option-card-icon">${o.icon}</div>
              <div class="option-card-label">${o.label}</div>
              <div class="option-card-sub">${o.sub || ''}</div>
            </div>`).join('')}
        </div>
      </div>`;
    }
    if (q.type === 'text') {
      return `
      <div class="field">
        <label class="field-label">${q.label}</label>
        <input class="input" placeholder="${q.placeholder || ''}"
               value="${(state.idea.answers[q.id] || '').replace(/"/g, '&quot;')}"
               oninput="state.idea.answers['${q.id}']=this.value">
      </div>`;
    }
    return '';
  };

  return `
  ${renderTopNav({ back: true, backLabel: 'Back', title: 'NEW BUSINESS' })}
  <div class="view-narrow">
    <div class="stepper">
      <div class="step-dot done">✓</div>
      <div class="step-line done"></div>
      <div class="step-dot active">2</div>
      <div class="step-line"></div>
      <div class="step-dot">3</div>
    </div>

    <div class="page-header">
      <div>
        <div class="page-title">A few quick questions</div>
        <div class="page-subtitle">Tap to select. EVE builds a better plan with more context.</div>
      </div>
    </div>

    <div class="glass" style="padding:28px">
      ${qs.map(q => renderQuestion(q)).join('')}

      <button class="btn btn-primary btn-lg btn-full" onclick="runEvaluation()">
        Evaluate My Idea →
      </button>
    </div>
  </div>`;
}

function selectAnswer(key, val) {
  state.idea.answers[key] = val;
  render();
}

async function runEvaluation() {
  state.idea.step = 3;
  state.idea.evaluation = null; // triggers loading spinner
  render();

  const result = await api('POST', '/api/evaluate', {
    idea: state.idea.description,
    answers: state.idea.answers,
  });

  if (!result || result.error) {
    toast(result?.error || 'Evaluation failed. Please try again.', 'error');
    state.idea.step = 2;
    render();
    return;
  }

  state.idea.evaluation = result;
  render();
}

// ─── Evaluation ───────────────────────────────────────────────────────────
function viewEvaluation() {
  const ev = state.idea.evaluation;

  if (!ev) {
    return `
    ${renderTopNav({ back: true, backLabel: 'Back', title: 'EVALUATION' })}
    <div class="view-narrow">
      <div class="stepper">
        <div class="step-dot done">✓</div>
        <div class="step-line done"></div>
        <div class="step-dot done">✓</div>
        <div class="step-line done"></div>
        <div class="step-dot active">3</div>
      </div>
      <div class="loading-state">
        <div class="spinner"></div>
        <p>CEO Mode is evaluating your idea…</p>
        <p style="font-size:13px;color:var(--text-3);margin-top:8px">Analyzing market, revenue model, and build plan</p>
      </div>
    </div>`;
  }

  const pct = Math.round((ev.score / ev.maxScore) * 100);
  const starsHtml = (n) => '★'.repeat(Math.max(0, n)) + '☆'.repeat(Math.max(0, 5 - n));
  const gradeColor = ev.grade === 'Excellent' ? 'var(--green)' : ev.grade === 'Strong' ? 'var(--indigo)' : ev.grade === 'Good' ? 'var(--amber, #f59e0b)' : 'var(--red, #ef4444)';

  const strategyHtml = ev.strategy ? `
    <div class="glass" style="padding:22px;margin-bottom:16px">
      <div class="section-label" style="margin-bottom:14px">STRATEGY OVERVIEW</div>
      ${[
        ['🎯 Target Audience', ev.strategy.targetAudience],
        ['📣 Channels', ev.strategy.channels],
        ['💲 Pricing', ev.strategy.pricing],
        ['📦 What to Build', ev.strategy.keyProducts],
      ].map(([label, value]) => value ? `
      <div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:4px">${label}</div>
        <div style="font-size:14px;color:var(--text-1);line-height:1.5">${value}</div>
      </div>` : '').join('')}
    </div>` : '';

  return `
  ${renderTopNav({ back: true, backLabel: 'Back', title: 'EVALUATION' })}
  <div class="view-narrow">
    <div class="stepper">
      <div class="step-dot done">✓</div>
      <div class="step-line done"></div>
      <div class="step-dot done">✓</div>
      <div class="step-line done"></div>
      <div class="step-dot active">3</div>
    </div>

    <div class="glass" style="padding:28px;margin-bottom:16px">
      <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px">${ev.name}</div>
      <div style="font-size:14px;color:var(--text-2);margin-top:4px;margin-bottom:20px">${ev.tagline}</div>

      <div class="score-ring-wrap">
        <div class="score-ring" style="background:conic-gradient(var(--indigo) ${pct}%, rgba(255,255,255,0.08) ${pct}%)">
          <div class="score-ring-text">${ev.score}</div>
        </div>
        <div style="font-size:15px;font-weight:700;color:${gradeColor}">${ev.grade}</div>
        <div style="font-size:13px;color:var(--text-3);margin-top:4px">out of ${ev.maxScore}</div>
      </div>

      <div class="divider"></div>

      <div class="section-label" style="margin-bottom:12px">BREAKDOWN</div>
      ${ev.breakdown.map(b => `
      <div class="breakdown-row" style="flex-direction:column;align-items:flex-start;gap:2px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
          <span class="breakdown-label">${b.label}</span>
          <span style="display:flex;align-items:center;gap:8px">
            <span class="breakdown-stars">${starsHtml(b.stars)}</span>
            <span class="breakdown-score">${b.score}</span>
          </span>
        </div>
        ${b.reason ? `<div style="font-size:12px;color:var(--text-3);line-height:1.4;margin-top:2px">${b.reason}</div>` : ''}
      </div>`).join('')}
    </div>

    ${strategyHtml}

    <div class="glass" style="padding:22px;margin-bottom:16px">
      <div class="section-label" style="margin-bottom:14px">BUILD PLAN</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        ${[
          ['Agents', ev.plan?.agents ?? 13],
          ['Timeline', ev.plan?.timeline ?? '~3 weeks'],
          ['Build cost', ev.plan?.buildCost ?? '~$150'],
          ['Monthly ops', ev.plan?.monthly ?? '~$350'],
        ].map(([l, v]) => `
        <div>
          <div style="font-size:11px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-3)">${l}</div>
          <div style="font-size:17px;font-weight:700;margin-top:4px">${v}</div>
        </div>`).join('')}
      </div>
      <div class="divider"></div>
      <div style="font-size:14px;color:var(--text-2);line-height:1.6;font-style:italic">
        "${ev.verdict}"
      </div>
    </div>

    <div class="btn-row">
      <button class="btn btn-glass" onclick="state.idea={step:1,description:'',answers:{},questions:null,evaluation:null};router.history=[];router.go('tower')">❌ Pass</button>
      <button class="btn btn-success btn-lg" onclick="buildIt()">✅ Build It</button>
    </div>
  </div>`;
}

async function buildIt() {
  const ev = state.idea.evaluation;
  toast('Creating your floor…', 'info');

  // Derive budget ceiling from answers — supports keyword tiers AND free-text dollar amounts
  const budgetMap = { lean: 10000, mid: 25000, full: 60000 };
  const budgetRaw = state.idea.answers?.budget || state.idea.answers?.Budget || 'mid';
  let budgetCeilingCents = budgetMap[budgetRaw] ?? null;
  if (!budgetCeilingCents) {
    // Parse dollar amount from free text: "$500", "$1,000", "$5000", etc.
    const dollarMatch = String(budgetRaw).match(/\$\s*([\d,]+)/);
    if (dollarMatch) {
      const dollars = parseInt(dollarMatch[1].replace(/,/g, ''), 10);
      if (dollars > 0) budgetCeilingCents = dollars * 100;
    }
  }
  if (!budgetCeilingCents) budgetCeilingCents = 25000; // fallback to $250

  const floor = await api('POST', '/api/floors', {
    name: ev?.name || 'New Business',
    goal: ev?.tagline || state.idea.description,
    businessType: ev?.businessType || 'ecommerce',
    budgetCeilingCents,
  });

  await loadState();
  state.idea = { step: 1, description: '', answers: {}, questions: null, evaluation: null };
  router.history = []; // clear wizard steps from back stack

  if (floor) {
    toast('Floor created! Building has started.', 'success');
    router.go('floor', { id: floor.id });
  } else {
    toast('Floor created (demo mode)', 'success');
    router.go('tower');
  }
}

// ─── Brand Font Loader ────────────────────────────────────────────────────
// Injects a Google Fonts <link> when backend theme has custom fonts
function loadBrandFonts(floorId) {
  const themeData = state.floorThemes[floorId];
  if (!themeData?.googleFontsUrl) return;
  const linkId = `brand-fonts-${floorId}`;
  if (document.getElementById(linkId)) return;
  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = themeData.googleFontsUrl;
  document.head.appendChild(link);
}

// ─── Brand Theme CSS Injector ─────────────────────────────────────────────
// Returns a <style> block that scopes brand colors/typography to .floor-branded
// Prefers backend themeConfig (real extracted brand system) over gate1 brand data.
function getBrandThemeCSS(brand, floorId) {
  if (!brand && !floorId) return '';

  const themeData = floorId ? state.floorThemes[floorId] : null;
  const theme = themeData?.theme;

  // Resolve colors: prefer backend theme palette, fall back to gate1 brand colors
  let rawColors;
  if (theme?.primaryColor) {
    rawColors = [theme.primaryColor, theme.secondaryColor || theme.palette?.[1]?.hex, theme.accentColor || theme.palette?.[2]?.hex].filter(Boolean);
  } else if (brand?.colors) {
    rawColors = [...brand.colors];
  } else {
    return '';
  }

  // Helper: perceived brightness (0-255)
  const brightness = (hex) => {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return (r*299 + g*587 + b*114) / 1000;
  };
  // Helper: color saturation/vibrancy — how "colorful" it is
  const vibrancy = (hex) => {
    const r = parseInt(hex.slice(1,3),16) / 255;
    const g = parseInt(hex.slice(3,5),16) / 255;
    const b = parseInt(hex.slice(5,7),16) / 255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    return max - min; // crude saturation measure
  };

  // On a dark UI, sort colors so the most visible/vibrant is c1 (accent).
  // Very dark colors (brightness < 60) are bad accents on dark backgrounds.
  // Very light colors (brightness > 200) work as text/accent but not gradients.
  // Best accent: medium brightness + high vibrancy.
  const scored = rawColors.map(hex => ({
    hex,
    score: (vibrancy(hex) * 200) + Math.min(brightness(hex), 200) - (brightness(hex) < 60 ? 150 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);

  let c1 = scored[0]?.hex || rawColors[0];
  let c2 = scored[1]?.hex || rawColors[1] || c1;
  let c3 = scored[2]?.hex || rawColors[2] || c1;
  // Keep the darkest color available for backgrounds
  const darkest = [...rawColors].sort((a, b) => brightness(a) - brightness(b))[0];

  // Derive readable text colors
  const isLight = (hex) => brightness(hex) > 140;
  const onBrand = isLight(c1) ? '#0a0a1e' : '#ffffff';
  const onBrand2 = isLight(c2) ? '#0a0a1e' : '#ffffff';

  // Resolve fonts: prefer backend theme fonts, fall back to personality-based mapping
  let fontStack, bodyFontStack;
  if (theme?.headingFont) {
    const heading = theme.headingFont;
    const body = theme.bodyFont || heading;
    fontStack = `'${heading}', '${body}', system-ui, sans-serif`;
    bodyFontStack = `'${body}', system-ui, sans-serif`;
  } else {
    // Map brand personality → typography with real character
    const concept = (brand?.concept || '').toLowerCase();
    const typography = (brand?.typography || '').toLowerCase();
    if (/bold|street|hip.?hop|urban|raw|loud|prophetic|conviction/i.test(concept)) {
      fontStack = "'Oswald', 'Bebas Neue', Impact, system-ui, sans-serif";
      bodyFontStack = "'Inter', 'Roboto', system-ui, sans-serif";
    } else if (/quiet|minimal|subtle|refined|rebel|elegant/i.test(concept)) {
      fontStack = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";
      bodyFontStack = "'Inter', 'Source Sans Pro', system-ui, sans-serif";
    } else if (/warm|generous|heritage|craft|supply|reliable|sturdy|provider|weathered/i.test(concept)) {
      fontStack = "'Bitter', 'Roboto Slab', 'Courier Prime', Georgia, serif";
      bodyFontStack = "'Source Sans Pro', 'Inter', system-ui, sans-serif";
    } else {
      fontStack = "'Inter', 'SF Pro Display', system-ui, sans-serif";
      bodyFontStack = "'Inter', system-ui, sans-serif";
    }
    // Load Google Fonts dynamically for personality-based fonts
    const fontFamilies = fontStack.split(',').map(f => f.trim().replace(/'/g, '')).filter(f => !['system-ui','sans-serif','serif','Georgia','Impact','Courier Prime'].includes(f));
    const gfUrl = `https://fonts.googleapis.com/css2?${fontFamilies.map(f => `family=${f.replace(/\s/g,'+')}:wght@400;600;700;800;900`).join('&')}&display=swap`;
    if (!document.getElementById('brand-personality-font')) {
      const link = document.createElement('link');
      link.id = 'brand-personality-font';
      link.rel = 'stylesheet';
      link.href = gfUrl;
      document.head.appendChild(link);
    }
  }

  // Build extra palette CSS vars from backend theme
  const paletteVars = theme?.palette?.length
    ? theme.palette.map((s, i) => {
        const slug = s.name.toLowerCase().replace(/\s+/g, '-');
        return `  --brand-color-${slug}: ${s.hex};\n  --brand-palette-${i}: ${s.hex};`;
      }).join('\n')
    : '';

  const brandName = theme?.tagline ? (brand?.brandName || 'Brand') : (brand?.brandName || 'Brand');
  const bodyFontCSS = theme?.bodyFont
    ? `  --brand-body-font: '${theme.bodyFont}', system-ui, sans-serif;`
    : (bodyFontStack ? `  --brand-body-font: ${bodyFontStack};` : '');

  // ── Spacing tokens from Phase 4 deliverable ──
  const spacingUnit = theme?.spacingUnit || 8;
  const spacingVars = [1,2,3,4,5,6,8,10,12,16].map(n =>
    `  --space-${n}: ${n * spacingUnit}px;`
  ).join('\n');

  // ── Type scale tokens ──
  const typeScaleVars = [
    theme?.displaySize ? `  --type-display: ${theme.displaySize}px;` : '',
    theme?.headingSize ? `  --type-h1: ${theme.headingSize}px;` : '',
    theme?.subheadSize ? `  --type-h2: ${theme.subheadSize}px;` : '',
    theme?.bodySize    ? `  --type-body: ${theme.bodySize}px;` : '',
    theme?.captionSize ? `  --type-caption: ${theme.captionSize}px;` : '',
    theme?.headingWeight ? `  --type-heading-weight: ${theme.headingWeight};` : '',
    theme?.bodyLineHeight ? `  --type-body-line-height: ${theme.bodyLineHeight};` : '',
  ].filter(Boolean).join('\n');

  // ── Border radius tokens ──
  const radiusBase = theme?.borderRadius || null;
  const radiusVars = radiusBase ? [
    `  --brand-radius: ${radiusBase}px;`,
    `  --brand-radius-sm: ${Math.max(4, Math.round(radiusBase * 0.6))}px;`,
    `  --brand-radius-lg: ${Math.round(radiusBase * 1.5)}px;`,
    `  --brand-radius-xl: ${Math.round(radiusBase * 2)}px;`,
  ].join('\n') : '';

  // ── Dark/light mode compatibility ──
  const colorModeVars = theme?.colorMode === 'light' ? `
  /* Light mode brand overrides */
  --bg:    #f8f8fc;
  --bg2:   #f0f0f8;
  --text-1: rgba(10,10,30,0.95);
  --text-2: rgba(10,10,30,0.65);
  --text-3: rgba(10,10,30,0.40);
  --border: rgba(0,0,0,0.10);
  --border-hi: rgba(0,0,0,0.18);
  --glass:  rgba(0,0,0,0.04);
  --glass-hover: rgba(0,0,0,0.07);` : '';

  return `
<style id="floor-brand-theme">
/* ── Brand Visual System: ${brandName} — Phase 4 tokens scoped to .floor-branded ── */
/* Source: brand-visual-system deliverable · Auto-applied on Phase 4 completion     */
.floor-branded {
  /* ── Color tokens ── */
  --brand-primary:      ${c1};
  --brand-secondary:    ${c2};
  --brand-accent:       ${c3};
  --brand-on-primary:   ${onBrand};
  --brand-on-secondary: ${onBrand2};
  --brand-gradient:      linear-gradient(135deg, ${c1}, ${c2});
  --brand-gradient-soft: linear-gradient(135deg, ${c1}22, ${c2}11);
  --brand-border:  ${c1}55;
  --brand-glow:    0 0 40px ${c1}33;
  --brand-font:    ${fontStack};
${bodyFontCSS}
${paletteVars}
  /* ── Spacing system ── */
${spacingVars}
  /* ── Type scale ── */
${typeScaleVars}
  /* ── Border radius ── */
${radiusVars}
${colorModeVars}
  /* Override global accent colors with brand palette */
  --indigo:  ${c1};
  --violet:  ${c2};
}

/* ── FULL PAGE BRAND TAKEOVER ── */

/* Tint the entire page background with brand color */
.floor-branded {
  background: linear-gradient(180deg, ${darkest}88 0%, ${darkest}44 40%, transparent 80%), var(--bg, #0a0a1e) !important;
}

/* Background ambient glow — STRONG brand presence */
.floor-branded .floor-brand-ambient {
  background: radial-gradient(ellipse 100% 60% at 50% -15%, ${c1}30 0%, transparent 60%),
              radial-gradient(ellipse 70% 50% at 90% 80%, ${c2}18 0%, transparent 50%),
              radial-gradient(ellipse 50% 30% at 10% 50%, ${c1}0d 0%, transparent 40%);
}

/* Page title — uses brand primary + brand font */
.floor-branded .page-title {
  color: ${c1} !important;
  font-family: var(--brand-font) !important;
  letter-spacing: -0.8px;
}

/* Section labels — tinted with brand secondary */
.floor-branded .section-label {
  color: ${c2}cc;
  letter-spacing: 1.2px;
  font-family: var(--brand-font) !important;
}

/* ALL buttons — brand tinted */
.floor-branded .btn-primary {
  background: var(--brand-gradient) !important;
  box-shadow: 0 4px 20px ${c1}44 !important;
  font-family: var(--brand-font) !important;
}
.floor-branded .btn-primary:hover {
  box-shadow: 0 6px 30px ${c1}66 !important;
}
.floor-branded .btn-success {
  background: linear-gradient(135deg, ${c2}dd, ${c1}dd) !important;
  box-shadow: 0 4px 20px ${c2}44 !important;
  font-family: var(--brand-font) !important;
}
/* Glass buttons get brand border and tint */
.floor-branded .btn-glass {
  border-color: ${c1}33 !important;
  color: ${c2} !important;
}
.floor-branded .btn-glass:hover {
  border-color: ${c1}55 !important;
  background: ${c1}11 !important;
}

/* Progress bars — brand gradient */
.floor-branded .progress-bar-fill {
  background: var(--brand-gradient) !important;
}
.floor-branded .floor-progress-bar {
  background: var(--brand-gradient) !important;
}

/* Phase item active state — brand tinted */
.floor-branded .phase-item.active {
  border-color: ${c1}55 !important;
  background: ${c1}0f !important;
}
.floor-branded .phase-item.active .phase-status {
  color: ${c1} !important;
  background: ${c1}1a !important;
}

/* Phase mini-bar — brand gradient */
.floor-branded .phase-mini-bar-fill {
  background: var(--brand-gradient) !important;
}

/* Activity icon circles — brand tinted border */
.floor-branded .activity-icon {
  border-color: ${c1}33;
}

/* Deliverable card accent */
.floor-branded .deliverable-card:hover {
  box-shadow: 0 6px 24px ${c1}33;
  border-color: ${c1}44;
}
.floor-branded .deliverable-thumb {
  background: linear-gradient(135deg, ${c1}33, ${c2}22) !important;
}

/* Glass cards — subtle brand tint on border */
.floor-branded .glass {
  border-color: ${c1}22;
}
.floor-branded .glass-elevated {
  border-color: ${c1}33;
  box-shadow: 0 20px 60px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.09) inset, ${c1 ? `0 0 40px ${c1}22` : ''};
}

/* Attention / gate-ready pulse — brand tinted */
.floor-branded .floor-gate-ready-banner {
  background: linear-gradient(135deg, ${c1}22, ${c2}11) !important;
  border-color: ${c1}55 !important;
  box-shadow: 0 0 24px ${c1}22 !important;
}

/* ── Typography: page title uses brand primary ── */
.floor-branded .page-subtitle {
  color: ${c2}bb;
}

/* ── Top nav — brand colored ── */
.floor-branded-nav {
  border-bottom-color: ${c1}44 !important;
  background: linear-gradient(135deg, ${c1}11, ${c2}08) !important;
}
.floor-branded-nav a, .floor-branded-nav span, .floor-branded-nav div {
  font-family: var(--brand-font) !important;
}

/* ── Overall text tinting — body text uses brand body font ── */
.floor-branded .glass,
.floor-branded .activity-text,
.floor-branded .phase-name,
.floor-branded span,
.floor-branded div {
  font-family: var(--brand-body-font, var(--brand-font, inherit));
}
.floor-branded .page-title,
.floor-branded .page-subtitle,
.floor-branded .section-label,
.floor-branded .stat-value,
.floor-branded .floor-brand-header div[style*="font-weight"] {
  font-family: var(--brand-font) !important;
}

/* ── Stat cards — brand accent on value ── */
.floor-branded .stat-value {
  background: linear-gradient(135deg, ${c1}, ${c2});
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* ── Section labels — brand secondary tint ── */
.floor-branded .section-label {
  color: ${c2}cc;
  letter-spacing: 1.2px;
}

/* ── Phase item done — brand green alt ── */
.floor-branded .phase-item.done {
  border-color: ${c2}33 !important;
  background: ${c2}08 !important;
}
.floor-branded .phase-item.done .phase-status {
  color: ${c2} !important;
  background: ${c2}1a !important;
}

/* ── Activity items — brand tinted icon border ── */
.floor-branded .activity-item .activity-icon {
  border-color: ${c1}44;
  background: ${c1}0a;
}

/* ── Working agent card — brand pulse ── */
.floor-branded .agent-working-card {
  border-color: ${c1}33 !important;
  background: ${c1}06 !important;
}

/* ── Budget progress — brand colors ── */
.floor-branded .budget-bar-fill {
  background: var(--brand-gradient) !important;
}

/* ── Task status badges — brand tinted ── */
.floor-branded .badge-build {
  background: ${c1}22 !important;
  color: ${c1} !important;
  border-color: ${c1}44 !important;
}

/* ── New floor card hover — brand tinted ── */
.floor-branded .new-floor-card:hover {
  border-color: ${c1} !important;
  background: ${c1}0d !important;
}

/* ── Tag: gate tag — brand gold override ── */
.floor-branded .tag-gate {
  background: ${c2}22 !important;
  color: ${c2} !important;
  border-color: ${c2}44 !important;
}

/* ── Proposal cards — brand accent border ── */
.floor-branded .proposal-card {
  border-color: ${c1}33 !important;
  background: ${c1}07 !important;
}

/* ── Dividers — brand tinted ── */
.floor-branded .divider {
  background: ${c1}22;
}

/* ── Voice sample box ── */
.floor-branded .voice-sample {
  border-color: ${c1}33;
  background: ${c1}08;
}
.floor-branded .voice-sample-title {
  color: ${c1};
}

/* ── Typography: apply brand fonts to floor content ── */
.floor-branded {
  font-family: var(--brand-body-font, var(--brand-font, inherit));
}
.floor-branded .page-title,
.floor-branded .floor-brand-header div[style*="font-size:22px"],
.floor-branded h1, .floor-branded h2, .floor-branded h3 {
  font-family: var(--brand-font);
}
.floor-branded .page-subtitle,
.floor-branded .glass,
.floor-branded .activity-text,
.floor-branded p {
  font-family: var(--brand-body-font, var(--brand-font, inherit));
}

/* ── Type scale: wire Phase 4 tokens to element sizes ── */
.floor-branded .page-title {
  font-size: var(--type-h1, 28px);
  font-weight: var(--type-heading-weight, 800);
}
.floor-branded .stat-value {
  font-size: var(--type-h2, 28px);
}
.floor-branded .activity-text,
.floor-branded .glass,
.floor-branded .deliverable-name,
.floor-branded .phase-name,
.floor-branded p {
  font-size: var(--type-body, 14px);
  line-height: var(--type-body-line-height, 1.55);
}
.floor-branded .section-label,
.floor-branded .stat-label,
.floor-branded .deliverable-status,
.floor-branded .activity-time {
  font-size: var(--type-caption, 11px);
}

/* ── Spacing: wire Phase 4 spacing unit to card padding ── */
.floor-branded .glass {
  padding: var(--space-3, 24px);
}
.floor-branded .stat-card {
  padding: var(--space-2, 16px) var(--space-3, 24px);
}
.floor-branded .activity-item {
  padding: var(--space-2, 16px) 0;
}

/* ── Border radius: wire Phase 4 radius tokens ── */
.floor-branded .glass {
  border-radius: var(--brand-radius, var(--radius));
}
.floor-branded .glass-sm,
.floor-branded .btn-sm,
.floor-branded .input,
.floor-branded .textarea {
  border-radius: var(--brand-radius-sm, var(--radius-sm));
}
.floor-branded .glass-elevated {
  border-radius: var(--brand-radius-lg, var(--radius-lg));
}
.floor-branded .btn,
.floor-branded .option-card {
  border-radius: var(--brand-radius-sm, var(--radius-sm));
}
.floor-branded .btn-lg {
  border-radius: var(--brand-radius, var(--radius));
}

/* ── Phase 4 complete marker — no raw hex values below this line ── */
</style>`;
}

// ─── Floor View ───────────────────────────────────────────────────────────
function viewFloor() {
  const id    = router.params.id;
  const found = state.floors.find(f => f.id === id);
  if (!found) return viewFloorNotFound(id);
  let floor = found;
  // Apply any local phase override (survives API polls)
  const localPhase = getLocalPhase(id);
  if (localPhase !== null) floor = { ...floor, currentPhase: localPhase };
  const isLive = floor.status === 'live';

  if (isLive) return viewFloorLive(floor);
  return viewFloorBuilding(floor);
}

function viewFloorBuilding(floor) {
  const phase = floor.currentPhase || 1;
  // Use selected brand's primary color if brand has been confirmed, else fall back to floor color
  const selectedBrandIdx0 = getLocalBrand(floor.id) ?? 0;
  const selectedBrand0 = state.gate1BrandData[floor.id]?.[selectedBrandIdx0];
  const color = selectedBrand0 ? selectedBrand0.colors[0] : floorBrandColor(floor);

  // Full task list for this floor — populated by loadState()
  const floorTasks = state.floorTasks?.[floor.id] || [];
  const workingTasks = floorTasks.filter(t => t.status === 'working');

  // Find active backend phase from tasks (backend phase ≠ UI gate number)
  const activeBackendPhase =
    workingTasks[0]?.phaseNumber ||
    floorTasks.find(t => t.status === 'queued')?.phaseNumber ||
    floorTasks[floorTasks.length - 1]?.phaseNumber;

  // Task completion within the active backend phase
  const phaseTasks     = activeBackendPhase ? floorTasks.filter(t => t.phaseNumber === activeBackendPhase) : [];
  const phaseTasksDone = phaseTasks.filter(t => t.status === 'completed').length;
  const phaseTasksPct  = phaseTasks.length > 0
    ? Math.round((phaseTasksDone / phaseTasks.length) * 100)
    : (workingTasks.length > 0 ? 5 : 0);

  const pct = getFloorProgress(floor);

  // Pending gate review — the authoritative signal from the approvals system
  const pendingGate = state.approvals.find(
    a => a.floorId === floor.id && a.status === 'pending' && a.type === 'gate'
  );
  // Foundation gate specifically (phase 3) — only this one blocks brand display
  const pendingFoundationGate = state.approvals.find(
    a => a.floorId === floor.id && a.status === 'pending' && a.type === 'gate' && a.phaseNumber === 3
  );
  const brandData       = state.gate1BrandData[floor.id];
  const brandDataParsed = Array.isArray(brandData) && brandData.length > 0;
  // Ready if the approvals system says so OR brand data is parsed
  const brandReady = !!pendingFoundationGate || brandDataParsed;
  // Brand is approved once:
  // (a) past Foundation Sprint gate (phase > 3), OR
  // (b) brand-visual-system task has completed (Phase 4 deliverable done)
  const bvsCompleted = !!(state.floorTasks?.[floor.id] || [])
    .find(t => t.taskType === 'brand-visual-system' && t.status === 'completed');
  // Also consider brand "selected" if user has picked a direction locally (Pick This clicked)
  const localBrandPicked = getLocalBrand(floor.id) !== null && brandDataParsed;
  const brandApproved = (!pendingFoundationGate && phase > 3) || bvsCompleted || localBrandPicked;

  // Backend phases: 1-2=Setup, 3=Foundation(GATE), 4=Buildout, 5=Content,
  // 6=Staging(GATE), 7=Launch, 8=Ads(GATE), 9=Growth, 10=Optimize
  const phases = [
    { name: 'Foundation', num: 3,  gate: true,  state: phase > 3  ? 'done' : phase >= 1 ? 'active' : 'wait' },
    { name: 'Brand & Voice', num: 4, gate: false, state: phase > 4  ? 'done' : phase === 4 ? 'active' : 'wait' },
    { name: 'Content',   num: 5,  gate: false, state: phase > 5  ? 'done' : phase === 5 ? 'active' : 'wait' },
    { name: 'Staging & QA', num: 6, gate: true,  state: phase > 6  ? 'done' : phase === 6 ? 'active' : 'wait' },
    { name: 'Launch',    num: 7,  gate: false, state: phase > 7  ? 'done' : phase === 7 ? 'active' : 'wait' },
    { name: 'Ad Campaign', num: 8, gate: true,  state: phase > 8  ? 'done' : phase === 8 ? 'active' : 'wait' },
    { name: 'Growth',    num: 9,  gate: false, state: phase > 9  ? 'done' : phase === 9 ? 'active' : 'wait' },
  ];

  const phaseIcons = { done: '✅', active: '🔨', wait: '○' };

  const _spentCents   = floor.spentCents   ?? floor.spent_cents   ?? 0;
  const _budgetCents  = floor.budgetCeilingCents ?? floor.budget_ceiling_cents ?? 0;
  const spentPct = _budgetCents > 0
    ? Math.min(100, Math.round((_spentCents / _budgetCents) * 100))
    : 0;

  // Failed/escalated tasks for this floor
  const failedTasks = floorTasks.filter(t => t.status === 'failed' || t.status === 'escalated');

  // Floor-specific activity (filter global feed by this floor's id)
  const floorActivity = state.activity.filter(a => a.floor === floor.id).slice(0, 12);
  const activityHtml = floorActivity.length ? floorActivity.map(a => {
    // Strip " for FloorName" suffix — we're already on that floor's page
    const text = a.text.replace(/\s+for\s+.+$/, '');
    return `
    <div class="activity-item" ${a.taskId ? `onclick="showTaskDeliverable('${safeId(a.taskId)}')" style="cursor:pointer"` : ''}>
      <div class="activity-icon">${a.icon}</div>
      <div class="activity-body">
        <div class="activity-text">${text}</div>
        <div class="activity-time" style="display:flex;align-items:center;gap:6px">
          ${a.status === 'working' ? '<span style="width:6px;height:6px;border-radius:50%;background:var(--green,#22c55e);display:inline-block;animation:attention-pulse 1.5s ease-in-out infinite"></span>' : ''}
          ${a.status === 'failed' || a.status === 'escalated' ? '<span style="color:#ef4444;font-size:11px;font-weight:600">FAILED</span>' : ''}
          ${formatTime(a.time)}
          ${a.cost ? `<span style="color:var(--text-3)">· $${(a.cost/100).toFixed(2)}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('') : `<div style="padding:12px;color:var(--text-3);font-size:13px">No activity yet — agents are starting up.</div>`;

  // ── Brand theme injection (scoped, only when brand confirmed) ──
  const brandThemeCSS = brandApproved ? getBrandThemeCSS(selectedBrand0, floor.id) : '';
  // Remove any previous brand theme to avoid stacking
  document.getElementById('floor-brand-theme')?.remove();
  // Apply nav-branding class to topnav after render
  if (brandApproved) {
    requestAnimationFrame(() => {
      document.querySelector('.topnav')?.classList.add('floor-branded-nav');
    });
  }

  // ── Brand header bar (replaces generic title when brand confirmed) ──
  const floorTheme = state.floorThemes[floor.id]?.theme;
  const brandHeaderHtml = brandApproved && (selectedBrand0 || floorTheme) ? (() => {
    // Prefer backend theme colors, fall back to gate1 brand
    const hc1 = floorTheme?.primaryColor || selectedBrand0?.colors?.[0] || color;
    const hc2 = floorTheme?.secondaryColor || floorTheme?.palette?.[1]?.hex || selectedBrand0?.colors?.[1] || hc1;
    const brandName = floorDisplayName(floor);
    const tagline = selectedBrand0?.tagline || floor.selectedBrand?.tagline || floor.goal;
    const emoji = selectedBrand0?.emoji || '🏢';
    // Resolve selected logo: local storage capture → logo cache lookup → emoji fallback
    const savedLogoUrl = localFloorState[floor.id]?.logoUrl || null;
    const logoUrl = savedLogoUrl || (() => {
      const letters = ['A','B','C'];
      const bIdx = getLocalBrand(floor.id) ?? 0;
      const letter = letters[bIdx] || 'A';
      const candidates = (state.gate1BrandLogos?.[floor.id] || {})[letter] || [];
      const choiceIdx = (state.gate1LogoChoice?.[floor.id]?.[letter]) || 0;
      return candidates[choiceIdx] || null;
    })();

    // Color pills from theme palette or gate1 brand
    const pillColors = floorTheme?.palette?.length
      ? floorTheme.palette.slice(0, 5).map(s => s.hex)
      : selectedBrand0?.colors?.slice(0, 3) || [hc1, hc2];

    return `
    <div class="floor-brand-header" style="
      display:flex; align-items:center; gap:16px;
      padding:14px 0 20px;
      border-bottom:1px solid ${hc1}33;
      margin-bottom:24px;
    ">
      <!-- Brand logo mark -->
      ${logoUrl ? `
      <div style="
        width:48px; height:48px; border-radius:14px; flex-shrink:0;
        background:${hc1};
        display:flex; align-items:center; justify-content:center;
        overflow:hidden;
        box-shadow:0 4px 16px ${hc1}55;
        border:1px solid ${hc2}44;
      "><img src="${logoUrl}" alt="Logo" style="width:100%;height:100%;object-fit:cover;border-radius:14px"></div>` : `
      <div style="
        width:48px; height:48px; border-radius:14px; flex-shrink:0;
        background:linear-gradient(135deg,${hc1},${hc2});
        display:flex; align-items:center; justify-content:center;
        font-size:24px;
        box-shadow:0 4px 16px ${hc1}55;
        border:1px solid ${hc2}44;
      ">${emoji}</div>`}
      <!-- Brand name + tagline -->
      <div style="flex:1;min-width:0">
        <div style="
          font-size:22px; font-weight:800; letter-spacing:-0.5px;
          color:${hc1}; line-height:1.1;
          font-family:var(--brand-font,inherit);
        ">${brandName}</div>
        <div style="
          font-size:12px; color:var(--text-3); margin-top:3px;
          font-style:italic; letter-spacing:0.2px;
          font-family:var(--brand-body-font, inherit);
        ">"${tagline}"</div>
      </div>
      <!-- Color palette strip -->
      <div style="display:flex;gap:5px;flex-shrink:0">
        ${pillColors.map(c =>
          `<div style="width:10px;height:10px;border-radius:50%;background:${c};border:1px solid rgba(255,255,255,0.2)"></div>`
        ).join('')}
      </div>
    </div>`;
  })() : '';

  return `
  ${brandThemeCSS}
  ${renderTopNav({ back: true, backLabel: 'Tower', title: floorDisplayName(floor).toUpperCase(), backOnclick: "router.go('tower')" })}
  <div class="view floor-branded">
    <div class="floor-brand-ambient" style="position:absolute;inset:0;pointer-events:none;z-index:0"></div>
    <div style="position:relative;z-index:1">
    ${brandHeaderHtml}
    <div class="page-header" style="${brandApproved ? 'display:none' : ''}">
      <div>
        <div class="page-title" style="color:${color}">${floorDisplayName(floor)}</div>
        <div class="page-subtitle">${floor.goal || 'Building your business...'}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-glass btn-sm" onclick="router.go('weekly', {id:'${floor.id}'})">📊 Weekly</button>
        <button class="btn btn-glass btn-sm" onclick="expandChatPanel()">💬 Chat</button>
        <button class="btn btn-glass btn-sm" onclick="router.go('trust-ladder', {id:'${floor.id}'})">🔒 Trust</button>
        ${floor.id !== 'demo-1' ? `<button class="btn btn-glass btn-sm" style="opacity:0.6" onclick="killFloor('${floor.id}')">⏸ Pause</button>` : ''}
        ${floor.id !== 'demo-1' ? `<button class="btn btn-glass btn-sm" style="opacity:0.6;color:var(--red,#ef4444)" onclick="confirmDeleteFloor('${floor.id}','${floorDisplayName(floor)}')">🗑 Delete</button>` : ''}
      </div>
    </div>
    ${brandApproved ? `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
      <button class="btn btn-glass btn-sm" onclick="router.go('weekly', {id:'${floor.id}'})">📊 Weekly</button>
      <button class="btn btn-glass btn-sm" onclick="expandChatPanel()">💬 Chat</button>
      <button class="btn btn-glass btn-sm" onclick="router.go('trust-ladder', {id:'${floor.id}'})">🔒 Trust</button>
      ${floor.id !== 'demo-1' ? `<button class="btn btn-glass btn-sm" style="opacity:0.6" onclick="killFloor('${floor.id}')">⏸ Pause</button>` : ''}
      ${floor.id !== 'demo-1' ? `<button class="btn btn-glass btn-sm" style="opacity:0.6;color:var(--red,#ef4444)" onclick="confirmDeleteFloor('${floor.id}','${floorDisplayName(floor)}')">🗑 Delete</button>` : ''}
    </div>` : ''}

    ${brandApproved ? (() => {
      const selectedBrandIdx = getLocalBrand(floor.id) ?? 0;
      const selectedBrand = state.gate1BrandData[floor.id]?.[selectedBrandIdx];
      const ft = state.floorThemes[floor.id]?.theme;
      // Prefer backend theme, fall back to gate1 brand data
      const bc1 = ft?.primaryColor || selectedBrand?.colors?.[0] || color;
      const bc2 = ft?.secondaryColor || ft?.palette?.[1]?.hex || selectedBrand?.colors?.[1] || bc1;
      const bName = floorDisplayName(floor);
      const bTagline = selectedBrand?.tagline || floor.selectedBrand?.tagline || floor.goal;
      const bEmoji = selectedBrand?.emoji || '🏢';
      // Palette: prefer full backend palette, fall back to gate1 colors
      const paletteColors = ft?.palette?.length
        ? ft.palette.map(s => ({ hex: s.hex, name: s.name }))
        : (selectedBrand?.colors || [bc1, bc2]).map(c => ({ hex: c, name: c }));
      const voiceAttrs = selectedBrand?.voiceAttrs || floor.selectedBrand?.voiceAttributes || [];
      // Font info from theme
      const fontInfo = ft?.headingFont ? `${ft.headingFont}${ft.bodyFont && ft.bodyFont !== ft.headingFont ? ' / ' + ft.bodyFont : ''}` : null;

      return `
    <div class="glass" style="
      margin-bottom:20px; padding:0; overflow:hidden; border-radius:var(--radius);
      border:1px solid ${bc1}44;
    ">
      <!-- Brand color bar from full palette -->
      <div style="display:flex;height:6px">
        ${paletteColors.map(c => `<div style="flex:1;background:${c.hex}"></div>`).join('')}
      </div>
      <div style="padding:20px 22px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px">
          <!-- Brand logo -->
          ${localFloorState[floor.id]?.logoUrl
            ? `<div style="
                width:56px;height:56px;border-radius:50%;flex-shrink:0;
                background:${bc1};overflow:hidden;
                border:2px solid ${bc2}44;
              "><img src="${localFloorState[floor.id].logoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="Logo"></div>`
            : `<div style="
                width:56px;height:56px;border-radius:50%;flex-shrink:0;
                background:linear-gradient(135deg,${bc1},${bc2});
                display:flex;align-items:center;justify-content:center;
                font-size:26px;border:2px solid ${bc2}44;
              ">${bEmoji}</div>`}
          <div style="flex:1;min-width:0">
            <div style="font-size:18px;font-weight:800;color:var(--text-1);letter-spacing:-0.3px;font-family:var(--brand-font,inherit)">${bName}</div>
            <div style="font-size:13px;color:var(--text-3);font-style:italic;margin-top:2px;font-family:var(--brand-body-font,inherit)">"${bTagline}"</div>
          </div>
          <div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:#22c55e;flex-shrink:0">✅ CONFIRMED</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          ${paletteColors.slice(0, 6).map(c => `
          <div style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.05);border-radius:20px;padding:4px 10px" title="${c.name}">
            <div style="width:10px;height:10px;border-radius:50%;background:${c.hex};flex-shrink:0"></div>
            <span style="font-size:11px;color:var(--text-3);font-family:monospace">${c.hex}</span>
          </div>`).join('')}
        </div>
        ${fontInfo ? `
        <div style="font-size:11px;color:var(--text-3);font-weight:600;letter-spacing:0.5px;margin-bottom:4px">TYPOGRAPHY</div>
        <div style="font-size:13px;color:var(--text-2);font-family:var(--brand-font,inherit);margin-bottom:8px">${fontInfo}</div>` : ''}
        ${voiceAttrs?.length ? `
        <div style="font-size:11px;color:var(--text-3);font-weight:600;letter-spacing:0.5px;margin-bottom:4px">VOICE</div>
        <div style="font-size:13px;color:var(--text-2)">${voiceAttrs.slice(0,3).join(' · ')}</div>` : ''}
      </div>
    </div>`;
    })() : ''}

    ${/* Show gate review banner when there's a pending gate the user needs to act on */
      pendingGate ? (() => {
      // Route to the right gate based on pending approval type
      const gateView = pendingGate?.phaseNumber === 3 ? 'gate1'
                     : pendingGate?.phaseNumber === 5 ? 'content-production'
                     : pendingGate?.phaseNumber === 6 ? 'gate2'
                     : pendingGate?.phaseNumber === 8 ? 'gate3'
                     : 'gate1'; // Unknown gate — default to Foundation review
      const gateName = pendingGate?.phaseName || 'Foundation Sprint';
      // Store on state so the btn-row below can reference the same computed value
      state._pendingGateView = gateView;
      state._pendingGateName = gateName;
      return `
    <div onclick="router.go('${gateView}', {id:'${floor.id}'})" style="
      margin-bottom:20px; cursor:pointer; padding:18px 22px;
      background:linear-gradient(135deg,rgba(99,102,241,0.15),rgba(245,158,11,0.1));
      border:1px solid rgba(99,102,241,0.4); border-radius:var(--radius);
      display:flex; align-items:center; justify-content:space-between;
      box-shadow:0 0 24px rgba(99,102,241,0.15);
      animation: attention-pulse 3s ease-in-out infinite;
    ">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:40px;height:40px;border-radius:50%;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.5);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">✨</div>
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--text-1)">${gateName} ready for your review</div>
          <div style="font-size:13px;color:var(--text-2);margin-top:3px">Tap to review and approve before the build continues.</div>
        </div>
      </div>
      <button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="event.stopPropagation();router.go('${gateView}', {id:'${floor.id}'})">Review →</button>
    </div>`;
    })() : (!brandApproved ? `
    <div style="
      margin-bottom:20px; padding:16px 20px;
      background:rgba(255,255,255,0.03);
      border:1px solid var(--border); border-radius:var(--radius);
      display:flex; align-items:center; gap:14px;
    ">
      <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🔨</div>
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--text-2)">Building foundation…</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:2px">Agents are working. You'll see a notification here when ready to review.</div>
      </div>
    </div>` : '')}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div class="glass" style="padding:22px">
        <div class="section-label" style="margin-bottom:14px">BUILD PROGRESS</div>
        <div class="phase-list">
          ${phases.map(p => `
          <div class="phase-item ${p.state}">
            <span class="phase-icon">${phaseIcons[p.state]}</span>
            <span class="phase-name">${p.name}</span>
            ${p.state === 'active' ? `
            <div class="phase-mini-bar"><div class="phase-mini-bar-fill" style="width:${phaseTasksPct}%"></div></div>` : ''}
            <span class="phase-status">${p.state === 'done' ? 'Done' : p.state === 'active' ? `${phaseTasksPct}%` : ''}</span>
          </div>`).join('')}
        </div>
        <div style="margin-top:16px">
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" style="width:${pct}%"></div>
          </div>
          <div style="font-size:12px;color:var(--text-3);margin-top:6px">Overall ${pct}% complete</div>
        </div>
      </div>

      <div class="glass" style="padding:22px">
        <div class="section-label" style="margin-bottom:14px">BUDGET</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">
          <span style="font-size:28px;font-weight:800;color:var(--text-1)">${fmtMoney(_spentCents)}</span>
          <span style="font-size:14px;color:var(--text-3)">of ${_budgetCents > 0 ? fmtMoney(_budgetCents) : '∞'}</span>
        </div>
        <div class="progress-bar-wrap" style="margin:10px 0 12px">
          <div class="progress-bar-fill" style="width:${spentPct}%;background:${spentPct>80?'linear-gradient(90deg,#dc2626,#ef4444)':spentPct>60?'linear-gradient(90deg,var(--gold),var(--yellow))':'linear-gradient(90deg,var(--indigo),var(--violet))'}"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:var(--radius-sm);border:1px solid var(--border)">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);margin-bottom:4px">Remaining</div>
            <div style="font-size:16px;font-weight:700;color:${spentPct > 80 ? '#ef4444' : 'var(--green)'}">${_budgetCents > 0 ? fmtMoney(_budgetCents - _spentCents) : '—'}</div>
          </div>
          <div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:var(--radius-sm);border:1px solid var(--border)">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);margin-bottom:4px">Used</div>
            <div style="font-size:16px;font-weight:700;color:var(--text-1)">${spentPct}%</div>
          </div>
        </div>
      </div>
    </div>

    <div class="glass" style="padding:22px;margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="section-label" style="margin:0">DELIVERABLES</div>
        ${(() => {
          const done = floorTasks.filter(t => t.status === 'completed').length;
          const total = floorTasks.length;
          return total > 0 ? `<span style="font-size:11px;color:var(--text-3)">${done}/${total} complete</span>` : '';
        })()}
      </div>
      ${(() => {
        const DELIVERABLE_META = {
          'brand-options':          { icon: '🎨', name: 'Brand Identity' },
          'business-strategy':      { icon: '📋', name: 'Strategy' },
          'budget-plan':            { icon: '💰', name: 'Budget Plan' },
          'budget-plan-redo':       { icon: '💰', name: 'Budget (Revised)' },
          'brand-visual-system':    { icon: '🎨', name: 'Visual System' },
          'logo-generation':        { icon: '✦', name: 'Logo' },
          'brand-voice-guide':      { icon: '✍️', name: 'Voice Guide' },
          'product-catalog':        { icon: '🛒', name: 'Product Catalog' },
          'content-calendar':       { icon: '📅', name: 'Content Calendar' },
          'email-welcome-sequence': { icon: '📧', name: 'Email Sequence' },
          'promo-video-script':     { icon: '🎬', name: 'Promo Video Script' },
          'staging-review':         { icon: '🔍', name: 'Staging Review' },
          'copy-review':            { icon: '📝', name: 'Copy Review' },
          'copy-review-redo':       { icon: '📝', name: 'Copy (Revised)' },
          'analytics-setup':        { icon: '📊', name: 'Analytics' },
          'launch-ad-campaign':     { icon: '📢', name: 'Ad Campaign' },
          'ad-creative-production': { icon: '🖼️', name: 'Ad Creatives' },
          'conversion-tracking':    { icon: '🔗', name: 'Conversion Tracking' },
          'performance-review':     { icon: '📈', name: 'Performance' },
          'content-refresh':        { icon: '🔄', name: 'Content Refresh' },
          'ad-optimization':        { icon: '🎯', name: 'Ad Optimization' },
          'growth-report':          { icon: '📊', name: 'Growth Report' },
          'strategy-revision':      { icon: '🧭', name: 'Strategy Update' },
          'phase-3-gate':           { icon: '🚦', name: 'Foundation Approval' },
          'phase-6-gate':           { icon: '🚦', name: 'Launch Approval' },
          'phase-8-gate':           { icon: '🚦', name: 'Ad Spend Approval' },
        };
        const PHASE_NAMES = {
          3: 'Foundation', 4: 'Buildout', 5: 'Content', 6: 'QA & Staging',
          7: 'Launch', 8: 'Ad Activation', 9: 'Growth Ops', 10: 'Optimization', 11: 'Operations',
        };

        // Dedup: for -redo variants, keep only the latest version
        const deduped = [];
        const seenBase = new Set();
        const sorted = [...floorTasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        for (const t of sorted) {
          const base = (t.taskType || '').replace(/-redo$/, '');
          if (seenBase.has(base)) continue;
          seenBase.add(base);
          deduped.push(t);
        }
        deduped.reverse();

        if (deduped.length === 0) {
          return `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:13px">No tasks yet — waiting for agents...</div>`;
        }

        // Group by phase
        const groups = {};
        for (const t of deduped) {
          const ph = t.phaseNumber || 0;
          if (!groups[ph]) groups[ph] = [];
          groups[ph].push(t);
        }

        return Object.keys(groups).sort((a, b) => a - b).map(ph => {
          const tasks = groups[ph];
          const phaseName = PHASE_NAMES[ph] || `Phase ${ph}`;
          const phDone = tasks.filter(t => t.status === 'completed').length;
          const phTotal = tasks.length;
          return `
          <div class="deliverables-phase-group">
            <div class="deliverables-phase-header">
              <span class="deliverables-phase-label">PHASE ${ph} — ${phaseName}</span>
              <span class="deliverables-phase-count">${phDone}/${phTotal}</span>
            </div>
            <div class="deliverables-grid">
              ${tasks.map(t => {
                const meta = DELIVERABLE_META[t.taskType] || { icon: '📄', name: t.taskType.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) };
                const isEscalated = t.status === 'escalated';
                const isWorking = t.status === 'working' || t.status === 'dispatched' || t.status === 'review';
                const isQueued = t.status === 'queued' || t.status === 'created';
                const isCouncil = !!t.councilUsed;
                const isDone = t.status === 'completed';
                const statusDot = isEscalated ? '#ef4444' : isWorking ? '#22c55e' : isQueued ? '#666' : isCouncil ? '#a78bfa' : '#22c55e';
                const statusText = isEscalated ? 'Needs Retry' : isWorking ? 'In Progress' : isQueued ? 'Queued' : isCouncil ? 'Council' : 'Done';
                const statusClass = isEscalated ? 'deliverable-escalated' : isWorking ? 'deliverable-working' : isQueued ? 'deliverable-queued' : isCouncil ? 'deliverable-council' : 'deliverable-done';
                const canClick = isDone || isEscalated || isCouncil;
                const onclick = canClick ? `showTaskDeliverable('${t.id}')` : '';
                return `
              <div class="deliverable-row ${statusClass}" ${onclick ? `onclick="${onclick}" style="cursor:pointer"` : ''}>
                <span class="deliverable-row-icon">${meta.icon}</span>
                <span class="deliverable-row-name">${meta.name}</span>
                <span class="deliverable-row-dot" style="background:${statusDot}"></span>
                <span class="deliverable-row-status">${statusText}</span>
              </div>`;
              }).join('')}
            </div>
          </div>`;
        }).join('');
      })()}
    </div>

    ${workingTasks.length > 0 ? `
    <div class="glass" style="padding:16px 20px;margin-bottom:16px;border:1px solid rgba(34,197,94,0.2);background:rgba(34,197,94,0.04)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="width:8px;height:8px;border-radius:50%;background:var(--green,#22c55e);display:inline-block;animation:attention-pulse 1.5s ease-in-out infinite;flex-shrink:0"></span>
        <span class="section-label" style="margin:0">${workingTasks.length} AGENT${workingTasks.length > 1 ? 'S' : ''} WORKING NOW</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${workingTasks.map(t => {
          const meta = AGENT_META[t.assignedAgent] || { icon: '🤖', name: t.assignedAgent };
          const verb = TASK_VERBS[t.taskType] || t.taskType.replace(/-/g, ' ');
          const elapsed = t.dispatchedAt ? Math.round((Date.now() - new Date(t.dispatchedAt).getTime()) / 60000) : 0;
          return `
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-size:20px;flex-shrink:0">${meta.icon}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--text-1)">${meta.name}</div>
              <div style="font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${verb}</div>
            </div>
            <div style="font-size:11px;color:var(--text-3);flex-shrink:0">${elapsed > 0 ? elapsed+'m' : 'just started'}</div>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}

    ${failedTasks.length > 0 ? `
    <div class="glass" style="padding:16px 20px;margin-bottom:16px;border:1px solid rgba(239,68,68,0.2);background:rgba(239,68,68,0.04)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:14px">⚠️</span>
        <span class="section-label" style="margin:0">${failedTasks.length} FAILED TASK${failedTasks.length > 1 ? 'S' : ''}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${failedTasks.map(t => {
          const meta = AGENT_META[t.assignedAgent] || { icon: '🤖', name: t.assignedAgent };
          const verb = t.taskType.replace(/-/g, ' ');
          return `
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-size:20px;flex-shrink:0">${meta.icon}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--text-1)">${meta.name}</div>
              <div style="font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${verb}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button class="btn btn-glass btn-sm" style="font-size:11px" onclick="showTaskDeliverable('${safeId(t.id)}')">View</button>
              <button class="btn btn-primary btn-sm" style="font-size:11px" onclick="retryTask('${safeId(t.id)}')">🔄 Retry</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}

    <div class="section">
      <div class="section-header"><span class="section-label">Floor Activity</span></div>
      <div class="glass" style="padding:4px 16px">${activityHtml}</div>
    </div>

    ${(() => {
      const floorFb = state.feedback.filter(fb => fb.floorId === floor.id);
      const pendingFb = floorFb.filter(fb => fb.eveDecision === 'needs-approval' && fb.status === 'analyzed');
      const recentAuto = floorFb.filter(fb => fb.status === 'applied').slice(-3);
      return `
    <div class="section">
      <div class="section-header">
        <span class="section-label">Report to EVE</span>
        ${pendingFb.length > 0 ? `<span class="tag" style="background:rgba(99,102,241,0.15);color:#6366f1">${pendingFb.length} awaiting</span>` : ''}
      </div>
      <div class="glass" style="padding:14px">
        <div style="display:flex;gap:8px;margin-bottom:${recentAuto.length > 0 || pendingFb.length > 0 ? '12px' : '0'}">
          <input class="input" id="fm-feedback-input" placeholder="Report an issue or suggest an improvement…"
                 onkeydown="if(event.key==='Enter')submitFloorFeedback('${floor.id}')"
                 style="flex:1;margin:0;font-size:13px">
          <button class="btn btn-primary btn-sm" onclick="submitFloorFeedback('${floor.id}')">Send</button>
        </div>
        ${pendingFb.length > 0 ? pendingFb.map(fb => `
        <div style="background:rgba(99,102,241,0.06);border-radius:10px;padding:10px 12px;margin-bottom:8px">
          <div style="font-size:12px;color:var(--text-2);margin-bottom:6px">"${fb.message}"</div>
          <div style="font-size:11px;color:#6366f1;margin-bottom:6px">${fb.eveAnalysis?.split('\\n')[0] || ''}</div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-glass btn-sm" style="font-size:11px" onclick="rejectAgentFeedback('${fb.id}')">Dismiss</button>
            <button class="btn btn-success btn-sm" style="font-size:11px" onclick="approveAgentFeedback('${fb.id}')">Approve</button>
          </div>
        </div>`).join('') : ''}
        ${recentAuto.length > 0 ? recentAuto.map(fb => `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0">
          <span style="font-size:12px">⚡</span>
          <span style="font-size:11px;color:var(--text-3)">${fb.actionTaken || fb.eveAnalysis || 'Auto-applied'}</span>
        </div>`).join('') : ''}
      </div>
    </div>`;
    })()}

    <div class="btn-row">
      ${pendingGate ? `
      <button class="btn btn-primary" onclick="router.go('${
        pendingGate.phaseNumber === 3 ? 'gate1'
        : pendingGate.phaseNumber === 5 ? 'content-production'
        : pendingGate.phaseNumber === 6 ? 'gate2'
        : pendingGate.phaseNumber === 8 ? 'gate3'
        : 'floor'
      }', {id:'${floor.id}'})">
        ✨ Review ${pendingGate.phaseName || 'Gate'}
      </button>` : brandApproved ? `
      <div class="btn btn-glass" style="opacity:0.5;cursor:default;flex:1;text-align:center">
        ✅ Foundation Approved
      </div>` : `
      <div class="btn btn-glass" style="opacity:0.4;cursor:default;flex:1;text-align:center">
        ⏳ Building Foundation…
      </div>`}
      <button class="btn btn-glass" onclick="expandChatPanel()">
        💬 Talk to Floor Manager
      </button>
    </div>
  </div>`;
}

function viewFloorLive(floor) {
  const color  = floorBrandColor(floor);
  const activeTab = router.params.tab || 'today';

  const weekDays = [
    { day: 'M', amt: '$520', pct: 60 },
    { day: 'T', amt: '$480', pct: 56 },
    { day: 'W', amt: '$720', pct: 84 },
    { day: 'T', amt: '$663', pct: 77 },
    { day: 'F', amt: '$847', pct: 98 },
    { day: 'S', amt: '',    pct: 0  },
    { day: 'S', amt: '',    pct: 0  },
  ];

  const perfItems = [
    { label:'ROAS', value: floor.roas || '3.2×',   status:'🟢', cls:'perf-green' },
    { label:'CPA',  value: floor.cpa  || '$8.50',  status:'🟢', cls:'perf-green' },
    { label:'CTR',  value: floor.ctr  || '2.1%',   status:'🟡', cls:'perf-yellow' },
  ];

  const products = [
    { name:`${floorDisplayName(floor)} — Design 1`, sales:'5 sold · $175', icon:'👕' },
    { name:`${floorDisplayName(floor)} — Design 2`, sales:'4 sold · $140', icon:'👕' },
    { name:`${floorDisplayName(floor)} — Design 3`, sales:'3 sold · $105', icon:'👕' },
  ];

  return `
  ${renderTopNav({ back: true, backLabel: 'Tower', title: floorDisplayName(floor).toUpperCase(), backOnclick: "router.go('tower')" })}
  <div class="view">
    <div class="page-header">
      <div>
        <div class="page-title" style="color:${color}">${floorDisplayName(floor)}
          <span style="font-size:14px;font-weight:500;color:var(--green);margin-left:8px">🟢 Live</span>
        </div>
        <div class="page-subtitle">${floor.goal || ''}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-glass btn-sm" onclick="router.go('weekly', {id:'${floor.id}'})">📊 Weekly</button>
        <button class="btn btn-glass btn-sm" onclick="expandChatPanel()">💬 Chat</button>
      </div>
    </div>

    <div class="section">
      <div class="section-label" style="margin-bottom:12px">TODAY</div>
      <div class="stat-strip">
        <div class="glass stat-card">
          <div class="stat-label">Revenue</div>
          <div class="stat-value">${fmtMoney(floor.todayRevenueCents)}</div>
          <div class="stat-delta ${(floor.revenueDelta||0)>=0?'up':'down'}">
            ${(floor.revenueDelta||0)>=0?'▲':'▼'} ${Math.abs(floor.revenueDelta||15)}%
          </div>
        </div>
        <div class="glass stat-card">
          <div class="stat-label">Orders</div>
          <div class="stat-value">${floor.todayOrders || 12}</div>
          <div class="stat-delta up">▲ ${floor.ordersDelta || 8}%</div>
        </div>
        <div class="glass stat-card">
          <div class="stat-label">Ad Spend</div>
          <div class="stat-value">${fmtMoney(floor.todayAdSpendCents)}</div>
          <div class="stat-delta down">▼ ${Math.abs(floor.adDelta || 3)}%</div>
        </div>
        <div class="glass stat-card">
          <div class="stat-label">Profit</div>
          <div class="stat-value">${fmtMoney(floor.todayProfitCents)}</div>
          <div class="stat-delta up">▲ ${floor.profitDelta || 22}%</div>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div class="glass" style="padding:22px">
        <div class="section-label" style="margin-bottom:14px">THIS WEEK</div>
        <div class="week-chart">
          <div class="week-bar-row">
            ${weekDays.map((d, i) => `
            <div class="week-bar-wrap">
              <div class="week-bar ${i===4?'today':''} ${d.pct===0?'empty':''}" style="height:${Math.min(64, d.pct * 0.64)}px"></div>
            </div>`).join('')}
          </div>
          <div style="display:flex;gap:6px">
            ${weekDays.map(d => `<div style="flex:1;text-align:center;font-size:10px;color:var(--text-3)">${d.day}</div>`).join('')}
          </div>
        </div>
        <div style="margin-top:12px">
          <div style="display:flex;justify-content:space-between;font-size:13px">
            <span style="color:var(--text-2)">This week</span>
            <span style="font-weight:700">$4,230</span>
          </div>
          <div class="progress-bar-wrap" style="margin:8px 0">
            <div class="progress-bar-fill" style="width:84%"></div>
          </div>
          <div style="font-size:12px;color:var(--text-3)">84% of $5,000 target</div>
        </div>
      </div>

      <div class="glass" style="padding:22px">
        <div class="section-label" style="margin-bottom:14px">AD PERFORMANCE</div>
        <div class="perf-chips">
          ${perfItems.map(p => `
          <div class="glass-sm perf-chip ${p.cls}">
            <div class="perf-chip-label">${p.label}</div>
            <div class="perf-chip-value">${p.value}</div>
            <div class="perf-chip-status">${p.status}</div>
          </div>`).join('')}
        </div>

        <div class="divider"></div>

        <div style="display:flex;gap:8px">
          <button class="btn btn-glass btn-sm" style="flex:1" onclick="router.go('gate3', {id:'${floor.id}'})">
            View Campaigns
          </button>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header"><span class="section-label">Top Products</span></div>
      <div class="products-scroll">
        ${products.map(p => `
        <div class="product-card glass">
          <div class="product-thumb">${p.icon}</div>
          <div class="product-info">
            <div class="product-name">${p.name}</div>
            <div class="product-sales">${p.sales}</div>
          </div>
        </div>`).join('')}
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn btn-glass" style="flex:1" onclick="router.go('weekly', {id:'${floor.id}'})">📊 Analytics</button>
      <button class="btn btn-glass" style="flex:1" onclick="toast('Content calendar coming soon', 'info')">📱 Content</button>
      <button class="btn btn-glass" style="flex:1" onclick="router.go('gate3', {id:'${floor.id}'})">💰 Ads</button>
    </div>
  </div>`;
}

// ─── Brand Visual System parser (Phase 4 deliverable) ────────────────────
// Extracts the full color palette, typography scale, and spacing system
// from the brand-visual-system agent output and returns a theme object
// compatible with the existing floorThemes / getBrandThemeCSS() pipeline.
function parseBrandVisualSystem(text, floorId) {
  if (!text || typeof text !== 'string') return null;

  const theme = {};

  // ── Color extraction ─────────────────────────────────────────────────
  // Strategy: collect all named hex values in order of semantic priority.
  // Patterns seen in agent output:
  //   **Primary:** `#4A3AFF` — Electric Indigo
  //   Primary Color: #4A3AFF
  //   primary: "#4A3AFF"
  //   | Primary | #4A3AFF |

  const extractHex = (label, source) => {
    const patterns = [
      new RegExp(`(?:${label})[^\\n]*?\`(#[0-9A-Fa-f]{6})\``, 'i'),
      new RegExp(`(?:${label})[^\\n]*?(#[0-9A-Fa-f]{6})`, 'i'),
      new RegExp(`\\|\\s*${label}[^|]*\\|[^|]*?(#[0-9A-Fa-f]{6})`, 'i'),
    ];
    for (const p of patterns) {
      const m = source.match(p);
      if (m) return m[1];
    }
    return null;
  };

  theme.primaryColor   = extractHex('primary', text);
  theme.secondaryColor = extractHex('secondary', text);
  theme.accentColor    = extractHex('accent', text);

  // Neutral / background colors
  const neutralHex  = extractHex('neutral', text)  || extractHex('dark', text);
  const bgHex       = extractHex('background', text) || extractHex('light', text);

  // Full palette: all named hex entries in document order, deduplicated
  const paletteEntries = [];
  const paletteRegex = /\*?\*?([A-Za-z][A-Za-z0-9 \-]+?)\*?\*?\s*[:\|]\s*[`"]?(#[0-9A-Fa-f]{6})[`"]?/g;
  let pm;
  const seenHex = new Set();
  while ((pm = paletteRegex.exec(text)) !== null) {
    const name = pm[1].trim();
    const hex  = pm[2];
    // Skip noise labels
    if (/^(the|and|or|in|at|of|a|an|is|use|used|with|for|this|that|it|as|to|be|not)$/i.test(name)) continue;
    if (!seenHex.has(hex)) {
      seenHex.add(hex);
      paletteEntries.push({ name, hex });
    }
  }
  // Ensure primary/secondary/accent are in the palette
  if (theme.primaryColor && !seenHex.has(theme.primaryColor)) {
    paletteEntries.unshift({ name: 'Primary', hex: theme.primaryColor });
    seenHex.add(theme.primaryColor);
  }
  if (theme.secondaryColor && !seenHex.has(theme.secondaryColor)) {
    paletteEntries.splice(1, 0, { name: 'Secondary', hex: theme.secondaryColor });
    seenHex.add(theme.secondaryColor);
  }
  if (theme.accentColor && !seenHex.has(theme.accentColor)) {
    paletteEntries.splice(2, 0, { name: 'Accent', hex: theme.accentColor });
    seenHex.add(theme.accentColor);
  }
  if (neutralHex && !seenHex.has(neutralHex)) {
    paletteEntries.push({ name: 'Neutral', hex: neutralHex });
  }
  if (bgHex && !seenHex.has(bgHex)) {
    paletteEntries.push({ name: 'Background', hex: bgHex });
  }
  theme.palette = paletteEntries.slice(0, 10); // cap at 10 swatches

  // Fallback: if no primary found, grab first two distinct hex values
  if (!theme.primaryColor && theme.palette.length >= 1) {
    theme.primaryColor = theme.palette[0].hex;
  }
  if (!theme.secondaryColor && theme.palette.length >= 2) {
    theme.secondaryColor = theme.palette[1].hex;
  }
  if (!theme.accentColor && theme.palette.length >= 3) {
    theme.accentColor = theme.palette[2].hex;
  }

  // Bail if we couldn't extract even a primary color
  if (!theme.primaryColor) return null;

  // ── Typography extraction ────────────────────────────────────────────
  // Patterns: **Heading Font:** Inter, Primary Typeface: "Playfair Display"
  const extractFont = (label, src) => {
    const m = src.match(new RegExp(
      `(?:${label})[^\\n]*?[:\\"'']\\s*["\\'']?([A-Z][A-Za-z0-9 ]+)["\\'']?`,
      'i'
    ));
    return m ? m[1].trim() : null;
  };

  theme.headingFont = extractFont('heading font', text)
                   || extractFont('display font', text)
                   || extractFont('primary typeface', text)
                   || extractFont('primary font', text);

  theme.bodyFont    = extractFont('body font', text)
                   || extractFont('secondary typeface', text)
                   || extractFont('body typeface', text);

  // Google Fonts URL builder (if fonts were found)
  if (theme.headingFont || theme.bodyFont) {
    const fonts = [];
    if (theme.headingFont) fonts.push(theme.headingFont.replace(/ /g, '+') + ':wght@400;600;700;800');
    if (theme.bodyFont && theme.bodyFont !== theme.headingFont)
      fonts.push(theme.bodyFont.replace(/ /g, '+') + ':wght@400;500;600');
    if (fonts.length) {
      theme.googleFontsUrl = `https://fonts.googleapis.com/css2?${fonts.map(f => 'family=' + f).join('&')}&display=swap`;
    }
  }

  // ── Type scale extraction ────────────────────────────────────────────
  const sizePatterns = {
    displaySize:  /(?:display|hero)[^\n]*?(\d{2,3})px/i,
    headingSize:  /(?:h1|heading\s*1|large heading)[^\n]*?(\d{2,3})px/i,
    subheadSize:  /(?:h2|heading\s*2|subhead)[^\n]*?(\d{2,3})px/i,
    bodySize:     /(?:body|paragraph|base)[^\n]*?(\d{2})px/i,
    captionSize:  /(?:caption|small|label)[^\n]*?(\d{2})px/i,
  };
  for (const [key, rx] of Object.entries(sizePatterns)) {
    const m = text.match(rx);
    if (m) theme[key] = parseInt(m[1], 10);
  }

  // Font weight extraction
  const weightM = text.match(/(?:heading|display|title)[^\n]*?(?:font.?weight|weight)[^\n]*?(\d{3})/i);
  if (weightM) theme.headingWeight = parseInt(weightM[1], 10);

  // Line height
  const lhM = text.match(/(?:body|paragraph)[^\n]*?(?:line.?height)[^\n]*?([\d.]+)/i);
  if (lhM) theme.bodyLineHeight = parseFloat(lhM[1]);

  // ── Spacing extraction ───────────────────────────────────────────────
  const spacingM = text.match(/(?:base\s+spacing|spacing\s+unit|grid\s+unit)[^\n]*?(\d+)px/i);
  if (spacingM) theme.spacingUnit = parseInt(spacingM[1], 10);

  const borderRadiusM = text.match(/(?:border.?radius|corner)[^\n]*?(\d+)px/i);
  if (borderRadiusM) theme.borderRadius = parseInt(borderRadiusM[1], 10);

  // ── Dark/light mode ──────────────────────────────────────────────────
  const isDark = /dark\s+mode|dark.?first|dark\s+theme/i.test(text);
  const isLight = /light\s+mode|light.?first|light\s+theme/i.test(text);
  theme.colorMode = isDark ? 'dark' : isLight ? 'light' : 'dark'; // default to dark

  // ── Tagline / brand name (for header display) ────────────────────────
  const taglineM = text.match(/\*\*Tagline:\*\*\s*[*"'']?([^\n*"'']+)[*"'']?/i)
                || text.match(/tagline[:\s]+[*"'']?([^\n*"'']{10,80})[*"'']?/i);
  if (taglineM) theme.tagline = taglineM[1].trim();

  const brandNameM = text.match(/\*\*Brand Name:\*\*\s*([^\n*]+)/i)
                   || text.match(/brand name[:\s]+([^\n]{2,40})/i);
  if (brandNameM) theme.brandName = brandNameM[1].trim();

  return theme;
}

// ─── Brand options markdown parser ────────────────────────────────────────
function parseBrandOptionsMarkdown(text) {
  if (!text || typeof text !== 'string' || text.trim().length < 50) {
    console.warn('[BrandParser] Input too short or empty — returning []');
    return [];
  }

  const emojis  = ['⚡', '🎮', '🔥'];
  const letters = ['A', 'B', 'C'];
  const fallbackColors = [
    ['#4A3AFF', '#FFB833', '#2ECC71'],
    ['#BEFF3A', '#0D0D0D', '#3A86FF'],
    ['#FF6B35', '#1A1A2E', '#00D9FF'],
  ];

  // ── STEP 1: Try strict format first (## DIRECTION A: Brand Name) ──
  // This is the format we explicitly ask agents to use.
  // Also handles variants: em-dash (—), en-dash (–), hyphen (-), colon (:), pipe (|)
  // Also extract the brand name from the heading itself (most reliable source).
  const strictHeadingRe = /^#{1,3}\s*DIRECTION\s+([A-C])\s*(?:[:\u2014\u2013\-|])\s*(.+)/gm;
  const strictMatches = [...text.matchAll(strictHeadingRe)];
  let sections = [];
  let headingNames = {}; // letter → name extracted from heading

  if (strictMatches.length >= 2) {
    // Split text at each matched heading
    for (let i = 0; i < strictMatches.length; i++) {
      const start = strictMatches[i].index + strictMatches[i][0].length;
      const end = (i + 1 < strictMatches.length) ? strictMatches[i + 1].index : text.length;
      sections.push(text.slice(start, end));
      // Clean up the captured name: strip markdown bold, quotes, decorative chars
      headingNames[i] = strictMatches[i][2].trim()
        .replace(/\*+/g, '')           // **bold**
        .replace(/^["'""\u201C\u201D\u2018\u2019]+|["'""\u201C\u201D\u2018\u2019]+$/g, '') // quotes
        .replace(/^\s*═+\s*$/, '')     // decorative lines
        .trim();
    }
    console.log(`[BrandParser] Strict format matched: ${strictMatches.length} directions`);
  }

  // ── STEP 2: Fuzzy fallbacks for older/non-conforming agent outputs ──
  if (!sections.length) {
    sections = text.split(/^#{1,3}\s*(?:[\p{Emoji}\u200d\uFE0F]*\s*)?(?:DIRECTION|OPTION)\s+[A-C]\s*[:\u2014\u2013\-|\s]/mu).slice(1);
  }
  if (!sections.length) {
    sections = text.split(/^#{1,3}\s*(?:[\p{Emoji}\u200d\uFE0F]*\s*)?(?:DIRECTION|OPTION|BRAND(?:\s+OPTION)?|CONCEPT|BRAND\s+DIRECTION)\s+[1-3]\s*[:\u2014\u2013\-|\s]/mu).slice(1);
  }
  if (!sections.length) {
    sections = text.split(/^#{1,3}\s*(?:[\p{Emoji}\u200d\uFE0F]*\s*)?[1-3A-C][.)]\s/mu).slice(1);
  }
  if (!sections.length) {
    sections = text.split(/^\*\*\s*(?:DIRECTION|OPTION|BRAND|CONCEPT)\s+[A-C1-3][:\s]/mu).slice(1);
  }
  if (!sections.length) {
    const hrSections = text.split(/\n---+\n/).filter(s => s.trim().length > 100);
    if (hrSections.length >= 3) sections = hrSections.slice(0, 3);
  }
  if (!sections.length) {
    sections = text.split(/^#{1,3}\s+(?=\S)/m).slice(1).filter(s => s.length > 100);
  }

  if (!sections.length) {
    console.warn('[BrandParser] Could not split into sections. First 200 chars:', text.slice(0, 200));
    return [];
  }

  console.log(`[BrandParser] Parsed ${Math.min(sections.length, 3)} brand sections`);

  return sections.slice(0, 3).map((section, idx) => {
    // ── Brand Name ──
    // Priority 1: Name from strict heading (most reliable)
    // Priority 2: **Brand Name:** or **Name:** label
    // Priority 3: Various fallback formats
    let brandName = headingNames[idx] || '';

    if (!brandName || brandName.length < 2) {
      const nameMatch = section.match(/\*\*(?:Primary\s+)?(?:Brand\s+)?Name:\*\*\s*([^\n*]+)/)
        || section.match(/\*\*(?:Brand|Name|Business):\*\*\s*([^\n*]+)/)
        || section.match(/^\s*["""]([^"""]+)["""]/)
        || section.match(/^\s*[""]([^""]+)[""]/)
        || section.match(/^\s*\*\*([A-Z][^*\n]{2,40})\*\*/)
        || section.match(/^\s*([A-Z][A-Za-z&']+(?:\s+[A-Z&][A-Za-z&']*){0,4})\s*\n/);
      const rawName = nameMatch ? nameMatch[1].trim().replace(/\*+/g, '').replace(/^["'"]+|["'"]+$/g, '') : '';
      brandName = (rawName && rawName.length > 1 && rawName !== '—') ? rawName : '';
    }

    if (!brandName || brandName.length < 2) {
      brandName = `Option ${letters[idx]}`;
      console.warn(`[BrandParser] Could not extract brand name for section ${idx}. First 100 chars:`, section.slice(0, 100));
    }

    // ── Concept / Personality ──
    // Try explicit **Personality:** label first
    let conceptMatch = section.match(/\*\*Personality:\*\*\s*([^\n]+)/);
    // Try Aaker Mapping — "Primary: Competence (reliable, intelligent)" → extract trait
    if (!conceptMatch) {
      const aakerMatch = section.match(/###\s*Aaker\s*Mapping[\s\S]*?\*\*Primary:\*\*\s*([^\n(]+)/);
      if (aakerMatch) conceptMatch = aakerMatch;
    }
    // Try italic subtitle like *The Quiet Authority*
    if (!conceptMatch) conceptMatch = section.match(/^[*_]{1,2}([^*_\n]{5,60})[*_]{1,2}\s*$/m);
    // Try ### subtitle (e.g. ### The Quiet Authority)
    if (!conceptMatch) conceptMatch = section.match(/###\s*\*(.+?)\*/);
    // Last resort: first bold phrase that isn't a known label
    if (!conceptMatch) {
      const boldMatches = [...section.matchAll(/\*\*([^*]{5,50})\*\*/g)];
      const skipLabels = /^(Brand\s*Name|Tagline|Color|Typography|Voice|Target|Position|Logo|Aaker|Primary|Secondary|Formality|Energy|Humor|Sample|Avoids|Demographics|Psycho|Behav|Mood|Imagery|Compet|Head|Body|Rationale)/i;
      const good = boldMatches.find(m => !skipLabels.test(m[1].trim()));
      if (good) conceptMatch = good;
    }
    const concept = conceptMatch ? conceptMatch[1].trim().replace(/\*+/g, '') : `Direction ${letters[idx]}`;

    // ── Tagline ──
    const taglineMatch = section.match(/\*\*(?:Tag\s*line|Slogan|Motto):\*\*\s*\*(.+?)\*/)
      || section.match(/\*\*(?:Tag\s*line|Slogan|Motto):\*\*\s*"([^"]+)"/)
      || section.match(/\*\*(?:Tag\s*line|Slogan|Motto):\*\*\s*([^\n]+)/)
      || section.match(/\n\s*\*([^*\n]{10,80})\*\s*\n/)
      || section.match(/["""]([^"""]{10,80})["""]/);
    const tagline = taglineMatch ? taglineMatch[1].trim().replace(/^["*]+|["*]+$/g, '') : '';

    // ── Colors ──
    const backtickHex = [...section.matchAll(/`#([0-9A-Fa-f]{6})`/g)].map(m => '#' + m[1]);
    const allHex = [...new Set(section.match(/#[0-9A-Fa-f]{6}/g) || [])];
    const rawColors = backtickHex.length >= 2 ? backtickHex : allHex;
    const colors = rawColors.length >= 2 ? rawColors.slice(0, 3) : fallbackColors[idx];

    // ── Voice Attributes ──
    const voiceAttrs = [];
    const voiceExamples = [];

    // Try **Voice Attributes:** comma-separated list first (strict format)
    const voiceAttrMatch = section.match(/\*\*Voice\s*Attributes?:\*\*\s*([^\n]+)/i);
    if (voiceAttrMatch) {
      voiceAttrMatch[1].split(/,\s*/).filter(s => s.length > 2).slice(0, 5).forEach(attr => {
        voiceAttrs.push(attr.trim());
      });
    }

    // Fallback: table format
    if (voiceAttrs.length === 0) {
      const voiceSec = section.match(/##\s*VOICE ATTRIBUTES([\s\S]*?)(?=##|$)/);
      if (voiceSec) {
        const rows = [...voiceSec[1].matchAll(/\|\s*\*\*([^*|]+)\*\*\s*\|[^|]+\|\s*"([^"]+)"/g)];
        rows.forEach(r => {
          if (r[1] !== 'Attribute') {
            voiceAttrs.push(r[1].trim());
            voiceExamples.push(r[2].trim());
          }
        });
      }
    }

    // Fallback: numbered bold traits
    if (voiceAttrs.length === 0) {
      const traitMatches = [...section.matchAll(/\d+\.\s*\*\*([^*]+)\*\*\s*[—–-]\s*([^\n]+)/g)];
      traitMatches.slice(0, 4).forEach(m => {
        voiceAttrs.push(m[1].trim());
        voiceExamples.push(m[2].trim());
      });
    }

    // ── Target Audience ──
    const audienceMatch = section.match(/\*\*Target\s*Audience:\*\*\s*([^\n]+)/)
      || section.match(/\*\*Target\s*(?:Customer|Consumer|Demo(?:graphic)?):\*\*\s*([^\n]+)/);
    const targetAudience = audienceMatch ? audienceMatch[1].trim() : '';

    // ── Positioning ──
    const positionMatch = section.match(/\*\*(?:Market\s*)?Position(?:ing)?:\*\*\s*([^\n]+)/)
      || section.match(/\*\*Competitive\s*(?:Differentiation|Position):\*\*\s*([^\n]+)/);
    const positioning = positionMatch ? positionMatch[1].trim() : '';

    // ── Logo Direction ──
    const logoMatch = section.match(/\*\*Logo\s*(?:Direction|Concept|Type|Brief)?:\*\*\s*([^\n]+(?:\n(?!\*\*)[^\n]+)?)/)
      || section.match(/###\s*Logo\s*Direction[^\n]*\n([^\n]+(?:\n(?!#|\*\*)[^\n]+)?)/);
    const logoDirection = logoMatch ? logoMatch[1].trim().replace(/\n/g, ' ').slice(0, 200) : '';

    // ── Typography ──
    let typoMatch = section.match(/\*\*Typography:\*\*\s*([^\n]+)/)
      || section.match(/\*\*Fonts?:\*\*\s*([^\n]+)/);
    // Fallback: extract **Headlines:** and **Body:** lines from Visual Direction
    if (!typoMatch) {
      const headlineMatch = section.match(/\*\*Headlines?:\*\*\s*([^\n]+)/);
      const bodyMatch = section.match(/\*\*Body:\*\*\s*([^\n]+)/);
      if (headlineMatch || bodyMatch) {
        const parts = [];
        if (headlineMatch) parts.push('Headlines: ' + headlineMatch[1].trim());
        if (bodyMatch) parts.push('Body: ' + bodyMatch[1].trim());
        typoMatch = [null, parts.join(' · ')];
      }
    }
    // Strip markdown asterisks and clean up
    const typography = typoMatch ? typoMatch[1].trim().replace(/\*+/g, '').replace(/\s+/g, ' ') : '';

    return {
      name: `Option ${letters[idx]}: "${brandName}"`,
      brandName,
      concept,
      tagline,
      colors,
      emoji: emojis[idx],
      names: brandName,
      voice: voiceAttrs.slice(0, 2).join(' · ') || concept,
      vibe: concept,
      voiceAttrs,
      voiceExamples,
      targetAudience,
      positioning,
      logoDirection,
      typography,
    };
  });
}

// ─── Gate 1: Foundation / Brand Selection ─────────────────────────────────
function viewGate1() {
  const id    = router.params.id;
  const floor = state.floors.find(f => f.id === id);
  if (!floor) return viewFloorNotFound(id);
  const slide = state.gate1Slide || 0;
  const letters = ['A', 'B', 'C'];

  // Brand data is populated by loadState() — no separate fetch needed here
  const demoBrands = [
    { name: 'Option A', colors: ['#1A1A2E','#D4AF37','#FFFFFF'], emoji: '⚡', names: '—', voice: '—', vibe: '—', tagline: '', brandName: '' },
    { name: 'Option B', colors: ['#F5F0E8','#8B7355','#4A90D9'], emoji: '🌿', names: '—', voice: '—', vibe: '—', tagline: '', brandName: '' },
    { name: 'Option C', colors: ['#0F0F0F','#FF6B35','#00D9FF'], emoji: '🔥', names: '—', voice: '—', vibe: '—', tagline: '', brandName: '' },
  ];
  const realBrands = state.gate1BrandData[id];
  const brandStatus = state.gate1BrandStatus[id] || 'loading';
  const hasRealBrands = realBrands?.length > 0 && realBrands[0]?.brandName && !realBrands[0].brandName.startsWith('Option ');
  const brands = hasRealBrands ? realBrands : demoBrands;
  const isDemo = !hasRealBrands;

  const brand = brands[slide];

  return `
  ${renderTopNav({ back: true, backLabel: `← ${floorDisplayName(floor)} Floor`, title: 'FOUNDATION REVIEW', backOnclick: `router.go('floor', {id:'${floor.id}'})` })}
  <div class="view-narrow">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <div>
        <div class="page-title">Choose Your Brand</div>
        <div class="page-subtitle">Swipe to compare all ${brands.length} directions</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <span class="tag tag-gate">Gate 1 of 3</span>
        <span style="font-size:11px;color:var(--text-3)">Step 1 of 3</span>
      </div>
    </div>

    <div class="glass-elevated" style="padding:28px;margin-bottom:16px">
      <!-- Logo/Mood area with gradient + candidate selector -->
      ${(() => {
        const logoCache = state.gate1BrandLogos[id] || {};
        const letter = letters[slide];
        const candidates = logoCache[letter]; // array of URLs or undefined
        const isLoadingLogos = logoCache._loading;
        const choiceMap = (state.gate1LogoChoice && state.gate1LogoChoice[id]) || {};
        const choiceIdx = choiceMap[letter] || 0;

        if (Array.isArray(candidates) && candidates.length > 0) {
          const currentUrl = candidates[choiceIdx] || candidates[0];
          const hasPrev = choiceIdx > 0;
          const hasNext = choiceIdx < candidates.length - 1;
          return `<div class="brand-mood" style="background:linear-gradient(135deg,${brand.colors[0]}88,${brand.colors[1]}44,${brand.colors[2] || brand.colors[0]}22);position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center">
            <img src="${currentUrl}" alt="${brand.brandName || 'Brand'} logo option ${choiceIdx + 1}" style="max-width:80%;max-height:80%;object-fit:contain;position:relative;z-index:1;border-radius:8px" />
            ${candidates.length > 1 ? `
            <div style="position:absolute;bottom:8px;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:8px;z-index:2">
              <button onclick="if(!state.gate1LogoChoice)state.gate1LogoChoice={};if(!state.gate1LogoChoice['${id}'])state.gate1LogoChoice['${id}']={};state.gate1LogoChoice['${id}']['${letter}']=Math.max(0,(state.gate1LogoChoice['${id}']['${letter}']||0)-1);render()" style="background:rgba(0,0,0,0.5);border:none;color:#fff;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px;opacity:${hasPrev ? '1' : '0.3'}" ${hasPrev ? '' : 'disabled'}>‹</button>
              <div style="display:flex;gap:4px">
                ${candidates.map((_, ci) => `<div style="width:6px;height:6px;border-radius:50%;background:${ci === choiceIdx ? '#fff' : 'rgba(255,255,255,0.35)'}"></div>`).join('')}
              </div>
              <button onclick="if(!state.gate1LogoChoice)state.gate1LogoChoice={};if(!state.gate1LogoChoice['${id}'])state.gate1LogoChoice['${id}']={};state.gate1LogoChoice['${id}']['${letter}']=Math.min(${candidates.length - 1},(state.gate1LogoChoice['${id}']['${letter}']||0)+1);render()" style="background:rgba(0,0,0,0.5);border:none;color:#fff;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px;opacity:${hasNext ? '1' : '0.3'}" ${hasNext ? '' : 'disabled'}>›</button>
            </div>
            <div style="position:absolute;top:8px;right:10px;font-size:10px;color:rgba(255,255,255,0.5);z-index:2">${choiceIdx + 1}/${candidates.length}</div>
            ` : ''}
          </div>`;
        } else if (isLoadingLogos) {
          return `<div class="brand-mood" style="background:linear-gradient(135deg,${brand.colors[0]}88,${brand.colors[1]}44,${brand.colors[2] || brand.colors[0]}22);position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px">
            <div style="font-size:24px;animation:pulse 1.5s ease-in-out infinite">🎨</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.6)">Generating 3 logo options...</div>
          </div>`;
        } else {
          return `<div class="brand-mood" style="background:linear-gradient(135deg,${brand.colors[0]}88,${brand.colors[1]}44,${brand.colors[2] || brand.colors[0]}22);position:relative;overflow:hidden">
            <div style="font-size:48px;position:relative;z-index:1">${brand.emoji}</div>
            ${brand.logoDirection ? `<div style="position:absolute;bottom:8px;left:12px;right:12px;font-size:10px;color:rgba(255,255,255,0.6);z-index:1;line-height:1.3">Logo concept: ${brand.logoDirection.slice(0, 120)}</div>` : ''}
          </div>`;
        }
      })()}

      <!-- Brand name + tagline -->
      <div style="font-size:22px;font-weight:800;margin-bottom:4px;letter-spacing:-0.3px">${brand.brandName || brand.names}</div>
      ${brand.tagline ? `<div style="font-size:14px;color:var(--text-2);font-style:italic;margin-bottom:16px">"${brand.tagline}"</div>` : '<div style="margin-bottom:16px"></div>'}

      <!-- Colors -->
      <div class="color-palette" style="margin-bottom:16px">
        ${brand.colors.map(c => `<div class="color-swatch" style="background:${c};width:36px;height:36px;border-radius:8px" title="${c}"></div>`).join('')}
        <div style="display:flex;gap:8px;align-items:center;margin-left:8px">
          ${brand.colors.map(c => `<span style="font-size:10px;color:var(--text-3);font-family:monospace">${c}</span>`).join('')}
        </div>
      </div>

      <div class="divider"></div>

      <!-- Details grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div>
          <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--text-3);margin-bottom:4px">Personality</div>
          <div style="font-size:13px;color:var(--text-2);line-height:1.4">${brand.concept || '—'}</div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--text-3);margin-bottom:4px">Voice</div>
          <div style="font-size:13px;color:var(--text-2);line-height:1.4">${brand.voice || '—'}</div>
        </div>
        ${brand.targetAudience ? `
        <div>
          <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--text-3);margin-bottom:4px">Target Audience</div>
          <div style="font-size:13px;color:var(--text-2);line-height:1.4">${brand.targetAudience}</div>
        </div>` : ''}
        ${brand.positioning ? `
        <div>
          <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--text-3);margin-bottom:4px">Positioning</div>
          <div style="font-size:13px;color:var(--text-2);line-height:1.4">${brand.positioning}</div>
        </div>` : ''}
        ${brand.typography ? `
        <div style="grid-column:1/-1">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--text-3);margin-bottom:4px">Typography</div>
          <div style="font-size:13px;color:var(--text-2)">${brand.typography}</div>
        </div>` : ''}
      </div>

      <!-- Carousel dots -->
      <div class="carousel-nav">
        ${brands.map((b, i) => `
        <button class="carousel-dot ${i===slide?'active':''}" onclick="state.gate1Slide=${i};render()" title="${b.brandName || ('Option ' + letters[i])}">${b.brandName ? b.brandName.slice(0,1) : (i+1)}</button>
        `).join('')}
      </div>
    </div>

    ${isDemo ? `
    <div class="glass-sm" style="padding:16px;margin-bottom:16px;text-align:center;border:1px solid var(--border)">
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">
        ${brandStatus === 'loading' ? '⏳ Brand Agent is working...' :
          brandStatus === 'parse-failed' ? '⚠️ Brand data could not be parsed' :
          brandStatus === 'no-task' ? '⚠️ Brand options task not created yet' :
          '⏳ Waiting for brand data...'}
      </div>
      <div style="font-size:12px;color:var(--text-3)">
        ${brandStatus === 'loading' ? 'The Brand Agent is generating 3 brand directions. This usually takes 1-2 minutes.' :
          brandStatus === 'parse-failed' ? 'The agent finished but the output format was unexpected. Try refreshing, or delete and re-create the floor.' :
          'Check the activity feed for task status.'}
      </div>
    </div>
    ` : `
    <div style="display:flex;gap:10px;margin-bottom:16px">
      <button class="btn btn-glass" style="flex:1" onclick="state.gate1Slide=Math.max(0,${slide}-1);render()">← Prev</button>
      <button class="btn btn-primary" style="flex:2" onclick="setLocalBrand('${id}', ${slide}); router.go('gate1-voice', {id:'${id}', brand:${slide}})">✓ Pick This</button>
      <button class="btn btn-glass" style="flex:1" onclick="state.gate1Slide=Math.min(${brands.length - 1},${slide}+1);render()">Next →</button>
    </div>
    `}

    <div class="glass-sm" style="padding:14px 16px">
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:8px">OPTIONAL — Mix & Match</div>
      <input class="input" placeholder="I like A's energy but C's colors…" onchange="state.gate1Feedback=this.value">
    </div>

    ${!isDemo ? `
    <div style="text-align:center;margin-top:12px">
      <button class="btn btn-glass" style="font-size:11px;padding:6px 16px;opacity:0.7" onclick="fetchBrandLogos('${id}', state.gate1BrandData['${id}'], true)">
        Regenerate Logos
      </button>
    </div>` : ''}
  </div>`;
}

// ─── Gate 1b: Voice Sample ────────────────────────────────────────────────
function viewGate1Voice() {
  const id = router.params.id;
  const brandIdx = (router.params.brand !== undefined) ? parseInt(router.params.brand) : (localFloorState[id]?.brand ?? 0);
  const brands = state.gate1BrandData?.[id];
  const brand = (brands && brands[brandIdx]) ? brands[brandIdx] : null;

  // ── Brand theming for gate sub-screens ──
  const brandThemeCSS = brand ? getBrandThemeCSS(brand, id) : '';
  document.getElementById('floor-brand-theme')?.remove();

  // Resolve logo URL for the brand mini-header
  const logoUrl = localFloorState[id]?.logoUrl || null;
  const brandColor = brand?.colors?.[0] || '#6366f1';
  const brandColor2 = brand?.colors?.[1] || brandColor;

  // Show real voice examples from the selected brand direction
  const examples = brand?.voiceExamples || [];
  const attrLabels = ['Voice Attribute', 'Tone Example', 'Message Example', 'Content Example'];

  const samplesHtml = examples.length ? examples.slice(0, 4).map((ex, i) => `
    <div class="voice-sample">
      <div class="voice-sample-title">${attrLabels[i] || 'Example'}</div>
      <div class="voice-sample-text">"${ex}"</div>
    </div>`).join('') : `
    <div class="voice-sample">
      <div class="voice-sample-title">Voice Style</div>
      <div class="voice-sample-text">${brand ? `${brand.voice} — ${brand.concept}` : 'Loading voice sample…'}</div>
    </div>`;

  return `
  ${brandThemeCSS}
  ${renderTopNav({ back: true, backLabel: '← Brand Directions', title: 'VOICE SAMPLE', backOnclick: `router.go('gate1', {id:'${id}'})` })}
  <div class="view-narrow floor-branded">
    <div class="floor-brand-ambient" style="position:absolute;inset:0;pointer-events:none;z-index:0"></div>
    <div style="position:relative;z-index:1">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
      <div>
        <div class="page-title">This is your brand's voice</div>
        <div class="page-subtitle">${brand ? `"${brand.brandName}" — ${brand.concept}` : 'Read it. Does it feel right?'}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <span class="tag tag-gate">Gate 1 of 3</span>
        <span style="font-size:11px;color:var(--text-3)">Step 2 of 3</span>
      </div>
    </div>

    ${brand ? `
    <div class="glass-sm" style="padding:14px 18px;margin-bottom:16px;display:flex;gap:12px;align-items:center;border-color:${brandColor}33">
      ${logoUrl
        ? `<div style="width:40px;height:40px;border-radius:10px;flex-shrink:0;overflow:hidden;background:${brandColor}"><img src="${logoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:10px" alt="Logo"></div>`
        : `<div style="font-size:28px">${brand.emoji}</div>`}
      <div>
        <div style="font-size:14px;font-weight:700;color:${brandColor};font-family:var(--brand-font,inherit)">${brand.brandName}</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:2px">${brand.voice}</div>
      </div>
    </div>` : ''}

    <div class="glass" style="padding:28px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-3);margin-bottom:16px">VOICE EXAMPLES FROM BRAND AGENT</div>
      <div style="display:flex;flex-direction:column;gap:16px">
        ${samplesHtml}
      </div>
    </div>

    <div class="btn-row">
      <button class="btn btn-glass" onclick="router.go('gate1', {id:'${id}'})">
        ← Back to Brand
      </button>
      <button class="btn btn-success btn-lg" onclick="router.go('gate1-strategy', {id:'${id}', brand:${brandIdx}})">
        Sounds Right →
      </button>
    </div>
    </div>
  </div>`;
}

// ─── Gate 1c: Strategy & Budget ───────────────────────────────────────────
function viewGate1Strategy() {
  const id = router.params.id;
  const brandIdx = (router.params.brand !== undefined) ? parseInt(router.params.brand) : (localFloorState[id]?.brand ?? 0);
  const floor = state.floors.find(f => f.id === id);
  const brands = state.gate1BrandData?.[id];
  const brand = (brands && brands[brandIdx]) ? brands[brandIdx] : null;

  // ── Brand theming for gate sub-screens ──
  const brandThemeCSS = brand ? getBrandThemeCSS(brand, id) : '';
  document.getElementById('floor-brand-theme')?.remove();
  const brandColor = brand?.colors?.[0] || '#6366f1';
  const logoUrl = localFloorState[id]?.logoUrl || null;

  // Parse key strategy fields from the business-strategy task result
  const strategyRaw = state.gate1StrategyData?.[id] || '';
  function extractStrategy(raw) {
    if (!raw) return null;

    // ── Target customer ──
    // Try explicit label first
    let targetM = raw.match(/\*\*Primary (?:Customer|Market|Segment)[:\s*]*\*\*\s*([^\n]+)/);
    // Try **Target Segments:** or **Target Audience:**
    if (!targetM) targetM = raw.match(/\*\*Target\s*(?:Segment|Audience|Customer)s?[:\s*]*\*\*\s*([^\n]+)/);
    // Try ranked segment table — extract #1 ranked row
    if (!targetM) {
      const rank1 = raw.match(/\*\*A:\s*"([^"]+)"\s*\(([^)]+)\)\*\*/);
      if (rank1) targetM = [null, `${rank1[1]} (${rank1[2]})`];
    }
    // Try age range mention
    if (!targetM) {
      const ageM = raw.match(/(\d{2})[–-](\d{2})[,\s]+([^|.\n]{5,60})/);
      if (ageM) targetM = [null, `Ages ${ageM[1]}-${ageM[2]}, ${ageM[3].trim()}`];
    }

    // ── Top channel ──
    // Table format: | **1** | **Instagram (Organic)** | ...
    let channelM = raw.match(/\|\s*\*\*1\*\*\s*\|\s*\*\*([^*|]+)\*\*/);
    // Emoji table format: | **🥇 1** | **Channel** |
    if (!channelM) channelM = raw.match(/\|\s*\*\*🥇\s*1\*\*\s*\|\s*\*\*([^*|]+)\*\*/);
    // Text mention: "#1 channel", "top channel", "primary channel"
    if (!channelM) channelM = raw.match(/(?:#1|top|primary)\s+(?:paid\s+)?(?:acquisition\s+)?channel[^:]*:\s*\*?\*?([^*\n|,]+)/i);
    if (!channelM) channelM = raw.match(/\*\*(?:Top|Primary|#1)\s*Channel[:\s*]*\*\*\s*([^\n]+)/i);
    // Fallback: Meta or Instagram mentioned as #1
    if (!channelM) {
      const metaM = raw.match(/(?:Meta|Instagram)\s*\([^)]*\)\s*(?:remains|is)\s*(?:the\s*)?#1/);
      if (metaM) channelM = [null, metaM[0].split(/\s*(?:remains|is)/)[0].trim()];
    }

    // ── Pricing / Competitors ──
    let pricingM = raw.match(/\*\*(?:Pricing|Price\s*Point|Competitive\s*Set)[:\s*]*\*\*\s*([^\n]+)/i);
    if (!pricingM) pricingM = raw.match(/\*\*(?:Premium[^*]*|Free Tier)[^*]*\*\*[:\s]+([^\n]+)/);
    // Try competitor names from table rows: | **Name** | description |
    // Filter out channel names, KPI labels, and numbered rows
    if (!pricingM) {
      const skipCompetitor = /^(?:Instagram|TikTok|Meta|Facebook|Pinterest|Etsy Store|Shopify|Email|Micro.Influencer|Monthly|Orders|Conversion|Customer|Social|Email List|Average|LTV|CAC|KPI|Metric|Channel|Month|Week|Milestone|Revenue|Detail)/i;
      const competitors = [...raw.matchAll(/\|\s*\*\*([A-Z][^*|]{2,40})\*\*(?:\s*\([^)]*\))?\s*\|/g)]
        .map(m => m[1].trim())
        .filter(n => n.length > 2 && !/^[\d🥇🥈🥉]/.test(n) && !skipCompetitor.test(n))
        .slice(0, 4);
      if (competitors.length >= 2) pricingM = [null, competitors.join(', ')];
    }
    // Try "competitor" mentions with bold names: **Name** — description
    if (!pricingM) {
      const competitors = [...raw.matchAll(/\*\*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:\s*\/\s*[A-Z][a-z]+)*)\*\*\s*[—–|-]\s/g)]
        .map(m => m[1]).filter(n => n.length > 2).slice(0, 5);
      if (competitors.length >= 2) pricingM = [null, competitors.join(', ')];
    }

    // ── Revenue goal ──
    // Try 12-month target with dollar range: "**12-Month Targets:** ... $8,000-$14,000 revenue"
    let goalM = raw.match(/12.Month\s*Targets?:?\*?\*?\s*([^\n]*\$[\d,]+-?\$?[\d,]*[^\n]{0,40})/i);
    // Try any line with "$X-$Y revenue"
    if (!goalM) goalM = raw.match(/(\$[\d,]+-\$[\d,]+\s*revenue[^\n]*)/i);
    // Try $X/mo or $X/month format
    if (!goalM) goalM = raw.match(/\$[\d,]+[kK]?\s*\/\s*(?:mo|month)[^\n]*/i);
    // Try "revenue: $X" on same line (no multiline)
    if (!goalM) goalM = raw.match(/revenue[^:\n]*:\s*\$[\d,]+[kK]?[^\n]*/i);
    // Try "Month 12:" on same line with dollar amount (fixed: no multiline)
    if (!goalM) goalM = raw.match(/Month\s*12[^:\n]*:\s*([^\n]*\$[\d,]+[^\n]*)/);
    // Try Monthly Revenue row in KPI table
    if (!goalM) {
      const revRow = raw.match(/\*\*Monthly Revenue\*\*[^|]*\|[^|]*\|[^|]*\|\s*\$?([\d,$\-–\s]+)/);
      if (revRow) goalM = [null, revRow[1].trim() + '/mo (Month 12)'];
    }

    return {
      target: targetM ? targetM[1].trim().replace(/\*+/g, '').slice(0, 80) : null,
      channel: channelM ? channelM[1].trim().replace(/\*+/g, '').slice(0, 60) : null,
      pricing: pricingM ? pricingM[1].trim().replace(/\*+/g, '').slice(0, 80) : null,
      goal: goalM ? (goalM[1] || goalM[0]).trim().replace(/\*+/g, '').slice(0, 80) : null,
    };
  }
  const strategy = extractStrategy(strategyRaw);

  // Budget from real floor data (editable)
  const budgetCents = floor?.budgetCeilingCents || 25000;
  const budgetDollars = Math.round(budgetCents / 100);
  const buildCost = Math.round(budgetDollars * 0.15);
  const monthlyOps = Math.round(budgetDollars * 0.25);
  // Budget tier options
  const budgetTiers = [
    { cents: 10000, label: '$100 — Lean' },
    { cents: 25000, label: '$250 — Standard' },
    { cents: 50000, label: '$500 — Growth' },
    { cents: 60000, label: '$600 — Full' },
    { cents: 100000, label: '$1,000 — Premium' },
  ];

  const strategyRows = [
    ['Business', floor?.name || '—'],
    ['Goal', floor?.goal || '—'],
    ['Target', strategy?.target || 'Defined by strategy agent'],
    ['Top Channel', strategy?.channel || 'Defined by strategy agent'],
    ['Pricing', strategy?.pricing || 'Defined by strategy agent'],
    ['Revenue Goal', strategy?.goal || 'Defined by strategy agent'],
  ].filter(([,v]) => v !== '—');

  return `
  ${brandThemeCSS}
  ${renderTopNav({ back: true, backLabel: '← Voice Sample', title: 'STRATEGY & BUDGET', backOnclick: `router.go('gate1-voice', {id:'${id}', brand:${brandIdx}})` })}
  <div class="view-narrow floor-branded">
    <div class="floor-brand-ambient" style="position:absolute;inset:0;pointer-events:none;z-index:0"></div>
    <div style="position:relative;z-index:1">

    ${brand ? `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid ${brandColor}33">
      ${logoUrl
        ? `<div style="width:36px;height:36px;border-radius:10px;flex-shrink:0;overflow:hidden;background:${brandColor}"><img src="${logoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:10px" alt="Logo"></div>`
        : `<div style="font-size:24px">${brand.emoji}</div>`}
      <div>
        <div style="font-size:16px;font-weight:700;color:${brandColor};font-family:var(--brand-font,inherit)">${brand.brandName}</div>
        <div style="font-size:11px;color:var(--text-3);font-style:italic">"${brand.tagline}"</div>
      </div>
    </div>` : ''}

    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
      <div>
        <div class="page-title">The Plan</div>
        <div class="page-subtitle">Review before we start building everything</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <span class="tag tag-gate">Gate 1 of 3</span>
        <span style="font-size:11px;color:var(--text-3)">Step 3 of 3</span>
      </div>
    </div>

    <div class="glass" style="padding:24px;margin-bottom:16px">
      <div class="section-label" style="margin-bottom:14px">STRATEGY SUMMARY</div>
      ${strategyRows.map(([l, v]) => `
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
        <span style="font-size:13px;color:var(--text-3);font-weight:600;flex-shrink:0;margin-right:12px">${l}</span>
        <span style="font-size:13px;color:var(--text-1);font-weight:500;text-align:right">${v}</span>
      </div>`).join('')}
    </div>

    <div class="glass" style="padding:24px;margin-bottom:16px">
      <div class="section-label" style="margin-bottom:14px">BUDGET</div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
        <span style="font-size:13px;color:var(--text-2)">Total budget</span>
        <select id="budget-select" onchange="updateFloorBudget('${id}', this.value)" style="background:rgba(255,255,255,0.08);color:var(--text-1);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:6px 12px;font-size:14px;font-weight:700;cursor:pointer;text-align:right">
          ${budgetTiers.map(t => `<option value="${t.cents}" ${t.cents === budgetCents ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </div>
      ${[
        ['Estimated build cost', `~$${buildCost}`],
        ['Monthly ops', `~$${monthlyOps}/mo`],
      ].map(([l, v]) => `
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
        <span style="font-size:13px;color:var(--text-2)">${l}</span>
        <span style="font-size:15px;font-weight:700;color:var(--text-1)">${v}</span>
      </div>`).join('')}
    </div>

    <button class="btn btn-success btn-lg btn-full" onclick="approveFoundation('${id}')">
      Approve Foundation — Start Building
    </button>
    <div style="text-align:center;margin-top:12px">
      <span class="tag tag-gate">Gate 1 of 3</span>
    </div>
    </div>
  </div>`;
}

async function updateFloorBudget(id, cents) {
  const val = parseInt(cents, 10);
  if (!val || val < 1000) return;
  const result = await api('PATCH', `/api/floors/${id}`, { budgetCeilingCents: val });
  if (result) {
    const idx = state.floors.findIndex(f => f.id === id);
    if (idx >= 0) state.floors[idx].budgetCeilingCents = val;
    toast(`Budget updated to $${Math.round(val / 100)}`, 'success');
    render();
  } else {
    toast('Failed to update budget', 'error');
  }
}

async function approveFoundation(id) {
  toast('Approving foundation… agents queuing up.', 'info');

  // Send the selected brand direction to the backend before approving
  const brandIdx = getLocalBrand(id) || 0;
  const brands = state.gate1BrandData?.[id] || [];
  const brand = brands[brandIdx] || null;

  // Validate brand data is real (not placeholder demo data)
  const PLACEHOLDER_NAMES = ['—', '–', '-', '', 'Option A', 'Option B', 'Option C'];
  const brandName = brand?.brandName || brand?.name || '';
  if (!brand || PLACEHOLDER_NAMES.includes(brandName.trim())) {
    toast('Brand data not loaded yet — please wait for agents to finish the Foundation Sprint, then try again.', 'error');
    return;
  }

  const patchResult = await api('PATCH', `/api/floors/${id}`, {
    selectedBrand: {
      index: brandIdx,
      name: brandName,
      tagline: brand.tagline || '',
      personality: brand.concept || '',
      voiceAttributes: brand.voiceAttrs || [],
    },
  });

  if (!patchResult) {
    toast('Failed to save brand selection — the server may have rejected the data. Check that the Brand Agent has finished and try again.', 'error');
    return;
  }

  // Approve Gate 3 (Foundation Sprint) — seeds Phase 4 tasks on backend
  const result = await api('POST', `/api/floors/${id}/approve-gate/3`, {});

  // Advance phase locally for instant UI feedback
  const nextPhase = (result && result.nextPhase) ? result.nextPhase : 4;
  setLocalPhase(id, nextPhase);

  // Update in-memory state immediately
  const floorIdx = state.floors.findIndex(f => f.id === id);
  if (floorIdx >= 0) {
    state.floors[floorIdx] = { ...state.floors[floorIdx], currentPhase: nextPhase, status: 'building' };
  }

  toast('Foundation approved! Phase 4 agents are now building your business.', 'success');
  router.go('floor', { id });
}

// simulateProgress removed — replaced by Supabase Realtime in initRealtime()

let supabaseClient = null;

async function initRealtime() {
  try {
    // Fetch public config (Supabase URL + anon key)
    const config = await api('GET', '/api/config/public');
    if (!config || !config.supabaseUrl || !config.supabaseAnonKey) {
      console.log('[Realtime] Supabase not configured — using polling only');
      return;
    }

    // Lazy-load the Supabase JS client from CDN
    if (!window.supabase) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
        script.type = 'module';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    // Import and create client
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey);

    // Subscribe to floor changes
    supabaseClient.channel('floors')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'floors' }, (payload) => {
        const updated = payload.new;
        if (!updated) return;
        const idx = state.floors.findIndex(f => f.id === updated.id);
        const mapped = {
          ...updated,
          currentPhase: updated.current_phase ?? updated.currentPhase,
          brandState: updated.brand_state ?? updated.brandState,
          budgetCeilingCents: updated.budget_ceiling_cents ?? updated.budgetCeilingCents,
          spentCents: updated.spent_cents ?? updated.spentCents,
          createdAt: updated.created_at ?? updated.createdAt,
        };
        if (idx > -1) state.floors[idx] = { ...state.floors[idx], ...mapped };
        else state.floors.push(mapped);
        if (['tower', 'floor'].includes(router.current)) render();
      })
      .subscribe();

    // Subscribe to task changes (for activity feed updates)
    supabaseClient.channel('tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        // Re-fetch real task data and rebuild activity
        loadState().then(() => {
          if (['tower', 'floor'].includes(router.current)) render();
        });
      })
      .subscribe();

    console.log('✅ EVE realtime LIVE — Supabase subscribed');
  } catch (err) {
    console.log('[Realtime] Could not init Supabase realtime:', err.message);
  }
}

// ─── Content Production Review (Phase 5 Gate) ─────────────────────────────
function viewContentProduction() {
  const id    = router.params.id;
  const floor = state.floors.find(f => f.id === id);
  if (!floor) return viewFloorNotFound(id);
  const color = floorBrandColor(floor);
  const bName = floorDisplayName(floor);

  // Pull real content data from completed phase 5 tasks
  const tasks = state.floorTasks[id] || [];
  const calendarTask    = tasks.find(t => t.taskType === 'content-calendar'        && t.status === 'completed');
  const emailTask       = tasks.find(t => t.taskType === 'email-welcome-sequence'  && t.status === 'completed');
  const videoScriptTask = tasks.find(t => t.taskType === 'promo-video-script'      && t.status === 'completed');
  const copyTask        = tasks.find(t => t.taskType === 'brand-voice-guide'       && t.status === 'completed');
  const hasRealData     = !!(calendarTask || emailTask || videoScriptTask || copyTask);

  // Build deliverable list
  const deliverables = [
    { icon: '📅', name: 'Content Calendar',      task: calendarTask,    ready: !!calendarTask },
    { icon: '📧', name: 'Email Welcome Sequence', task: emailTask,       ready: !!emailTask },
    { icon: '🎬', name: 'Promo Video Script',     task: videoScriptTask, ready: !!videoScriptTask },
    { icon: '✍️', name: 'Brand Voice Guide',      task: copyTask,        ready: !!copyTask },
  ];
  const readyCount   = deliverables.filter(d => d.ready).length;
  const pendingCount = deliverables.length - readyCount;

  // Preview snippet from the most information-rich completed task
  const previewTask   = calendarTask || emailTask || videoScriptTask || copyTask;
  const previewText   = previewTask?.result?.slice(0, 600) || null;

  return `
  ${renderTopNav({ back: true, backLabel: `← ${bName} Floor`, title: 'CONTENT REVIEW', backOnclick: `router.go('floor', {id:'${floor.id}'})` })}
  <div class="view-narrow">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <div>
        <div class="page-title">Content Production</div>
        <div class="page-subtitle">${hasRealData ? 'Review your content deliverables before launch' : 'Content agents are still working — check back soon'}</div>
      </div>
      <span class="tag tag-gate">Gate 2 of 3</span>
    </div>

    <!-- Deliverables status grid -->
    <div class="glass" style="padding:20px;margin-bottom:16px">
      <div class="section-label" style="margin-bottom:14px">CONTENT DELIVERABLES</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px">
        ${deliverables.map(d => `
        <div style="
          display:flex;align-items:center;gap:12px;padding:14px;
          background:${d.ready ? 'rgba(16,185,129,0.06)' : 'rgba(255,255,255,0.03)'};
          border:1px solid ${d.ready ? 'rgba(16,185,129,0.25)' : 'var(--border)'};
          border-radius:var(--radius-sm);
        ">
          <div style="font-size:22px;flex-shrink:0">${d.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--text-1)">${d.name}</div>
            <div style="font-size:11px;color:${d.ready ? '#10b981' : 'var(--text-3)'};margin-top:2px">${d.ready ? '✅ Ready' : '⏳ Building…'}</div>
          </div>
        </div>`).join('')}
      </div>

      <!-- Summary counts -->
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
        <div style="text-align:center;padding:12px;background:rgba(16,185,129,0.1);border-radius:var(--radius-sm);border:1px solid rgba(16,185,129,0.2)">
          <div style="font-size:11px;color:var(--text-3);font-weight:600">READY</div>
          <div style="font-size:22px;font-weight:800;color:#10b981">${readyCount}</div>
        </div>
        <div style="text-align:center;padding:12px;background:rgba(245,158,11,0.1);border-radius:var(--radius-sm);border:1px solid rgba(245,158,11,0.2)">
          <div style="font-size:11px;color:var(--text-3);font-weight:600">PENDING</div>
          <div style="font-size:22px;font-weight:800;color:#f59e0b">${pendingCount}</div>
        </div>
      </div>
    </div>

    ${previewText ? `
    <div class="glass" style="padding:20px;margin-bottom:16px">
      <div class="section-label" style="margin-bottom:12px">CONTENT PREVIEW</div>
      <div style="font-size:13px;color:var(--text-2);line-height:1.6;white-space:pre-wrap;max-height:220px;overflow-y:auto;font-family:var(--font-mono,monospace)">${previewText.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
    </div>` : `
    <div class="glass" style="padding:20px;margin-bottom:16px;text-align:center">
      <div style="font-size:32px;margin-bottom:10px">✍️</div>
      <div style="font-size:14px;font-weight:600;color:var(--text-2)">Content is being written</div>
      <div style="font-size:13px;color:var(--text-3);margin-top:6px">Copy Agent, Video Agent, and Social Agent are working. Check back soon.</div>
    </div>`}

    <div class="btn-row">
      <button class="btn btn-glass" onclick="requestChanges('content-production','${id}')">✏️ Request Changes</button>
      <button class="btn btn-success btn-lg" onclick="approveContentProduction('${id}')" ${readyCount === 0 ? 'style="opacity:0.5"' : ''}>
        ✅ Approve Content
      </button>
    </div>
    <div style="text-align:center;margin-top:12px;font-size:12px;color:var(--text-3)">
      Approving unlocks Staging & QA (Gate 2 of 3)
    </div>
  </div>`;
}

async function approveContentProduction(id) {
  toast('Approving content production…', 'info');
  const result = await api('POST', `/api/floors/${id}/approve-gate/5`, {});
  if (result?.success || result) {
    const nextPhase = result?.nextPhase || 6;
    setLocalPhase(id, nextPhase);
    const floorIdx = state.floors.findIndex(f => f.id === id);
    if (floorIdx !== -1) {
      state.floors[floorIdx] = { ...state.floors[floorIdx], currentPhase: nextPhase };
    }
    await loadState();
    toast('Content approved! Moving to Staging & QA.', 'success');
    router.go('floor', { id });
  } else {
    toast('Approval failed — try again.', 'error');
  }
}

// ─── Gate 2: Staging & QA Review ──────────────────────────────────────────
function viewGate2() {
  const id    = router.params.id;
  const floor = state.floors.find(f => f.id === id);
  if (!floor) return viewFloorNotFound(id);
  const color = floorBrandColor(floor);
  const bName = floorDisplayName(floor);

  // Pull real QA data from completed phase 6 tasks
  const tasks = state.floorTasks[id] || [];
  const stagingTask = tasks.find(t => t.taskType === 'staging-review' && t.status === 'completed');
  const copyReviewTask = tasks.find(t => t.taskType === 'copy-review' && t.status === 'completed');
  const hasRealData = !!(stagingTask?.result || copyReviewTask?.result);

  // Extract QA items from staging review result
  const qaItems = [];
  if (stagingTask?.result) {
    const lines = stagingTask.result.split('\n');
    for (const line of lines) {
      const passMatch = line.match(/(?:✅|pass|PASS|✓)\s*[:\-—]?\s*(.+)/);
      const failMatch = line.match(/(?:❌|fail|FAIL|✗)\s*[:\-—]?\s*(.+)/);
      if (passMatch) qaItems.push({ pass: true, text: passMatch[1].trim().slice(0, 80) });
      else if (failMatch) qaItems.push({ pass: false, text: failMatch[1].trim().slice(0, 80) });
    }
  }
  // Fallback QA items if no real data yet
  if (qaItems.length === 0) {
    qaItems.push(
      { pass: null, text: 'Pages load correctly' },
      { pass: null, text: 'Mobile responsive' },
      { pass: null, text: 'SEO meta tags present' },
      { pass: null, text: 'Analytics tracking installed' },
      { pass: null, text: 'Brand consistency verified' },
      { pass: null, text: 'Legal pages present' },
    );
  }

  const passCount = qaItems.filter(q => q.pass === true).length;
  const failCount = qaItems.filter(q => q.pass === false).length;
  const pendingCount = qaItems.filter(q => q.pass === null).length;

  return `
  ${renderTopNav({ back: true, backLabel: `← ${bName} Floor`, title: 'STAGING & QA REVIEW', backOnclick: `router.go('floor', {id:'${floor.id}'})` })}
  <div class="view-narrow">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <div>
        <div class="page-title">Staging & QA Review</div>
        <div class="page-subtitle">${hasRealData ? 'QA agents have reviewed your site' : 'QA review in progress — results will appear here'}</div>
      </div>
      <span class="tag tag-gate">Gate 2 of 3</span>
    </div>

    <div class="glass" style="padding:0;overflow:hidden;margin-bottom:16px;border-radius:var(--radius-lg)">
      <div style="background:rgba(255,255,255,0.05);padding:12px 16px;display:flex;gap:8px;border-bottom:1px solid var(--border)">
        <div style="width:10px;height:10px;border-radius:50%;background:#ef4444;opacity:0.8"></div>
        <div style="width:10px;height:10px;border-radius:50%;background:#f59e0b;opacity:0.8"></div>
        <div style="width:10px;height:10px;border-radius:50%;background:#10b981;opacity:0.8"></div>
        <div style="flex:1;background:rgba(255,255,255,0.07);border-radius:6px;height:22px;margin:0 8px;
                    display:flex;align-items:center;padding:0 10px;font-size:11px;color:var(--text-3)">
          ${bName.toLowerCase().replace(/\\s+/g, '')}.com (staging preview)
        </div>
      </div>
      <div style="width:100%;height:200px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;
                  background:linear-gradient(135deg,rgba(26,26,46,0.8),${color}22)">
        <div style="font-size:40px">🌐</div>
        <div style="font-size:20px;font-weight:800;color:${color}">${bName.toUpperCase()}</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.5)">${floor.goal || ''}</div>
      </div>
    </div>

    <div class="glass" style="padding:20px;margin-bottom:16px">
      <div class="section-label" style="margin-bottom:12px">QA RESULTS</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
        <div style="text-align:center;padding:12px;background:rgba(16,185,129,0.1);border-radius:var(--radius-sm);border:1px solid rgba(16,185,129,0.2)">
          <div style="font-size:11px;color:var(--text-3);font-weight:600">PASS</div>
          <div style="font-size:22px;font-weight:800;color:#10b981">${passCount}</div>
        </div>
        <div style="text-align:center;padding:12px;background:rgba(239,68,68,0.1);border-radius:var(--radius-sm);border:1px solid rgba(239,68,68,0.2)">
          <div style="font-size:11px;color:var(--text-3);font-weight:600">FAIL</div>
          <div style="font-size:22px;font-weight:800;color:#ef4444">${failCount}</div>
        </div>
        <div style="text-align:center;padding:12px;background:rgba(245,158,11,0.1);border-radius:var(--radius-sm);border:1px solid rgba(245,158,11,0.2)">
          <div style="font-size:11px;color:var(--text-3);font-weight:600">${pendingCount > 0 ? 'PENDING' : 'TOTAL'}</div>
          <div style="font-size:22px;font-weight:800;color:#f59e0b">${pendingCount > 0 ? pendingCount : qaItems.length}</div>
        </div>
      </div>
      <div class="checklist">
        ${qaItems.map(q => `
        <div class="checklist-item ${q.pass === true ? 'pass' : q.pass === false ? 'fail' : ''}">
          <span class="checklist-icon">${q.pass === true ? '✅' : q.pass === false ? '❌' : '⏳'}</span>
          <span>${q.text}</span>
        </div>`).join('')}
      </div>
    </div>

    ${copyReviewTask?.result ? `
    <div class="glass" style="padding:20px;margin-bottom:16px">
      <div class="section-label" style="margin-bottom:12px">COPY REVIEW</div>
      <div style="font-size:13px;color:var(--text-2);line-height:1.6;white-space:pre-wrap;max-height:200px;overflow-y:auto">${copyReviewTask.result.slice(0, 800)}</div>
    </div>` : ''}

    <div class="btn-row">
      <button class="btn btn-glass" onclick="requestChanges('gate2','${id}')">✏️ Request Changes</button>
      <button class="btn btn-success btn-lg" onclick="approveSite('${id}')">✅ Approve & Launch</button>
    </div>
  </div>`;
}

async function requestChanges(gate, id) {
  const feedback = prompt('What changes would you like?');
  if (!feedback) return;
  toast('Sending revision request to agents…', 'info');
  const result = await api('POST', `/api/floors/${id}/feedback`, {
    message: `[OWNER-REVISION][${gate}] ${feedback}`,
    source: 'owner',
  });
  if (result && !result.error) {
    await loadState();
    toast('Revision request sent — agents will review and update.', 'success');
  } else {
    toast('Failed to send revision request.', 'error');
  }
}

async function approveSite(id) {
  toast('Approving site…', 'info');
  const result = await api('POST', `/api/floors/${id}/approve-gate/6`, {});
  if (result?.success) {
    const nextPhase = result.nextPhase || 7;
    setLocalPhase(id, nextPhase);
    const floorIdx = state.floors.findIndex(f => f.id === id);
    if (floorIdx !== -1) state.floors[floorIdx] = { ...state.floors[floorIdx], currentPhase: nextPhase };
    await loadState();
    toast('Site approved! Moving to Launch phase.', 'success');
    router.go('floor', { id });
  } else {
    toast('Site approval failed — try again.', 'error');
  }
}

// ─── Gate 3: Ad Campaign Approval ────────────────────────────────────────
function viewGate3() {
  const id    = router.params.id;
  const floor = state.floors.find(f => f.id === id);
  if (!floor) return viewFloorNotFound(id);
  const color = floorBrandColor(floor);
  const bName = floorDisplayName(floor);

  // Pull real ad campaign data from completed tasks
  const tasks = state.floorTasks[id] || [];
  const adCampaignTask = tasks.find(t => t.taskType === 'launch-ad-campaign' && t.status === 'completed');
  const adCreativeTask = tasks.find(t => t.taskType === 'ad-creative-production' && t.status === 'completed');
  const hasRealData = !!(adCampaignTask?.result || adCreativeTask?.result);

  // Extract ad concepts from campaign plan
  const adConcepts = [];
  const sourceResult = adCreativeTask?.result || adCampaignTask?.result || '';
  if (sourceResult) {
    // Parse headline/body pairs from agent output
    const headlineMatches = sourceResult.matchAll(/(?:headline|concept|creative)\s*(?:\d+)?[:\s]*[""](.{5,80})[""]/gi);
    for (const m of headlineMatches) {
      if (adConcepts.length < 3) adConcepts.push({ headline: m[1].trim(), body: '', cta: 'Shop Now' });
    }
    // Try to extract body text near each headline
    const bodyMatches = sourceResult.matchAll(/(?:body|description|copy)[:\s]*[""](.{10,150})[""]/gi);
    let bi = 0;
    for (const m of bodyMatches) {
      if (bi < adConcepts.length) { adConcepts[bi].body = m[1].trim(); bi++; }
    }
  }
  // Fallback if no real ads extracted
  if (adConcepts.length === 0) {
    adConcepts.push(
      { headline: `Discover ${bName}`, body: floor.goal || 'Your next favorite brand.', cta: 'Learn More' },
      { headline: `Why ${bName}?`, body: 'See what makes us different.', cta: 'Shop Now' },
      { headline: `Join ${bName}`, body: 'Be part of something new.', cta: 'Get Started' },
    );
  }

  // Extract campaign details from ad plan
  const extractField = (label) => {
    if (!adCampaignTask?.result) return null;
    const m = adCampaignTask.result.match(new RegExp(label + '[:\\s]*(.{3,80})', 'i'));
    return m ? m[1].trim().replace(/[*#]/g, '') : null;
  };
  const budget = floor.budgetCeilingCents
    ? `$${Math.round(floor.budgetCeilingCents / 100 * 0.4)}/month (40% of budget)`
    : extractField('daily budget|budget') || 'Set by Ads Agent';
  const audience = extractField('audience|target') || 'Defined by strategy';
  const platform = extractField('platform') || 'Meta + TikTok';

  const slide = state.gate3Slide || 0;
  const ad = adConcepts[slide % adConcepts.length];

  return `
  ${renderTopNav({ back: true, backLabel: `← ${bName} Floor`, title: 'AD CAMPAIGNS', backOnclick: `router.go('floor', {id:'${floor.id}'})` })}
  <div class="view-narrow">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <div>
        <div class="page-title">Ad Campaigns</div>
        <div class="page-subtitle">${hasRealData ? 'Review your ad creatives' : 'Ad plan preview — real creatives will appear after Phase 7'}</div>
      </div>
      <span class="tag tag-gate">Gate 3 of 3</span>
    </div>

    <div class="glass-elevated" style="padding:28px;margin-bottom:16px">
      <div style="width:100%;height:200px;border-radius:var(--radius);
                  background:linear-gradient(135deg,rgba(26,26,46,0.9),${color}22);
                  display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;
                  margin-bottom:20px;border:1px solid ${color}33">
        <div style="font-size:19px;font-weight:800;color:${color};text-align:center;padding:0 20px">${ad.headline}</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.6);text-align:center;padding:0 30px;line-height:1.5">${ad.body}</div>
        <div style="padding:8px 20px;background:${color};color:#1A1A2E;border-radius:6px;font-weight:700;font-size:12px;margin-top:4px">${ad.cta}</div>
      </div>

      <div class="carousel-nav" style="margin-bottom:0">
        ${adConcepts.map((_,i) => `<button class="carousel-dot ${i===slide?'active':''}" onclick="state.gate3Slide=${i};render()"></button>`).join('')}
      </div>
    </div>

    <div class="glass" style="padding:22px;margin-bottom:16px">
      <div class="section-label" style="margin-bottom:14px">CAMPAIGN OVERVIEW</div>
      ${[
        ['Platform',  platform],
        ['Budget',    budget],
        ['Audience',  audience],
        ['Creatives', `${adConcepts.length} ad concepts`],
      ].map(([l,v]) => `
      <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
        <span style="font-size:13px;color:var(--text-3);font-weight:600">${l}</span>
        <span style="font-size:13px;color:var(--text-1)">${v}</span>
      </div>`).join('')}
    </div>

    <div style="padding:14px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);
                border-radius:var(--radius-sm);margin-bottom:20px;font-size:13px;color:var(--text-2)">
      ⚠️ After approving, campaigns go live immediately. Budget will begin spending.
    </div>

    <div class="btn-row">
      <button class="btn btn-glass" onclick="requestChanges('gate3','${id}')">✏️ Request Changes</button>
      <button class="btn btn-success btn-lg" onclick="launchAds('${id}')">🚀 Launch Ads</button>
    </div>

    <div style="text-align:center;margin-top:12px;font-size:13px;color:var(--text-3)">
      Gate 3 of 3 — After this, your business is live
    </div>
  </div>`;
}

async function launchAds(id) {
  toast('Launching ad campaigns…', 'info');
  const result = await api('POST', `/api/floors/${id}/approve-gate/8`, {});
  if (result?.success) {
    const nextPhase = result.nextPhase || 9;
    setLocalPhase(id, nextPhase);
    const floorIdx = state.floors.findIndex(f => f.id === id);
    if (floorIdx !== -1) state.floors[floorIdx] = { ...state.floors[floorIdx], currentPhase: nextPhase, status: 'live' };
    // Also set floor status to live
    await api('PATCH', `/api/floors/${id}`, { status: 'live' });
    await loadState();
    toast('Ad campaigns launched! Your business is live!', 'success');
    router.go('floor', { id });
  } else {
    toast('Launch failed — check console for details and try again.', 'error');
  }
}

// ─── Weekly Summary ───────────────────────────────────────────────────────
function viewWeekly() {
  const id    = router.params.id;
  const floor = state.floors.find(f => f.id === id);
  if (!floor) return viewFloorNotFound(id);

  const improvements = state.improvements.filter(i => i.floorId === id);

  // Load real stats async and cache on state
  if (!state._weeklyStats || state._weeklyStats.floorId !== id) {
    state._weeklyStats = { floorId: id, loading: true };
    api('GET', `/api/floors/${id}/stats`).then(stats => {
      state._weeklyStats = { ...stats, loading: false };
      render();
    }).catch(() => { state._weeklyStats = { floorId: id, loading: false, error: true }; render(); });
  }

  const s = state._weeklyStats;
  const loading = s?.loading;

  const _spentCents = s?.budget?.spentCents ?? floor.spentCents ?? 0;
  const _budgetCents = s?.budget?.ceilingCents ?? floor.budgetCeilingCents ?? 0;
  const completedTasks = s?.tasks?.completed ?? 0;
  const totalTasks = s?.tasks?.total ?? 0;
  const failedTasks = s?.tasks?.failed ?? 0;
  const activeT = s?.tasks?.active ?? 0;
  const weekTasks = s?.tasks?.completedThisWeek ?? 0;
  const phasesDone = s?.completedPhases ?? 0;
  const totalPhases = s?.totalPhases ?? 10;
  const trustLevel = s?.trustLevel ?? 1;
  const cycle = s?.growthCycle ?? 0;

  // Agent utilization
  const agentUtil = s?.agentUtilization || {};
  const agentEntries = Object.entries(agentUtil).sort((a, b) => b[1] - a[1]);

  // Recent completed tasks as highlights
  const floorTasks = (state.floorTasks?.[id] || []);
  const recentCompleted = floorTasks
    .filter(t => t.status === 'completed' && t.completedAt)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    .slice(0, 5);

  return `
  ${renderTopNav({ back: true, backLabel: floorDisplayName(floor), title: 'WEEKLY SUMMARY', backOnclick: `router.go('floor', {id:'${floor.id}'})` })}
  <div class="view-narrow">
    <div class="page-header">
      <div>
        <div class="page-title">${floorDisplayName(floor)}</div>
        <div class="page-subtitle">${loading ? 'Loading stats...' : `Phase ${s?.currentPhase ?? floor.currentPhase} of ${totalPhases}${cycle > 0 ? ` · Growth Cycle ${cycle}` : ''}`}</div>
      </div>
    </div>

    <div class="glass" style="padding:24px;margin-bottom:16px">
      <div class="stat-strip" style="grid-template-columns:repeat(2,1fr)">
        ${[
          ['Budget Spent', fmtMoney(_spentCents), `${s?.budget?.utilizationPct ?? 0}% used`, _spentCents > _budgetCents * 0.8 ? 'down' : 'up'],
          ['Tasks Done', `${completedTasks}`, `${weekTasks} this week`, 'up'],
          ['Failed', `${failedTasks}`, `${activeT} active`, failedTasks > 0 ? 'down' : 'up'],
          ['Phases', `${phasesDone}/${totalPhases}`, `Trust Lvl ${trustLevel}`, 'up'],
        ].map(([l,v,d,dir]) => `
        <div class="glass-sm stat-card">
          <div class="stat-label">${l}</div>
          <div class="stat-value">${v}</div>
          <div class="stat-delta ${dir}">${d}</div>
        </div>`).join('')}
      </div>
      <div style="margin-top:16px;padding:12px 16px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:var(--radius-sm)">
        <span style="font-size:13px;color:var(--text-2)">Budget: </span>
        <span style="font-size:15px;font-weight:800;color:var(--indigo)">${fmtMoney(_spentCents)} / ${fmtMoney(_budgetCents)}</span>
        <span style="font-size:13px;color:var(--text-3);margin-left:8px">${fmtMoney(s?.budget?.remaining ?? (_budgetCents - _spentCents))} remaining</span>
      </div>
    </div>

    ${recentCompleted.length > 0 ? `
    <div class="glass" style="padding:24px;margin-bottom:16px">
      <div class="report-title">RECENT DELIVERABLES</div>
      ${recentCompleted.map(t => {
        const meta = AGENT_META[t.assignedAgent] || { icon: '🤖', name: t.assignedAgent };
        return `
      <div class="report-item" onclick="showTaskDeliverable('${safeId(t.id)}')" style="cursor:pointer">
        <span class="report-bullet">${meta.icon}</span>
        <span>${meta.name} — ${t.taskType.replace(/-/g, ' ')}</span>
        <span style="color:var(--text-3);font-size:11px;margin-left:auto">${t.completedAt ? new Date(t.completedAt).toLocaleDateString() : ''}</span>
      </div>`;
      }).join('')}
    </div>` : ''}

    ${agentEntries.length > 0 ? `
    <div class="glass" style="padding:24px;margin-bottom:16px">
      <div class="report-title">AGENT UTILIZATION</div>
      ${agentEntries.map(([agent, count]) => {
        const meta = AGENT_META[agent] || { icon: '🤖', name: agent };
        const pct = totalTasks > 0 ? Math.round((count / completedTasks) * 100) : 0;
        return `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-size:16px;flex-shrink:0">${meta.icon}</span>
        <span style="font-size:13px;color:var(--text-2);flex:1">${meta.name}</span>
        <span style="font-size:12px;color:var(--text-3)">${count} tasks</span>
        <div style="width:60px;height:4px;border-radius:2px;background:rgba(255,255,255,0.1)">
          <div style="width:${pct}%;height:100%;border-radius:2px;background:var(--indigo)"></div>
        </div>
      </div>`;
      }).join('')}
    </div>` : ''}

    <div class="section-label" style="margin-bottom:12px">PROPOSALS — YOUR APPROVAL NEEDED</div>
    ${improvements.length > 0 ? improvements.map(imp => `
    <div class="proposal-card glass" style="margin-bottom:12px">
      <div class="proposal-icon">💡</div>
      <div class="proposal-title">${imp.title || 'Improvement proposal'}</div>
      <div class="proposal-impact">${imp.expectedImpact || ''}</div>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn btn-glass btn-sm" onclick="rejectImprovement('${imp.id}')">❌ Pass</button>
        <button class="btn btn-success btn-sm" onclick="approveImprovement('${imp.id}')">✅ Approve</button>
      </div>
    </div>`).join('') : `
    <div style="padding:16px;text-align:center;color:var(--text-3);font-size:13px">No proposals pending right now.</div>`}
  </div>`;
}

async function approveImprovement(id) {
  await api('POST', `/api/improvements/${id}/approve`);
  await loadState();
  toast('Improvement approved! Agents are on it.', 'success');
  render();
}

async function rejectImprovement(id) {
  await api('POST', `/api/improvements/${id}/reject`, { feedback: 'Passed' });
  await loadState();
  toast('Proposal dismissed.', 'info');
  render();
}

async function approveAgentFeedback(id) {
  await api('POST', `/api/feedback/${id}/approve`);
  await loadState();
  toast('Feedback approved — EVE is applying the change.', 'success');
  render();
}

async function rejectAgentFeedback(id) {
  await api('POST', `/api/feedback/${id}/reject`);
  await loadState();
  toast('Feedback dismissed.', 'info');
  render();
}

async function submitFloorFeedback(floorId) {
  const input = document.getElementById('fm-feedback-input');
  if (!input || !input.value.trim()) return;
  const message = input.value.trim();
  input.value = '';
  toast('Sending to EVE for analysis...', 'info');
  const result = await api('POST', `/api/floors/${floorId}/feedback`, { message });
  if (result && !result.error) {
    await loadState();
    const decision = result.eveDecision;
    if (decision === 'auto-apply') {
      toast('EVE auto-applied this improvement.', 'success');
    } else if (decision === 'needs-approval') {
      toast('EVE flagged this for your review.', 'info');
    } else if (decision === 'deferred') {
      toast('EVE deferred this — not actionable yet.', 'info');
    } else {
      toast('EVE reviewed and dismissed this.', 'info');
    }
    render();
  } else {
    toast('Failed to submit feedback.', 'error');
  }
}

// ─── Owner Bug Report ────────────────────────────────────────────────────
function showOwnerFeedbackModal() {
  // Close any existing popover first
  closeOwnerFeedbackPopover();

  const currentFloor = router.params?.id
    ? state.floors.find(f => f.id === router.params.id)
    : null;

  const triggerBtn = document.getElementById('owner-feedback-btn');

  // Build popover element
  const popover = document.createElement('div');
  popover.id = 'owner-feedback-popover';

  popover.innerHTML = `
    <div style="font-size:15px;font-weight:700;color:var(--text-1);margin-bottom:3px">Report an Issue</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:14px">
      Screen: <strong style="color:var(--text-2)">${router.current}</strong>${currentFloor ? ` — ${floorDisplayName(currentFloor)}` : ''}
    </div>
    <select id="ofb-category" style="width:100%;padding:9px 11px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:10px;color:var(--text-1);font-size:13px;margin-bottom:10px;appearance:auto;font-family:inherit;">
      <option value="bug">🐛 Bug — something broke</option>
      <option value="improvement">✨ UX Improvement</option>
      <option value="request">📋 Feature Request</option>
      <option value="observation">👁 General Observation</option>
    </select>
    <textarea id="ofb-message" rows="3" placeholder="Describe what happened or what you expected..."
      style="width:100%;padding:9px 11px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:10px;color:var(--text-1);font-size:13px;resize:vertical;font-family:inherit;outline:none;line-height:1.5;"></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button onclick="closeOwnerFeedbackPopover()" style="padding:7px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:var(--text-2);cursor:pointer;font-size:13px;font-family:inherit;">Cancel</button>
      <button onclick="submitOwnerFeedback()" style="padding:7px 14px;background:linear-gradient(135deg,var(--indigo),var(--violet));border:none;border-radius:8px;color:white;cursor:pointer;font-weight:600;font-size:13px;font-family:inherit;">Send to EVE</button>
    </div>
  `;

  document.body.appendChild(popover);

  // Smart positioning: anchor near the bug button
  const POPOVER_W = 320;
  const POPOVER_H = 260; // approximate
  const MARGIN = 12;

  if (triggerBtn) {
    const rect = triggerBtn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Default: open above-right of the button
    let left = rect.left;
    let top  = rect.top - POPOVER_H - MARGIN;

    // If it would go off the right edge, shift left
    if (left + POPOVER_W > vw - MARGIN) {
      left = vw - POPOVER_W - MARGIN;
    }
    // If it would go off the top, open below instead
    if (top < MARGIN) {
      top = rect.bottom + MARGIN;
    }
    // Final clamp
    left = Math.max(MARGIN, left);
    top  = Math.max(MARGIN, top);

    popover.style.left = left + 'px';
    popover.style.top  = top + 'px';
  } else {
    // Fallback: center-bottom area
    popover.style.bottom = '80px';
    popover.style.left   = '24px';
  }

  // Dismiss on outside click
  setTimeout(() => {
    document.addEventListener('click', _ownerPopoverOutsideClick);
  }, 10);

  // Focus textarea
  requestAnimationFrame(() => {
    document.getElementById('ofb-message')?.focus();
  });
}

function _ownerPopoverOutsideClick(e) {
  const popover = document.getElementById('owner-feedback-popover');
  if (popover && !popover.contains(e.target) && e.target.id !== 'owner-feedback-btn') {
    closeOwnerFeedbackPopover();
  }
}

function closeOwnerFeedbackPopover() {
  document.getElementById('owner-feedback-popover')?.remove();
  document.removeEventListener('click', _ownerPopoverOutsideClick);
}

async function submitOwnerFeedback() {
  const message = document.getElementById('ofb-message')?.value?.trim();
  const category = document.getElementById('ofb-category')?.value || 'bug';
  if (!message) { toast('Please describe the issue.', 'error'); return; }

  const context = {
    route: router.current,
    params: router.params,
    recentActions: actionTracker.getRecent(15),
  };

  closeOwnerFeedbackPopover();
  toast('Sending report to EVE...', 'info');

  const floorId = router.params?.id || state.floors[0]?.id || 'system';
  const actionLog = context.recentActions.map(a => `  ${a.ts} ${a.type}: ${JSON.stringify(a.detail)}`).join('\n');
  const enrichedMessage = `[OWNER-REPORT][${category}] ${message}\n\n--- UI Context ---\nRoute: ${context.route}\nParams: ${JSON.stringify(context.params)}\nRecent actions:\n${actionLog}`;

  const result = await api('POST', `/api/floors/${floorId}/feedback`, {
    message: enrichedMessage,
    source: 'owner',
  });

  if (result && !result.error) {
    await loadState();
    toast('Report received by EVE.', 'success');
    render();
  } else {
    toast('Failed to submit report.', 'error');
  }
}

// ─── Activity Feed ────────────────────────────────────────────────────────
function viewActivity() {
  const all = [...state.activity];

  return `
  ${renderTopNav({ back: true, backLabel: 'Tower', title: 'ACTIVITY', backOnclick: "router.go('tower')" })}
  <div class="view-narrow">
    <div class="page-header">
      <div class="page-title">Activity Feed</div>
      <div class="page-subtitle">Everything happening across all floors</div>
    </div>
    <div class="glass" style="padding:4px 16px">
      ${all.length > 0 ? all.map(a => `
      <div class="activity-item" ${a.taskId ? `onclick="showTaskDeliverable('${safeId(a.taskId)}')" style="cursor:pointer"` : ''}>
        <div class="activity-icon">${a.icon}</div>
        <div class="activity-body">
          <div class="activity-text">${a.text}</div>
          <div class="activity-time" style="display:flex;align-items:center;gap:6px">
            ${a.status === 'working' ? '<span style="width:6px;height:6px;border-radius:50%;background:var(--green,#22c55e);display:inline-block;animation:attention-pulse 1.5s ease-in-out infinite"></span>' : ''}
            ${a.status === 'failed' || a.status === 'escalated' ? '<span style="color:#ef4444;font-size:11px;font-weight:600">FAILED</span>' : ''}
            ${formatTime(a.time)}
            ${a.cost ? `<span style="color:var(--text-3)">· $${(a.cost/100).toFixed(2)}</span>` : ''}
          </div>
        </div>
      </div>`).join('') : `
      <div class="empty-state">
        <div class="empty-icon">📡</div>
        <div class="empty-title">No activity yet</div>
        <div class="empty-sub">Create a floor to get started</div>
      </div>`}
    </div>
  </div>`;
}

// ─── Standalone Improvements View ─────────────────────────────────────────
function viewImprovements() {
  const pending  = state.improvements.filter(i => i.status === 'pending');
  const resolved = state.improvements.filter(i => i.status !== 'pending');
  const pendingFb = state.feedback.filter(fb => fb.eveDecision === 'needs-approval' && fb.status === 'analyzed');
  const autoApplied = state.feedback.filter(fb => fb.status === 'applied' || fb.eveDecision === 'auto-apply');
  const allFb = state.feedback;
  const learnings = state.systemLearnings || [];

  const totalPending = pending.length + pendingFb.length;

  return `
  ${renderTopNav({ back: true, backLabel: 'Tower', title: 'EVE INTELLIGENCE', backOnclick: "router.go('tower')" })}
  <div class="view-narrow">
    <div class="page-header">
      <div>
        <div class="page-title">EVE Intelligence</div>
        <div class="page-subtitle">${totalPending} needs review · ${learnings.length} system learnings · ${autoApplied.length} auto-applied</div>
      </div>
    </div>

    ${pendingFb.length > 0 ? `
    <div class="section-label" style="margin-bottom:12px">AGENT FEEDBACK — NEEDS YOUR DECISION</div>
    ${pendingFb.map(fb => {
      const floorName = state.floors.find(f => f.id === fb.floorId)?.name || 'Unknown Floor';
      const catIcon = fb.category === 'bug' ? '🐛' : fb.category === 'improvement' ? '💡' : fb.category === 'request' ? '📋' : '👁️';
      const isSystemWide = fb.eveAnalysis?.includes('SYSTEM-WIDE');
      return `
      <div class="glass-elevated" style="border-radius:16px;padding:20px;margin-bottom:12px;${isSystemWide ? 'border:1px solid rgba(147,51,234,0.3)' : ''}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="font-size:18px">${catIcon}</span>
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-3)">${fb.agentId} · ${floorName}</span>
          ${isSystemWide ? '<span class="tag" style="background:rgba(147,51,234,0.15);color:#9333ea">System-Wide</span>' : ''}
        </div>
        <div style="font-size:13px;color:var(--text-2);margin-bottom:10px;font-style:italic;border-left:2px solid var(--text-3);padding-left:10px">"${fb.message}"</div>
        <div style="background:rgba(99,102,241,0.06);border-radius:10px;padding:12px;margin-bottom:12px">
          <div style="font-size:11px;font-weight:700;color:#6366f1;margin-bottom:4px">EVE'S ANALYSIS</div>
          <div style="font-size:12px;color:var(--text-2);line-height:1.5">${fb.eveAnalysis || '—'}</div>
          ${fb.actionTaken ? `<div style="font-size:12px;color:var(--accent);margin-top:6px">Recommended action: ${fb.actionTaken}</div>` : ''}
        </div>
        <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">${fb.eveReasoning}</div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-glass" style="flex:1" onclick="rejectAgentFeedback('${fb.id}')">Dismiss</button>
          <button class="btn btn-success" style="flex:2" onclick="approveAgentFeedback('${fb.id}')">Approve</button>
        </div>
      </div>`;
    }).join('')}` : ''}

    ${pending.length > 0 ? `
    <div class="section-label" style="margin-bottom:12px">IMPROVEMENT PROPOSALS</div>
    ${pending.map(imp => `
    <div class="glass-elevated" style="border-radius:16px;padding:20px;margin-bottom:12px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:14px;font-weight:700;color:var(--text-1);flex:1">${imp.description || imp.what_changes || 'Improvement proposal'}</div>
        <span class="tag" style="background:rgba(255,165,0,0.15);color:#f59e0b;flex-shrink:0;margin-left:12px">${imp.riskLevel || 'low'} risk</span>
      </div>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:4px">Evidence: ${imp.evidence || '—'}</div>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:16px">Rollback: ${imp.rollbackPlan || 'Revert to previous version'}</div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-glass" style="flex:1" onclick="rejectImprovement('${imp.id}')">Pass</button>
        <button class="btn btn-success" style="flex:2" onclick="approveImprovement('${imp.id}')">Approve</button>
      </div>
    </div>`).join('')}` : ''}

    ${totalPending === 0 ? `
    <div class="glass" style="padding:20px;margin-bottom:20px;text-align:center">
      <div style="font-size:32px;margin-bottom:8px">✨</div>
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">Nothing pending</div>
      <div style="font-size:13px;color:var(--text-3)">EVE will surface feedback when agents identify issues or improvements.</div>
    </div>` : ''}

    ${autoApplied.length > 0 ? `
    <div class="section-label" style="margin-bottom:12px;margin-top:20px">AUTO-APPLIED BY EVE</div>
    ${autoApplied.slice(0, 10).map(fb => {
      const floorName = state.floors.find(f => f.id === fb.floorId)?.name || '—';
      return `
      <div class="glass-sm" style="border-radius:12px;padding:14px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px">
        <div style="font-size:18px;flex-shrink:0">⚡</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${fb.actionTaken || fb.eveAnalysis || 'Auto-improvement'}</div>
          <div style="font-size:11px;color:var(--text-3)">${fb.agentId} · ${floorName} · auto-applied</div>
        </div>
      </div>`;
    }).join('')}` : ''}

    ${learnings.length > 0 ? `
    <div class="section-label" style="margin-bottom:12px;margin-top:20px">SYSTEM LEARNINGS</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">Issues discovered on one floor, applied system-wide to all floors.</div>
    ${learnings.slice(0, 10).map(l => {
      const srcFloor = state.floors.find(f => f.id === l.sourceFloorId)?.name || '—';
      const age = Math.round((Date.now() - new Date(l.appliedAt).getTime()) / 86400000);
      return `
      <div class="glass-sm" style="border-radius:12px;padding:14px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px">
        <div style="font-size:18px;flex-shrink:0">🌐</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.learning}</div>
          <div style="font-size:11px;color:var(--text-3)">From ${srcFloor} · ${age === 0 ? 'today' : age + 'd ago'} · ${l.reason || 'system-wide'}</div>
        </div>
      </div>`;
    }).join('')}` : ''}

    ${resolved.length > 0 ? `
    <div class="section-label" style="margin-bottom:12px;margin-top:20px">RESOLVED PROPOSALS</div>
    ${resolved.map(imp => {
      const icon = imp.status === 'applied' || imp.status === 'confirmed' ? '✅' : imp.status === 'rolled_back' ? '↩️' : '❌';
      return `
      <div class="glass-sm" style="border-radius:12px;padding:14px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px">
        <div style="font-size:20px;flex-shrink:0">${icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${imp.description || 'Improvement'}</div>
          <div style="font-size:11px;color:var(--text-3)">${imp.status} · ${imp.riskLevel || 'low'} risk</div>
        </div>
      </div>`;
    }).join('')}` : ''}
  </div>`;
}

// ─── Trust Ladder View ─────────────────────────────────────────────────────
function viewTrustLadder() {
  const id    = router.params.id;
  const floor = id ? (state.floors.find(f => f.id === id) || null) : null;
  const trustData = floor ? {
    level: Math.min(3, Math.floor((floor.currentPhase || 1) / 3)),
    floors: [floor],
  } : { level: 0, floors: state.floors };

  const LEVELS = [
    { num: 0, name: 'Supervised',    desc: 'All actions require approval. No external API calls.',      color: '#6B6B6B', icon: '🔒' },
    { num: 1, name: 'Assisted',      desc: 'Can run read-only API calls. Write actions need approval.', color: '#4A90D9', icon: '🤝' },
    { num: 2, name: 'Autonomous',    desc: 'Can execute approved task types without per-action sign-off.', color: '#7C3AED', icon: '⚡' },
    { num: 3, name: 'Full Operator', desc: 'Can manage campaigns and budgets within set limits.',        color: '#D4AF37', icon: '👑' },
  ];

  const currentLevel = trustData.level;

  return `
  ${renderTopNav({ back: true, backLabel: floor?.name || 'Tower', title: 'TRUST LADDER', backOnclick: floor ? `router.go('floor', {id:'${id}'})` : "router.go('tower')" })}
  <div class="view-narrow">
    <div class="page-header">
      <div>
        <div class="page-title">Trust Ladder</div>
        <div class="page-subtitle">Controls what agents can do autonomously</div>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:24px">
      ${LEVELS.map(lvl => {
        const isActive = lvl.num === currentLevel;
        const isPast   = lvl.num < currentLevel;
        return `
        <div class="glass${isActive ? '-elevated' : '-sm'}" style="border-radius:16px;padding:18px;${isActive ? `border:1px solid ${lvl.color}55` : ''}">
          <div style="display:flex;align-items:center;gap:14px">
            <div style="font-size:28px;width:44px;text-align:center">${isPast ? '✅' : isActive ? lvl.icon : '○'}</div>
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <span style="font-size:13px;font-weight:800;color:${isActive ? lvl.color : 'var(--text-1)'}">${lvl.name}</span>
                ${isActive ? `<span class="tag" style="background:${lvl.color}22;color:${lvl.color}">Current</span>` : ''}
              </div>
              <div style="font-size:12px;color:var(--text-3);line-height:1.4">${lvl.desc}</div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>

    ${floor && currentLevel < 3 ? `
    <div class="glass" style="padding:18px;border-radius:14px">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-3);margin-bottom:8px">PROMOTE TO NEXT LEVEL</div>
      <div style="font-size:13px;color:var(--text-2);margin-bottom:16px">
        Promoting unlocks autonomous execution for the next tier of actions.
        You can demote at any time.
      </div>
      <button class="btn btn-primary btn-full" onclick="promoteFloor('${id}')">
        ↑ Promote ${floorDisplayName(floor)} to ${LEVELS[Math.min(currentLevel + 1, 3)].name}
      </button>
    </div>` : ''}
  </div>`;
}

// ─── Notifications ────────────────────────────────────────────────────────
function viewNotifications() {
  const pending = state.approvals.filter(a => a.status === 'pending');

  return `
  ${renderTopNav({ back: true, backLabel: 'Tower', title: 'NOTIFICATIONS', backOnclick: "router.go('tower')" })}
  <div class="view-narrow">
    <div class="page-header">
      <div class="page-title">Notifications</div>
      <div class="page-subtitle">${pending.length} pending, ${state.improvements.length} proposals</div>
    </div>

    ${pending.length > 0 ? `
    <div class="section-label" style="margin-bottom:12px">NEEDS YOUR APPROVAL</div>
    ${pending.map(a => {
      let reviewDest;
      if (a.type === 'gate') {
        const GATE_PHASE_MAP = { 3: 'gate1', 5: 'content-production', 6: 'gate2', 8: 'gate3' };
        const gateView = GATE_PHASE_MAP[a.phaseNumber];
        if (!gateView) {
          console.warn(`[notifications] Unrecognised gate phaseNumber "${a.phaseNumber}" — routing to floor detail.`);
        }
        reviewDest = gateView
          ? `router.go('${gateView}', {id:'${a.floorId}'})`
          : `router.go('floor', {id:'${a.floorId}'})`;
      } else {
        reviewDest = `router.go('floor', {id:'${a.floorId}'})`;
      }
      return `
    <div class="attention-item glass" style="margin-bottom:10px;border-radius:var(--radius)">
      <div>
        <div class="attention-text">🔴 ${a.title || 'Review pending'}</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:4px">${a.description || ''}</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="${reviewDest}">Review →</button>
    </div>`;
    }).join('')}` : `
    <div class="glass" style="padding:16px 18px;margin-bottom:20px">
      <div style="font-size:14px;color:var(--text-3)">✓ No approvals pending</div>
    </div>`}

    ${state.improvements.length > 0 ? `
    <div class="section-label" style="margin-bottom:12px">IMPROVEMENT PROPOSALS</div>
    ${state.improvements.map(i => `
    <div class="proposal-card glass" style="margin-bottom:10px">
      <div class="proposal-title">💡 ${i.title}</div>
      <div class="proposal-impact" style="margin-top:6px">${i.expectedImpact || ''}</div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn btn-glass btn-sm" onclick="rejectImprovement('${i.id}')">❌ Pass</button>
        <button class="btn btn-success btn-sm" onclick="approveImprovement('${i.id}')">✅ Approve</button>
      </div>
    </div>`).join('')}` : ''}

    <div class="section-label" style="margin-bottom:12px;margin-top:20px">RECENT</div>
    <div class="glass" style="padding:4px 16px">
      ${state.activity.slice(0, 5).map(a => `
      <div class="activity-item">
        <div class="activity-icon">${a.icon}</div>
        <div class="activity-body">
          <div class="activity-text">${a.text}</div>
          <div class="activity-time">${formatTime(a.time)}</div>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

// ─── Floor Chat (dedicated full-page route) ───────────────────────────────
function viewFloorChat() {
  const id    = router.params.id;
  const floor = state.floors.find(f => f.id === id);
  if (!floor) return viewFloorNotFound(id);

  const messages = chatPanelMessages[id] || [];

  const messagesHtml = messages.length ? messages.map(m => {
    const time = m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `
    <div class="chat-bubble-row ${m.role}" onclick="event.stopPropagation()">
      <div class="chat-bubble">${(m.text || '').replace(/\n/g, '<br>')}</div>
      ${time ? `<div class="chat-bubble-time">${time}</div>` : ''}
    </div>`;
  }).join('') : `
  <div class="chat-panel-empty" onclick="event.stopPropagation()">
    <div class="chat-panel-empty-icon">🤖</div>
    <div>Hi! I'm the Floor Manager for ${floorDisplayName(floor)}.</div>
    <div style="font-size:12px;margin-top:4px;color:var(--text-3)">Ask me anything about strategy, performance, or next steps.</div>
  </div>`;

  return `
  ${renderTopNav({ back: true, backLabel: floorDisplayName(floor), title: 'FLOOR MANAGER', backOnclick: `router.go('floor', {id:'${floor.id}'})` })}
  <div class="view-narrow floor-chat-isolated" style="display:flex;flex-direction:column;min-height:calc(100vh - 64px)"
       onclick="event.stopPropagation()">
    <div class="page-header" onclick="event.stopPropagation()">
      <div>
        <div class="page-title">Floor Manager</div>
        <div class="page-subtitle">${floorDisplayName(floor)} · Ask anything about your business</div>
      </div>
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--indigo),var(--violet));display:flex;align-items:center;justify-content:center;font-size:18px">🤖</div>
    </div>

    <div class="glass" id="floor-chat-messages"
         style="flex:1;padding:16px;margin-bottom:16px;min-height:300px;overflow-y:auto"
         onclick="event.stopPropagation()">
      ${messagesHtml}
    </div>

    <div class="glass-sm" style="padding:12px;display:flex;gap:10px" onclick="event.stopPropagation()">
      <input class="input" id="floor-chat-input" placeholder="Ask Floor Manager anything…"
             onkeydown="if(event.key==='Enter'){event.stopPropagation();sendFloorChat('${id}');}"
             onclick="event.stopPropagation()"
             style="flex:1;margin:0">
      <button class="btn btn-primary" onclick="event.stopPropagation();sendFloorChat('${id}')">Send</button>
    </div>
  </div>`;
}

async function sendFloorChat(id) {
  const input = document.getElementById('floor-chat-input');
  if (!input || !input.value.trim()) return;

  const msg = input.value.trim();
  input.value = '';

  if (!chatPanelMessages[id]) chatPanelMessages[id] = [];
  chatPanelMessages[id].push({ role: 'user', text: msg, ts: new Date().toISOString() });

  // Re-render messages inline without full render() to avoid losing focus/state
  const container = document.getElementById('floor-chat-messages');
  if (container) {
    const typingRow = document.createElement('div');
    typingRow.className = 'chat-bubble-row assistant floor-chat-typing';
    typingRow.innerHTML = `<div class="chat-typing"><div class="chat-typing-dot"></div><div class="chat-typing-dot"></div><div class="chat-typing-dot"></div></div>`;
    // Rebuild messages + add typing
    container.innerHTML = chatPanelMessages[id].map(m => {
      const time = m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return `<div class="chat-bubble-row ${m.role}" onclick="event.stopPropagation()">
        <div class="chat-bubble">${(m.text || '').replace(/\n/g, '<br>')}</div>
        ${time ? `<div class="chat-bubble-time">${time}</div>` : ''}
      </div>`;
    }).join('');
    container.appendChild(typingRow);
    container.scrollTop = container.scrollHeight;
  }

  const res = await api('POST', `/api/chat/${id}/message`, { message: msg });
  const reply = res?.response || res?.reply || 'Floor Manager is temporarily unavailable.';

  chatPanelMessages[id].push({ role: 'assistant', text: reply, ts: new Date().toISOString() });

  if (container) {
    container.innerHTML = chatPanelMessages[id].map(m => {
      const time = m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return `<div class="chat-bubble-row ${m.role}" onclick="event.stopPropagation()">
        <div class="chat-bubble">${(m.text || '').replace(/\n/g, '<br>')}</div>
        ${time ? `<div class="chat-bubble-time">${time}</div>` : ''}
      </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  }
}

// ─── Chat ─────────────────────────────────────────────────────────────────
function viewChat() {
  const id    = router.params.id;
  const floor = state.floors.find(f => f.id === id);
  if (!floor) return viewFloorNotFound(id);

  const messages = state.chatMessages || [
    { role:'assistant', text:'Hi! I\'m the Floor Manager for '+floorDisplayName(floor)+'. What would you like to know?' },
  ];

  return `
  ${renderTopNav({ back: true, backLabel: floorDisplayName(floor), title: 'FLOOR MANAGER', backOnclick: `router.go('floor', {id:'${floor.id}'})` })}
  <div class="view-narrow" style="display:flex;flex-direction:column;min-height:calc(100vh - 64px)">
    <div class="page-header">
      <div>
        <div class="page-title">Floor Manager</div>
        <div class="page-subtitle">${floorDisplayName(floor)} · Ask anything about your business</div>
      </div>
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--indigo),var(--violet));display:flex;align-items:center;justify-content:center;font-size:18px">🤖</div>
    </div>

    <div class="glass" style="flex:1;padding:16px;margin-bottom:16px;min-height:300px;overflow-y:auto" id="chat-messages">
      ${messages.map(m => `
      <div style="display:flex;${m.role==='user'?'justify-content:flex-end':''};margin-bottom:12px">
        <div style="max-width:80%;padding:12px 16px;border-radius:${m.role==='user'?'16px 16px 4px 16px':'16px 16px 16px 4px'};
                    background:${m.role==='user'?'linear-gradient(135deg,var(--indigo),var(--violet))':'rgba(255,255,255,0.07)'};
                    border:1px solid ${m.role==='user'?'transparent':'var(--border)'};
                    font-size:14px;line-height:1.5;color:var(--text-1)">
          ${m.text}
        </div>
      </div>`).join('')}
    </div>

    <div class="glass-sm" style="padding:12px;display:flex;gap:10px">
      <input class="input" id="chat-input" placeholder="Ask Floor Manager anything…"
             onkeydown="if(event.key==='Enter')sendChat('${id}')"
             style="flex:1;margin:0">
      <button class="btn btn-primary" onclick="sendChat('${id}')">Send</button>
    </div>
  </div>`;
}

async function sendChat(id) {
  const input = document.getElementById('chat-input');
  if (!input || !input.value.trim()) return;

  const msg = input.value.trim();
  input.value = '';

  if (!state.chatMessages) state.chatMessages = [
    { role:'assistant', text:'Hi! I\'m the Floor Manager. What would you like to know?' }
  ];
  state.chatMessages.push({ role:'user', text: msg });
  render();

  // Call API
  const res = await api('POST', `/api/chat/${id}/message`, { message: msg });
  state.chatMessages.push({
    role: 'assistant',
    text: res?.response || res?.reply || 'Floor Manager is temporarily unavailable.',
  });
  render();

  // Scroll to bottom after render
  requestAnimationFrame(() => {
    const msgs = document.getElementById('chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  });
}

// ─── Floor Manager Chat Panel ────────────────────────────────────────────
// Persistent side panel accessible on all floor pages.
// State persisted to localStorage: { open: bool, minimized: bool, floorId: string }

const chatPanelState = (() => {
  try {
    return JSON.parse(localStorage.getItem('eve-chat-panel') || '{}');
  } catch { return {}; }
})();

function saveChatPanelState() {
  try {
    localStorage.setItem('eve-chat-panel', JSON.stringify(chatPanelState));
  } catch {}
}

// Persistent message store keyed by floorId — backed by localStorage
const CHAT_HISTORY_KEY = 'eve-chat-history';

function loadChatHistory() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '{}');
  } catch { return {}; }
}

function saveChatHistory(store) {
  try {
    // Keep last 100 messages per floor to avoid unbounded growth
    const trimmed = {};
    for (const [fid, msgs] of Object.entries(store)) {
      trimmed[fid] = Array.isArray(msgs) ? msgs.slice(-100) : [];
    }
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(trimmed));
  } catch {}
}

// In-memory message store — initialised from localStorage so history survives refreshes
const chatPanelMessages = loadChatHistory();

function createChatPanel() {
  if (document.getElementById('floor-chat-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'floor-chat-panel';
  panel.innerHTML = `
    <div id="chat-panel-header">
      <div class="chat-panel-title">
        <div class="chat-avatar">🤖</div>
        <div class="chat-label">
          <div class="chat-label-name" id="chat-panel-floor-name">Floor Manager</div>
          <div class="chat-label-floor" id="chat-panel-floor-sub">Ask anything about your business</div>
        </div>
      </div>
      <button class="chat-panel-toggle" id="chat-panel-minimize-btn" title="Minimize" onclick="minimizeChatPanel()">‹</button>
      <button class="chat-panel-close" title="Close" onclick="closeChatPanel()">✕</button>
      <div id="chat-panel-rail-label" onclick="expandChatPanel()">Floor Manager</div>
    </div>
    <div id="chat-panel-messages"></div>
    <div id="chat-panel-input-row">
      <textarea id="chat-panel-input" placeholder="Ask Floor Manager anything…" rows="1"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatPanel();}"
        oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px'"></textarea>
      <button id="chat-panel-send" onclick="sendChatPanel()" title="Send">↑</button>
    </div>
  `;
  document.body.appendChild(panel);
}

function updateChatPanelHeader(floorId) {
  const floor = state.floors.find(f => f.id === floorId);
  const nameEl = document.getElementById('chat-panel-floor-name');
  const subEl  = document.getElementById('chat-panel-floor-sub');
  if (nameEl) nameEl.textContent = floor ? `${floorDisplayName(floor)} — Floor Manager` : 'Floor Manager';
  if (subEl)  subEl.textContent  = floor ? 'Ask anything about your business' : 'Select a floor to chat';
}

function renderChatPanelMessages(floorId) {
  const container = document.getElementById('chat-panel-messages');
  if (!container) return;

  const msgs = chatPanelMessages[floorId] || [];

  if (msgs.length === 0) {
    const floor = state.floors.find(f => f.id === floorId);
    container.innerHTML = `
      <div class="chat-panel-empty">
        <div class="chat-panel-empty-icon">🤖</div>
        <div>Hi! I'm the Floor Manager${floor ? ` for ${floorDisplayName(floor)}` : ''}.</div>
        <div style="font-size:12px;margin-top:4px;color:var(--text-3)">Ask me anything about your business — strategy, performance, next steps.</div>
      </div>`;
    return;
  }

  container.innerHTML = msgs.map(m => {
    const time = m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `
    <div class="chat-bubble-row ${m.role}">
      <div class="chat-bubble">${m.text.replace(/\n/g, '<br>')}</div>
      ${time ? `<div class="chat-bubble-time">${time}</div>` : ''}
    </div>`;
  }).join('');

  // Scroll to bottom
  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

function showChatTypingIndicator() {
  const container = document.getElementById('chat-panel-messages');
  if (!container) return;
  const existing = container.querySelector('.chat-typing-row');
  if (existing) return;
  const row = document.createElement('div');
  row.className = 'chat-bubble-row assistant chat-typing-row';
  row.innerHTML = `<div class="chat-typing"><div class="chat-typing-dot"></div><div class="chat-typing-dot"></div><div class="chat-typing-dot"></div></div>`;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function removeChatTypingIndicator() {
  document.querySelector('.chat-typing-row')?.remove();
}

async function openChatPanel(floorId) {
  createChatPanel();

  chatPanelState.open = true;
  chatPanelState.minimized = false;
  chatPanelState.floorId = floorId || chatPanelState.floorId;
  saveChatPanelState();

  const panel = document.getElementById('floor-chat-panel');
  panel.classList.remove('panel-minimized');
  panel.classList.add('panel-expanded');
  document.body.classList.add('chat-panel-open');
  document.body.classList.remove('chat-panel-minimized');

  const activeFloorId = chatPanelState.floorId;
  updateChatPanelHeader(activeFloorId);

  // Load history from API if not already cached
  if (!chatPanelMessages[activeFloorId]) {
    chatPanelMessages[activeFloorId] = [];
    renderChatPanelMessages(activeFloorId);
    try {
      const history = await api('GET', `/api/chat/${activeFloorId}/history`);
      if (Array.isArray(history) && history.length > 0) {
        // Merge API history with any locally-persisted messages, deduplicating by ts+role
        const apiMsgs = history.map(m => ({
          role: m.role || (m.sender === 'user' ? 'user' : 'assistant'),
          text: m.content || m.text || m.message || '',
          ts: m.createdAt || m.ts || null,
        }));
        const localMsgs = chatPanelMessages[activeFloorId] || [];
        const localKeys = new Set(localMsgs.map(m => `${m.role}:${m.ts}:${(m.text||'').slice(0,20)}`));
        for (const m of apiMsgs) {
          const key = `${m.role}:${m.ts}:${(m.text||'').slice(0,20)}`;
          if (!localKeys.has(key)) localMsgs.push(m);
        }
        localMsgs.sort((a, b) => (a.ts || '') < (b.ts || '') ? -1 : 1);
        chatPanelMessages[activeFloorId] = localMsgs;
        saveChatHistory(chatPanelMessages);
      }
    } catch {}
    renderChatPanelMessages(activeFloorId);
  } else {
    renderChatPanelMessages(activeFloorId);
  }

  // Focus input
  requestAnimationFrame(() => document.getElementById('chat-panel-input')?.focus());
}

function minimizeChatPanel() {
  const panel = document.getElementById('floor-chat-panel');
  if (!panel) return;
  chatPanelState.minimized = true;
  chatPanelState.open = true;
  saveChatPanelState();
  panel.classList.remove('panel-expanded');
  panel.classList.add('panel-minimized');
  document.body.classList.remove('chat-panel-open');
  document.body.classList.add('chat-panel-minimized');
  const btn = document.getElementById('chat-panel-minimize-btn');
  if (btn) { btn.textContent = '›'; btn.title = 'Expand'; btn.onclick = expandChatPanel; }
}

function expandChatPanel() {
  const panel = document.getElementById('floor-chat-panel');
  if (!panel) return;
  chatPanelState.minimized = false;
  chatPanelState.open = true;
  saveChatPanelState();
  panel.classList.remove('panel-minimized');
  panel.classList.add('panel-expanded');
  document.body.classList.add('chat-panel-open');
  document.body.classList.remove('chat-panel-minimized');
  const btn = document.getElementById('chat-panel-minimize-btn');
  if (btn) { btn.textContent = '‹'; btn.title = 'Minimize'; btn.onclick = minimizeChatPanel; }
  renderChatPanelMessages(chatPanelState.floorId);
  requestAnimationFrame(() => document.getElementById('chat-panel-input')?.focus());
}

function closeChatPanel() {
  const panel = document.getElementById('floor-chat-panel');
  if (!panel) return;
  chatPanelState.open = false;
  chatPanelState.minimized = false;
  saveChatPanelState();
  panel.classList.remove('panel-expanded', 'panel-minimized');
  document.body.classList.remove('chat-panel-open', 'chat-panel-minimized');
}

// Called by render() to sync panel visibility with current view.
// On all floor pages the panel is ALWAYS visible (expanded or minimized).
// On non-floor pages it is hidden entirely.
function syncChatPanel() {
  const floorViews = ['floor', 'gate1', 'gate1-voice', 'gate1-strategy', 'gate2', 'gate3', 'weekly', 'trust-ladder', 'content-production'];
  const isFloorView = floorViews.includes(router.current);
  const currentFloorId = router.params?.id;

  if (!isFloorView) {
    // Hide panel entirely on non-floor pages
    const panel = document.getElementById('floor-chat-panel');
    if (panel) {
      panel.classList.remove('panel-expanded', 'panel-minimized');
      document.body.classList.remove('chat-panel-open', 'chat-panel-minimized');
    }
    return;
  }

  // Ensure panel DOM exists
  createChatPanel();
  const panel = document.getElementById('floor-chat-panel');

  // If floor changed, update header and messages
  const floorChanged = currentFloorId && currentFloorId !== chatPanelState.floorId;
  if (floorChanged) {
    chatPanelState.floorId = currentFloorId;
    saveChatPanelState();
    updateChatPanelHeader(currentFloorId);
    renderChatPanelMessages(currentFloorId);
    const input = document.getElementById('chat-panel-input');
    if (input) input.value = '';
  }

  const activeFloorId = chatPanelState.floorId || currentFloorId;

  // On a floor page the panel is ALWAYS shown. Default to expanded unless
  // the user has explicitly minimized it (persisted in chatPanelState).
  if (!chatPanelState.open) {
    // First visit to any floor — auto-open expanded
    chatPanelState.open = true;
    chatPanelState.minimized = false;
    saveChatPanelState();
  }

  if (chatPanelState.minimized) {
    panel.classList.add('panel-minimized');
    panel.classList.remove('panel-expanded');
    document.body.classList.add('chat-panel-minimized');
    document.body.classList.remove('chat-panel-open');
    // Update minimize button to show expand arrow
    const btn = document.getElementById('chat-panel-minimize-btn');
    if (btn) { btn.textContent = '›'; btn.title = 'Expand'; btn.onclick = expandChatPanel; }
  } else {
    panel.classList.add('panel-expanded');
    panel.classList.remove('panel-minimized');
    document.body.classList.add('chat-panel-open');
    document.body.classList.remove('chat-panel-minimized');
    updateChatPanelHeader(activeFloorId);
    if (!floorChanged) renderChatPanelMessages(activeFloorId);
    // Ensure minimize button shows collapse arrow
    const btn = document.getElementById('chat-panel-minimize-btn');
    if (btn) { btn.textContent = '‹'; btn.title = 'Minimize'; btn.onclick = minimizeChatPanel; }
    // Load chat history from API if not yet cached for this floor
    if (activeFloorId) {
      // chatPanelMessages is pre-seeded from localStorage — only fetch API if empty
      if (!chatPanelMessages[activeFloorId] || chatPanelMessages[activeFloorId].length === 0) {
        chatPanelMessages[activeFloorId] = chatPanelMessages[activeFloorId] || [];
        renderChatPanelMessages(activeFloorId);
        api('GET', `/api/chat/${activeFloorId}/history`).then(history => {
          if (Array.isArray(history) && history.length > 0) {
            const apiMsgs = history.map(m => ({
              role: m.role || (m.sender === 'user' ? 'user' : 'assistant'),
              text: m.content || m.text || m.message || '',
              ts: m.createdAt || m.ts || null,
            }));
            const localMsgs = chatPanelMessages[activeFloorId] || [];
            const localKeys = new Set(localMsgs.map(m => `${m.role}:${m.ts}:${(m.text||'').slice(0,20)}`));
            for (const m of apiMsgs) {
              const key = `${m.role}:${m.ts}:${(m.text||'').slice(0,20)}`;
              if (!localKeys.has(key)) localMsgs.push(m);
            }
            localMsgs.sort((a, b) => (a.ts || '') < (b.ts || '') ? -1 : 1);
            chatPanelMessages[activeFloorId] = localMsgs;
            saveChatHistory(chatPanelMessages);
            renderChatPanelMessages(activeFloorId);
          }
        }).catch(() => {});
      }
    }
  }
}

async function sendChatPanel() {
  const input = document.getElementById('chat-panel-input');
  if (!input || !input.value.trim()) return;

  const floorId = chatPanelState.floorId;
  if (!floorId) { toast('Open a floor first to chat with Floor Manager.', 'error'); return; }

  const msg = input.value.trim();
  input.value = '';
  input.style.height = 'auto';

  if (!chatPanelMessages[floorId]) chatPanelMessages[floorId] = [];
  chatPanelMessages[floorId].push({ role: 'user', text: msg, ts: new Date().toISOString() });
  saveChatHistory(chatPanelMessages);
  renderChatPanelMessages(floorId);
  showChatTypingIndicator();

  const res = await api('POST', `/api/chat/${floorId}/message`, { message: msg });
  removeChatTypingIndicator();

  const reply = res?.response || res?.reply || 'Floor Manager is temporarily unavailable.';
  chatPanelMessages[floorId].push({ role: 'assistant', text: reply, ts: new Date().toISOString() });
  saveChatHistory(chatPanelMessages);
  renderChatPanelMessages(floorId);
}

// ─── Kill / Resume ────────────────────────────────────────────────────────
async function killFloor(id) {
  if (!confirm('Pause this floor? All agents will stop.')) return;
  await api('POST', `/api/floors/${id}/kill`);
  await loadState();
  toast('Floor paused.', 'info');
  render();
}

// ─── Delete Floor ──────────────────────────────────────────────────────────
function confirmDeleteFloor(id, name) {
  showDeleteModal(id, name);
}

function showDeleteModal(id, name) {
  // Remove any existing modal
  document.getElementById('delete-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'delete-modal';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);
  `;
  modal.innerHTML = `
    <div style="
      background:var(--surface-2,#1a1a2e);border:1px solid rgba(239,68,68,0.3);
      border-radius:16px;padding:32px;max-width:400px;width:90%;text-align:center;
    ">
      <div style="font-size:32px;margin-bottom:12px">🗑</div>
      <h2 style="margin:0 0 8px;font-size:20px;color:var(--text-1,#fff)">Delete ${name}?</h2>
      <p style="margin:0 0 24px;font-size:14px;color:var(--text-2,#aaa);line-height:1.5">
        This will permanently delete this floor and all its data.<br>
        <strong style="color:#ef4444">This cannot be undone.</strong>
      </p>
      <div style="display:flex;gap:12px">
        <button onclick="document.getElementById('delete-modal').remove()"
          style="flex:1;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);
                 background:rgba(255,255,255,0.05);color:var(--text-1,#fff);cursor:pointer;font-size:15px">
          Cancel
        </button>
        <button onclick="executeDeleteFloor('${id}')"
          style="flex:1;padding:12px;border-radius:10px;border:none;
                 background:#ef4444;color:#fff;cursor:pointer;font-size:15px;font-weight:700">
          Delete Floor
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  // Click outside to dismiss
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function executeDeleteFloor(id) {
  document.getElementById('delete-modal')?.remove();
  const result = await api('DELETE', `/api/floors/${id}`);
  if (!result?.success) {
    toast('Failed to delete floor.', 'error');
    return;
  }
  await loadState();
  router.go('tower');
  render();
  toast('Floor deleted.', 'info');
}

async function promoteFloor(id) {
  const result = await api('POST', `/api/floors/${id}/promote`);
  if (result?.success) {
    toast(`Promoted to Trust Level ${result.level} ✨`, 'success');
    await loadState();
    render();
  } else {
    toast(result?.error || 'Cannot promote yet — criteria not met.', 'error');
  }
}

// ── Task 7.1: New Views - Home/HQ, Floor Dashboard, Build, Review, Operations, Settings ──

// Home/HQ Dashboard (overview of all floors, health, notifications)
function viewHome() {
  const unreadNotifications = state.approvals.filter(a => a.status === 'pending').length;
  const totalSpent = state.floors.reduce((sum, f) => sum + (f.spentCents ?? 0), 0);
  const totalBudget = state.floors.reduce((sum, f) => sum + (f.budgetCeilingCents ?? 0), 0);
  const spentPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  const floorsHtml = state.floors.map(f => {
    const phase = f.currentPhase || 1;
    const fSpentCents = f.spentCents ?? 0;
    const fBudgetCents = f.budgetCeilingCents ?? 0;
    const fSpentPct = fBudgetCents > 0 ? Math.round((fSpentCents / fBudgetCents) * 100) : 0;
    const phaseNames = { 1: 'Setup', 2: 'Setup', 3: 'Foundation', 4: 'Brand', 5: 'Content', 6: 'Staging', 7: 'Launch', 8: 'Ads', 9: 'Growth', 10: 'Optimize' };

    return `
    <div class="glass" style="padding:16px;margin-bottom:12px;cursor:pointer" onclick="router.go('floor', {id:'${f.id}'});render()">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
        <div>
          <div style="font-weight:600;color:var(--text-1)">${f.name}</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:4px">Phase ${phase}: ${phaseNames[phase] || 'Unknown'}</div>
        </div>
        <div style="font-size:13px;color:var(--text-2)">\$${(fSpentCents/100).toFixed(0)}</div>
      </div>
      <div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${Math.min(100,fSpentPct)}%;background:var(--indigo)"></div>
      </div>
    </div>`;
  }).join('');

  return `
  ${renderTopNav({ title: 'EVE DASHBOARD', hideBack: true })}
  <div class="view-narrow">
    <div class="page-header">
      <div>
        <div class="page-title">HQ Dashboard</div>
        <div class="page-subtitle">All floors · Budget · Health</div>
      </div>
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--indigo),var(--violet));display:flex;align-items:center;justify-content:center;font-size:18px">🏢</div>
    </div>

    <div class="glass" style="padding:16px;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;margin-bottom:12px">
        <span style="color:var(--text-3);font-size:12px">BUDGET</span>
        <span style="color:var(--text-1);font-size:13px">\$${(totalSpent/100).toFixed(2)} / \$${(totalBudget/100).toFixed(2)}</span>
      </div>
      <div style="height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;margin-bottom:8px">
        <div style="height:100%;width:${Math.min(100,spentPct)}%;background:${spentPct > 90 ? '#ef4444' : spentPct > 75 ? '#FFB833' : 'var(--indigo)'}"></div>
      </div>
      <div style="font-size:12px;color:var(--text-3)">${spentPct}% spent</div>
    </div>

    ${unreadNotifications > 0 ? `
    <div style="padding:12px 16px;background:rgba(74,58,255,0.15);border-radius:12px;border:1px solid rgba(74,58,255,0.3);margin-bottom:20px">
      <div style="color:var(--indigo);font-weight:600;font-size:13px">${unreadNotifications} Pending Approvals</div>
      <div style="margin-top:8px"><button class="btn btn-sm" onclick="router.go('approvals');render()" style="width:100%">Review Queue</button></div>
    </div>` : ''}

    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:12px;text-transform:uppercase">Floors</div>
      ${floorsHtml}
    </div>
  </div>`;
}

// Floor Dashboard (phase progress, task list, agent status)
function viewFloorDashboard() {
  const floorId = router.params.id;
  const floor = state.floors.find(f => f.id === floorId);
  if (!floor) return viewFloorNotFound(floorId);

  const tasks = state.floorTasks[floorId] || [];
  const phase = floor.currentPhase || 1;
  const tasksByStatus = {
    completed: tasks.filter(t => t.status === 'completed'),
    working: tasks.filter(t => t.status === 'working'),
    queued: tasks.filter(t => t.status === 'queued'),
    failed: tasks.filter(t => t.status === 'failed'),
  };

  const tasksHtml = ['working', 'queued', 'failed', 'completed'].flatMap(status =>
    tasksByStatus[status].slice(0, 3).map(t => `
    <div class="glass-sm" style="padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:var(--text-1)">${t.taskType.replace(/-/g, ' ')}</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:2px">${AGENT_META[t.assignedAgent]?.name || t.assignedAgent}</div>
      </div>
      <div style="font-size:11px;padding:4px 8px;border-radius:6px;background:${
        status === 'completed' ? 'rgba(46,204,113,0.2);color:#2ECC71' :
        status === 'working' ? 'rgba(74,58,255,0.2);color:var(--indigo)' :
        status === 'failed' ? 'rgba(239,68,68,0.2);color:#ef4444' :
        'rgba(255,255,255,0.1);color:var(--text-3)'
      }">${status}</div>
    </div>`)
  ).join('');

  return `
  ${renderTopNav({ back: true, backLabel: 'HQ', title: 'FLOOR DASHBOARD', backOnclick: "router.go('home');render()" })}
  <div class="view-narrow">
    <div class="page-header">
      <div>
        <div class="page-title">${floor.name}</div>
        <div class="page-subtitle">Phase ${phase} · ${tasksByStatus.working.length} active</div>
      </div>
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--indigo),var(--violet));display:flex;align-items:center;justify-content:center;font-size:18px">📊</div>
    </div>

    <div style="margin-bottom:20px">
      <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:8px">TASK SUMMARY</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="glass-sm" style="padding:12px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:var(--green)">${tasksByStatus.completed.length}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:4px">Completed</div>
        </div>
        <div class="glass-sm" style="padding:12px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:var(--indigo)">${tasksByStatus.working.length}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:4px">Working</div>
        </div>
        <div class="glass-sm" style="padding:12px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:var(--yellow)">${tasksByStatus.queued.length}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:4px">Queued</div>
        </div>
        <div class="glass-sm" style="padding:12px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:#ef4444">${tasksByStatus.failed.length}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:4px">Failed</div>
        </div>
      </div>
    </div>

    <div>
      <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:8px">RECENT TASKS</div>
      ${tasksHtml || '<div style="color:var(--text-3);padding:12px">No tasks yet.</div>'}
    </div>
  </div>`;
}

// Build Tab (design review, content preview, website preview)
function viewBuildTab() {
  const floorId = router.params.id;
  const floor = state.floors.find(f => f.id === floorId);
  if (!floor) return viewFloorNotFound(floorId);

  const tasks = state.floorTasks[floorId] || [];
  const designTask = tasks.find(t => t.taskType === 'brand-visual-system' && t.status === 'completed');
  const contentTasks = tasks.filter(t => t.taskType.includes('content') && t.status === 'completed');
  const websiteTask = tasks.find(t => t.taskType === 'website-build' && t.status === 'completed');

  return `
  ${renderTopNav({ back: true, backLabel: floor.name, title: 'BUILD TAB', backOnclick: `router.go('floor', {id:'${floor.id}'});render()` })}
  <div class="view-narrow">
    <div class="page-header">
      <div>
        <div class="page-title">Build & Review</div>
        <div class="page-subtitle">${floor.name}</div>
      </div>
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--indigo),var(--violet));display:flex;align-items:center;justify-content:center;font-size:18px">🎨</div>
    </div>

    <div class="glass" style="padding:16px;margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:8px">Design System</div>
      ${designTask ? `
        <div style="padding:12px;background:rgba(46,204,113,0.15);border-radius:8px;border:1px solid rgba(46,204,113,0.3)">
          <div style="color:#2ECC71;font-weight:600;font-size:13px">✅ Brand Visual System</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:4px">Complete and approved</div>
        </div>
      ` : `
        <div style="padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;border:1px solid rgba(255,255,255,0.1)">
          <div style="color:var(--text-2);font-weight:600;font-size:13px">○ Awaiting Design</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:4px">Design Agent is working on your visual system</div>
        </div>
      `}
    </div>

    <div class="glass" style="padding:16px;margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:8px">Content</div>
      ${contentTasks.length > 0 ? `
        <div style="padding:12px;background:rgba(46,204,113,0.15);border-radius:8px;border:1px solid rgba(46,204,113,0.3)">
          <div style="color:#2ECC71;font-weight:600;font-size:13px">✅ ${contentTasks.length} Content Pieces</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:4px">Ready for review and scheduling</div>
        </div>
      ` : `
        <div style="padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;border:1px solid rgba(255,255,255,0.1)">
          <div style="color:var(--text-2);font-weight:600;font-size:13px">○ Creating Content</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:4px">Copy and Design agents are creating your content</div>
        </div>
      `}
    </div>

    <div class="glass" style="padding:16px">
      <div style="font-weight:600;margin-bottom:8px">Website</div>
      ${websiteTask ? `
        <div style="padding:12px;background:rgba(46,204,113,0.15);border-radius:8px;border:1px solid rgba(46,204,113,0.3)">
          <div style="color:#2ECC71;font-weight:600;font-size:13px">✅ Website Built</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:4px;margin-bottom:8px">Your website is ready for review</div>
          <button class="btn btn-sm" style="width:100%;background:var(--indigo)">Preview Site</button>
        </div>
      ` : `
        <div style="padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;border:1px solid rgba(255,255,255,0.1)">
          <div style="color:var(--text-2);font-weight:600;font-size:13px">○ Building Website</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:4px">Web Agent is building your custom website</div>
        </div>
      `}
    </div>
  </div>`;
}

// Review Tab (approval queue with approve/reject)
function viewReviewTab() {
  const pendingApprovals = state.approvals.filter(a => a.status === 'pending').slice(0, 10);

  const approvalsHtml = pendingApprovals.length ? pendingApprovals.map(a => `
  <div class="glass" style="padding:16px;margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
      <div>
        <div style="font-weight:600;color:var(--text-1)">${a.type || 'Approval'}</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:4px">${a.summary || 'Awaiting your review'}</div>
      </div>
      <div style="font-size:11px;padding:4px 8px;background:rgba(255,184,51,0.2);color:#FFB833;border-radius:6px">PENDING</div>
    </div>
    ${a.outputPreview ? `<div style="padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;font-size:12px;color:var(--text-2);max-height:100px;overflow:hidden;margin-bottom:12px">${a.outputPreview.substring(0, 300)}...</div>` : ''}
    <div style="display:flex;gap:8px">
      <button class="btn btn-sm" style="flex:1;background:var(--indigo)" onclick="approveApproval('${a.id}')">Approve</button>
      <button class="btn btn-sm" style="flex:1;background:#ef4444" onclick="rejectApproval('${a.id}')">Reject</button>
    </div>
  </div>`).join('') : '<div style="padding:20px;text-align:center;color:var(--text-3)">No pending approvals. Nice work! 🎉</div>';

  return `
  ${renderTopNav({ title: 'REVIEW QUEUE', hideBack: true })}
  <div class="view-narrow">
    <div class="page-header">
      <div>
        <div class="page-title">Approval Queue</div>
        <div class="page-subtitle">${pendingApprovals.length} pending items</div>
      </div>
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--indigo),var(--violet));display:flex;align-items:center;justify-content:center;font-size:18px">✅</div>
    </div>
    ${approvalsHtml}
  </div>`;
}

// Operations Tab (ads performance, email metrics, fulfillment tracking)
function viewOperationsTab() {
  const floors = state.floors.slice(0, 5);
  const opsHtml = floors.map(f => {
    const tasks = state.floorTasks[f.id] || [];
    const adsTask = tasks.find(t => t.taskType === 'launch-ad-campaign' && t.status === 'completed');
    return `
    <div class="glass" style="padding:16px;margin-bottom:12px">
      <div style="font-weight:600;margin-bottom:8px">${f.name}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
        <div style="padding:8px;background:rgba(255,255,255,0.05);border-radius:6px">
          <div style="color:var(--text-3)">Ads</div>
          <div style="font-weight:600;color:var(--text-1);margin-top:4px">${adsTask ? '✅ Active' : '○ Pending'}</div>
        </div>
        <div style="padding:8px;background:rgba(255,255,255,0.05);border-radius:6px">
          <div style="color:var(--text-3)">Email</div>
          <div style="font-weight:600;color:var(--text-1);margin-top:4px">○ Setup</div>
        </div>
      </div>
    </div>`;
  }).join('');

  return `
  ${renderTopNav({ title: 'OPERATIONS', hideBack: true })}
  <div class="view-narrow">
    <div class="page-header">
      <div>
        <div class="page-title">Operations Hub</div>
        <div class="page-subtitle">Ads · Email · Fulfillment</div>
      </div>
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--indigo),var(--violet));display:flex;align-items:center;justify-content:center;font-size:18px">🚀</div>
    </div>
    ${opsHtml}
  </div>`;
}

// Settings (API keys, budget, trust level, notification preferences)
function viewSettings() {
  return `
  ${renderTopNav({ title: 'SETTINGS', hideBack: true })}
  <div class="view-narrow">
    <div class="page-header">
      <div>
        <div class="page-title">Settings</div>
        <div class="page-subtitle">Configuration · Preferences</div>
      </div>
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--indigo),var(--violet));display:flex;align-items:center;justify-content:center;font-size:18px">⚙️</div>
    </div>

    <div class="glass" style="padding:16px;margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:12px">Budget Management</div>
      <div style="padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;margin-bottom:8px">
        <div style="font-size:12px;color:var(--text-3);margin-bottom:4px">Monthly Budget Ceiling</div>
        <div style="font-weight:600;color:var(--text-1)">\$5,000</div>
      </div>
      <button class="btn btn-sm" style="width:100%;background:var(--indigo)">Edit Budget</button>
    </div>

    <div class="glass" style="padding:16px;margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:12px">Notifications</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="color:var(--text-2);font-size:13px">Email Alerts</span>
        <input type="checkbox" checked style="width:18px;height:18px;cursor:pointer">
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--text-2);font-size:13px">Push Notifications</span>
        <input type="checkbox" checked style="width:18px;height:18px;cursor:pointer">
      </div>
    </div>

    <div class="glass" style="padding:16px">
      <div style="font-weight:600;margin-bottom:8px">Danger Zone</div>
      <button class="btn btn-sm" style="width:100%;background:#ef4444;margin-top:8px">Sign Out</button>
    </div>
  </div>`;
}

// ── Task 7.2: Approval Queue UI ──

function viewApprovalQueue() {
  const pendingApprovals = state.approvals.filter(a => a.status === 'pending');

  const approvalsHtml = pendingApprovals.length ? pendingApprovals.map(a => `
  <div class="glass" style="padding:16px;margin-bottom:12px;border-left:4px solid ${a.type === 'gate' ? 'var(--indigo)' : 'var(--yellow)'}" id="approval-${a.id}">
    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
      <div style="flex:1">
        <div style="font-weight:600;color:var(--text-1)">${a.type === 'gate' ? '🔒 Gate Approval' : '📋 Task Review'}</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:4px">${a.summary || a.taskType || 'Awaiting your approval'}</div>
      </div>
      <div style="font-size:11px;padding:4px 8px;background:rgba(255,184,51,0.2);color:#FFB833;border-radius:6px;font-weight:600">PENDING</div>
    </div>

    ${a.outputPreview ? `
    <div style="padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;font-size:12px;color:var(--text-2);max-height:120px;overflow:hidden;margin-bottom:12px;border-left:2px solid var(--indigo)">
      ${a.outputPreview.substring(0, 400)}${a.outputPreview.length > 400 ? '...' : ''}
    </div>` : ''}

    ${a.estimatedCostCents ? `
    <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">Estimated cost: \$${(a.estimatedCostCents/100).toFixed(2)}</div>` : ''}

    <div style="display:flex;gap:8px">
      <button class="btn btn-sm" style="flex:1;background:var(--green)" onclick="approveApprovalItem('${a.id}')">Approve</button>
      <button class="btn btn-sm" style="flex:1;background:#ef4444" onclick="showRejectFeedback('${a.id}')">Reject</button>
    </div>
  </div>`).join('') : `
  <div style="padding:40px 20px;text-align:center">
    <div style="font-size:48px;margin-bottom:12px">🎉</div>
    <div style="font-weight:600;color:var(--text-1);margin-bottom:4px">All Caught Up!</div>
    <div style="font-size:14px;color:var(--text-3)">No pending approvals. Your tasks are flowing smoothly.</div>
  </div>`;

  return `
  ${renderTopNav({ title: 'APPROVAL QUEUE', hideBack: true })}
  <div class="view-narrow">
    <div class="page-header">
      <div>
        <div class="page-title">Approval Queue</div>
        <div class="page-subtitle">${pendingApprovals.length} item${pendingApprovals.length !== 1 ? 's' : ''} pending</div>
      </div>
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--indigo),var(--violet));display:flex;align-items:center;justify-content:center;font-size:18px">✅</div>
    </div>
    ${approvalsHtml}
  </div>`;
}

async function approveApprovalItem(approvalId) {
  const result = await api('POST', `/api/approvals/${approvalId}/approve`, {});
  if (result?.success) {
    document.getElementById(`approval-${approvalId}`)?.remove();
    toast('Approval accepted ✅', 'success');
    await loadState();
    render();
  } else {
    toast('Failed to approve', 'error');
  }
}

function showRejectFeedback(approvalId) {
  const modal = document.createElement('div');
  modal.id = 'reject-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML = `
  <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:32px;max-width:400px;width:90%">
    <h2 style="margin:0 0 16px;font-size:18px;color:var(--text-1)">Feedback</h2>
    <textarea id="reject-feedback" placeholder="What changes would you like to see?"
      style="width:100%;height:120px;padding:12px;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.05);color:var(--text-1);font-family:inherit;font-size:13px;resize:none"></textarea>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button onclick="document.getElementById('reject-modal').remove()"
        style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.05);color:var(--text-1);cursor:pointer">Cancel</button>
      <button onclick="rejectApprovalWithFeedback('${approvalId}')"
        style="flex:1;padding:10px;border-radius:8px;border:none;background:#ef4444;color:#fff;cursor:pointer;font-weight:600">Reject</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('reject-feedback').focus();
}

async function rejectApprovalWithFeedback(approvalId) {
  const feedback = document.getElementById('reject-feedback')?.value || '';
  const modal = document.getElementById('reject-modal');
  modal?.remove();

  const result = await api('POST', `/api/approvals/${approvalId}/reject`, { feedback });
  if (result?.success) {
    document.getElementById(`approval-${approvalId}`)?.remove();
    toast('Feedback submitted 💬', 'success');
    await loadState();
    render();
  } else {
    toast('Failed to reject', 'error');
  }
}

// ── Task 7.3: Cost Dashboard ──

function viewCostDashboard() {
  const summary = state.costs;
  if (!summary) return `${renderTopNav({ title: 'COSTS', hideBack: true })}<div class="view-narrow"><div style="padding:20px;color:var(--text-3)">Loading cost data...</div></div>`;

  const spentCents = summary.spentCents || 0;
  const ceilingCents = summary.ceilingCents || 10000 * 100; // default to $10k
  const spentPct = ceilingCents > 0 ? Math.round((spentCents / ceilingCents) * 100) : 0;
  const remainingCents = ceilingCents - spentCents;
  const dailyRate = summary.dailyRateCents || 0;
  const daysRemaining = summary.daysRemaining || null;

  // SVG pie chart for costs by agent
  const costByAgent = summary.byAgent || [];
  const totalAgentCost = costByAgent.reduce((sum, a) => sum + (a.totalCostCents || 0), 0) || 1;
  const agentPie = costByAgent.slice(0, 5).map((agent, i) => {
    const pct = totalAgentCost > 0 ? (agent.totalCostCents / totalAgentCost) * 100 : 0;
    const angle = (pct / 100) * 360;
    const colors = ['#4A3AFF', '#7B5FFF', '#06b6d4', '#FFB833', '#2ECC71'];
    return { name: agent.agent, pct, color: colors[i % colors.length], cost: agent.totalCostCents };
  });

  // SVG pie chart HTML
  let svgPie = '';
  let currentAngle = -90;
  agentPie.forEach(item => {
    const radius = 45;
    const startAngle = currentAngle * (Math.PI / 180);
    const endAngle = (currentAngle + (item.pct / 100) * 360) * (Math.PI / 180);
    const x1 = 50 + radius * Math.cos(startAngle);
    const y1 = 50 + radius * Math.sin(startAngle);
    const x2 = 50 + radius * Math.cos(endAngle);
    const y2 = 50 + radius * Math.sin(endAngle);
    const largeArc = item.pct > 50 ? 1 : 0;
    const path = `M 50 50 L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    svgPie += `<path d="${path}" fill="${item.color}" />`;
    currentAngle += (item.pct / 100) * 360;
  });

  return `
  ${renderTopNav({ title: 'COSTS', hideBack: true })}
  <div class="view-narrow">
    <div class="page-header">
      <div>
        <div class="page-title">Cost Dashboard</div>
        <div class="page-subtitle">Budget tracking · Projections</div>
      </div>
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--indigo),var(--violet));display:flex;align-items:center;justify-content:center;font-size:18px">💰</div>
    </div>

    <!-- Budget Overview -->
    <div class="glass" style="padding:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="color:var(--text-3);font-size:12px;font-weight:600">BUDGET</span>
        <span style="color:var(--text-1);font-weight:600">\$${(spentCents/100).toFixed(2)} / \$${(ceilingCents/100).toFixed(2)}</span>
      </div>
      <div style="height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;margin-bottom:12px">
        <div style="height:100%;width:${Math.min(100, spentPct)}%;background:${spentPct > 90 ? '#ef4444' : spentPct > 75 ? '#FFB833' : 'var(--indigo)'}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px">
        <span style="color:var(--text-3)">${spentPct}% spent</span>
        <span style="color:${remainingCents < 0 ? '#ef4444' : 'var(--text-2)'}">\$${(remainingCents/100).toFixed(2)} remaining</span>
      </div>
    </div>

    <!-- Daily Burn & Runway -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div class="glass" style="padding:12px">
        <div style="font-size:11px;color:var(--text-3);text-transform:uppercase;font-weight:600">Daily Burn</div>
        <div style="font-size:18px;font-weight:700;color:var(--text-1);margin-top:8px">\$${(dailyRate/100).toFixed(2)}</div>
      </div>
      <div class="glass" style="padding:12px">
        <div style="font-size:11px;color:var(--text-3);text-transform:uppercase;font-weight:600">Days Remaining</div>
        <div style="font-size:18px;font-weight:700;color:${daysRemaining ? 'var(--text-1)' : 'var(--text-3)'};margin-top:8px">${daysRemaining ?? '—'}</div>
      </div>
    </div>

    <!-- Cost by Agent -->
    ${costByAgent.length > 0 ? `
    <div class="glass" style="padding:16px;margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:12px">Cost by Agent</div>
      <svg viewBox="0 0 100 100" style="width:120px;height:120px;margin:0 auto;display:block">
        ${svgPie}
      </svg>
      <div style="margin-top:12px">
        ${agentPie.map(item => `
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:10px;height:10px;border-radius:50%;background:${item.color}"></div>
            <span style="color:var(--text-2)">${item.name}</span>
          </div>
          <span style="color:var(--text-1);font-weight:600">\$${(item.cost/100).toFixed(2)}</span>
        </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <!-- Alert Indicators -->
    ${spentPct >= 90 ? `
    <div style="padding:12px 16px;background:rgba(239,68,68,0.15);border-radius:12px;border:1px solid rgba(239,68,68,0.3);margin-bottom:16px">
      <div style="color:#ef4444;font-weight:600;font-size:13px">⚠️ Budget at 90%</div>
      <div style="font-size:12px;color:var(--text-3);margin-top:4px">You're approaching your budget ceiling</div>
    </div>` : spentPct >= 75 ? `
    <div style="padding:12px 16px;background:rgba(255,184,51,0.15);border-radius:12px;border:1px solid rgba(255,184,51,0.3);margin-bottom:16px">
      <div style="color:#FFB833;font-weight:600;font-size:13px">⚠️ Budget at 75%</div>
      <div style="font-size:12px;color:var(--text-3);margin-top:4px">Keep an eye on your spending</div>
    </div>` : ''}
  </div>`;
}

// ── PWA Push Notification Setup ────────────────────────────────────────────

async function setupPushNotifications() {
  try {
    if (!navigator.serviceWorker.controller) {
      // Service worker not yet active
      await new Promise(resolve => {
        const handler = () => {
          navigator.serviceWorker.removeEventListener('controllerchange', handler);
          resolve();
        };
        navigator.serviceWorker.addEventListener('controllerchange', handler);
        setTimeout(resolve, 2000);
      });
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Get VAPID public key
      const vapidResponse = await api('GET', '/api/notifications/vapid-key');
      const vapidPublicKey = vapidResponse?.publicKey;

      if (!vapidPublicKey) {
        console.warn('VAPID key not available for push notifications');
        return;
      }

      // Convert VAPID key for subscription
      const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

      // Subscribe to push notifications
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey,
      });
    }

    // Send subscription to backend
    if (subscription) {
      await api('POST', '/api/notifications/subscribe', {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
          auth: arrayBufferToBase64(subscription.getKey('auth')),
        },
      });
    }
  } catch (error) {
    console.warn('Failed to setup push notifications:', error);
  }
}

// Helper: Convert URL-safe Base64 to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}

// Helper: Convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// ── Render ────────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  if (!app) return;

  const views = {
    'tower':               viewTower,
    'new-idea':            viewNewIdea,
    'floor':               viewFloor,
    'floor-chat':          viewFloorChat,
    'gate1':               viewGate1,
    'gate1-voice':         viewGate1Voice,
    'gate1-strategy':      viewGate1Strategy,
    'content-production':  viewContentProduction,
    'gate2':               viewGate2,
    'gate3':               viewGate3,
    'weekly':              viewWeekly,
    'activity':            viewActivity,
    'notifications':       viewNotifications,
    'improvements':        viewImprovements,
    'trust-ladder':        viewTrustLadder,
    'home':                viewHome,
    'floor-dashboard':     viewFloorDashboard,
    'build':               viewBuildTab,
    'review':              viewReviewTab,
    'operations':          viewOperationsTab,
    'settings':            viewSettings,
    'approvals':           viewApprovalQueue,
    'costs':               viewCostDashboard,
  };

  const viewFn = views[router.current] || viewTower;
  app.innerHTML = viewFn();

  // Re-attach any dynamic event listeners
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Sync persistent chat panel visibility with current view
  syncChatPanel();
}

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  render(); // show skeleton immediately
  await loadState();
  render(); // re-render with data

  // Seed approval snapshot so the first poll doesn't re-toast existing approvals
  for (const a of state.approvals.filter(x => x.status === 'pending')) {
    _prevApprovalIds.add(a.id);
  }
  // Seed spend snapshot so the first poll doesn't spuriously trigger refreshes
  for (const f of state.floors) {
    _prevSpentCents[f.id] = f.spentCents;
  }

  // Start Supabase Realtime (replaces fake simulateProgress)
  initRealtime().catch(() => {});

  // Register service worker for PWA functionality
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service worker registration failed — app still works
    });
  }

  // Request notification permission and setup push
  if ('Notification' in window && 'serviceWorker' in navigator) {
    if (Notification.permission === 'default') {
      // First time — ask for permission
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          setupPushNotifications();
        }
      });
    } else if (Notification.permission === 'granted') {
      // Already granted — setup push
      setupPushNotifications();
    }
  }

  // Click tracker for bug report context
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, a, [onclick], .floor-card, .attention-cta');
    if (!el) return;
    actionTracker.track('click', {
      tag: el.tagName,
      text: (el.textContent || '').trim().slice(0, 60),
      classes: (el.className?.split?.(' ') || []).slice(0, 3).join(' '),
    });
  }, true);

  // Floating bug report button
  const fb = document.createElement('button');
  fb.id = 'owner-feedback-btn';
  fb.innerHTML = '🐛';
  fb.title = 'Report an issue';
  fb.onclick = () => showOwnerFeedbackModal();
  document.body.appendChild(fb);

  // Polling as fallback (every 10s) — only re-render if data actually changed
  let lastStateHash = JSON.stringify({
    f: state.floors.map(f => ({ id: f.id, phase: f.currentPhase, status: f.status, spent: f.spentCents })),
    a: state.approvals.map(a => ({ id: a.id, status: a.status })),
    fb: state.feedback?.length,
    t: Object.keys(state.floorTasks).map(k => state.floorTasks[k]?.length),
  });
  // Capture dashboard version at page load — any bump after this triggers the refresh banner
  let knownDashboardVersion = null;
  try {
    const initV = await api('GET', '/api/dashboard/version');
    if (initV && typeof initV.version === 'number') knownDashboardVersion = initV.version;
  } catch {}
  state.pollTimer = setInterval(async () => {
    await loadState();
    // Surface any newly-arrived approvals as owner-facing toast notifications
    checkForNewApprovals();
    // Include spentCents totals so any spend event forces a re-render
    const newHash = JSON.stringify({
      f: state.floors.map(f => ({ id: f.id, phase: f.currentPhase, status: f.status, spent: f.spentCents })),
      a: state.approvals.map(a => ({ id: a.id, status: a.status })),
      fb: state.feedback?.length,
      t: Object.keys(state.floorTasks).map(k => state.floorTasks[k]?.length),
    });
    if (newHash !== lastStateHash) {
      lastStateHash = newHash;
      // Always re-render on state change — approval banners and budget widgets
      // must update regardless of which view the owner is currently on.
      render();
    }
    // Check if dashboard code was patched
    try {
      const vRes = await api('GET', '/api/dashboard/version');
      if (vRes && typeof vRes.version === 'number') {
        if (knownDashboardVersion === null) {
          knownDashboardVersion = vRes.version;
        } else if (vRes.version > knownDashboardVersion) {
          knownDashboardVersion = vRes.version;
          showDashboardUpdateBanner();
        }
      }
    } catch {}
  }, 10000);
}

// Expose globals needed by inline handlers
window.router     = router;
window.state      = state;
window.render     = render;
window.quickFill  = quickFill;
window.goToStep2  = goToStep2;
window.selectAnswer    = selectAnswer;
window.runEvaluation   = runEvaluation;
window.buildIt         = buildIt;
window.approveFoundation = approveFoundation;
window.approveSite     = approveSite;
window.approveContentProduction = approveContentProduction;
window.launchAds       = launchAds;
window.requestChanges  = requestChanges;
window.fetchBrandLogos = fetchBrandLogos;
window.approveImprovement = approveImprovement;
window.rejectImprovement  = rejectImprovement;
window.approveAgentFeedback = approveAgentFeedback;
window.rejectAgentFeedback  = rejectAgentFeedback;
window.submitFloorFeedback  = submitFloorFeedback;
window.showOwnerFeedbackModal = showOwnerFeedbackModal;
window.submitOwnerFeedback = submitOwnerFeedback;
window.closeOwnerFeedbackPopover = closeOwnerFeedbackPopover;
window.actionTracker       = actionTracker;
window.killFloor           = killFloor;
window.confirmDeleteFloor  = confirmDeleteFloor;
window.executeDeleteFloor  = executeDeleteFloor;
window.promoteFloor        = promoteFloor;
window.sendChat        = sendChat;
window.sendFloorChat   = sendFloorChat;
window.openChatPanel   = openChatPanel;
window.closeChatPanel  = closeChatPanel;
window.minimizeChatPanel = minimizeChatPanel;
window.expandChatPanel = expandChatPanel;
window.sendChatPanel   = sendChatPanel;
window.toast           = toast;
window.setLocalPhase   = setLocalPhase;
window.setLocalBrand   = setLocalBrand;
window.closeModal      = closeModal;
window.showDeliverablePreview = showDeliverablePreview;
window.showTaskDeliverable = showTaskDeliverable;
window.showCouncilProposal = showCouncilProposal;
window.retryTask = retryTask;
window.checkForNewApprovals = checkForNewApprovals;
window.approveApprovalItem = approveApprovalItem;
window.showRejectFeedback = showRejectFeedback;
window.rejectApprovalWithFeedback = rejectApprovalWithFeedback;

init();
