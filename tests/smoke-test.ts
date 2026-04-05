/**
 * EVE Orchestrator Smoke Test
 * Run with: npx tsx tests/smoke-test.ts
 * Requires: Orchestrator running on localhost:3000
 */

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  message: string;
  responseTime?: number;
}

const BASE_URL = 'http://localhost:3000';
const results: TestResult[] = [];

// Utility: colored output
function pass(msg: string) { console.log(`\x1b[32m✓ ${msg}\x1b[0m`); }
function fail(msg: string) { console.log(`\x1b[31m✗ ${msg}\x1b[0m`); }
function info(msg: string) { console.log(`\x1b[36mℹ ${msg}\x1b[0m`); }

// Utility: HTTP request with timing
async function request(endpoint: string, options?: RequestInit): Promise<{ status: number; data: unknown; time: number }> {
  const start = Date.now();
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    const time = Date.now() - start;
    const contentType = response.headers.get('content-type');
    let data: unknown;
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    return { status: response.status, data, time };
  } catch (error) {
    throw new Error(`Request failed: ${(error as Error).message}`);
  }
}

// Test 1: Health check
async function testHealthCheck() {
  const name = 'Health check (GET /api/health)';
  try {
    const { status, data, time } = await request('/api/health');
    if (status === 200 && typeof data === 'object' && data !== null && 'status' in data) {
      results.push({ name, status: 'PASS', message: `OK (${time}ms)`, responseTime: time });
      pass(`${name}: OK (${time}ms)`);
    } else {
      results.push({ name, status: 'FAIL', message: `Invalid response format` });
      fail(`${name}: Invalid response format`);
    }
  } catch (error) {
    results.push({ name, status: 'FAIL', message: (error as Error).message });
    fail(`${name}: ${(error as Error).message}`);
  }
}

// Test 2: Integration health
async function testIntegrationHealth() {
  const name = 'Integration health (GET /api/health/integrations)';
  try {
    const { status, data, time } = await request('/api/health/integrations');
    if (status === 200 && typeof data === 'object' && data !== null) {
      results.push({ name, status: 'PASS', message: `OK (${time}ms)`, responseTime: time });
      pass(`${name}: OK (${time}ms)`);
    } else {
      results.push({ name, status: 'FAIL', message: `Invalid response format` });
      fail(`${name}: Invalid response format`);
    }
  } catch (error) {
    results.push({ name, status: 'FAIL', message: (error as Error).message });
    fail(`${name}: ${(error as Error).message}`);
  }
}

// Test 3: List floors
async function testListFloors() {
  const name = 'List floors (GET /api/floors)';
  try {
    const authHeader = process.env['EVE_API_KEY'] ? { 'Authorization': `Bearer ${process.env['EVE_API_KEY']}` } : {};
    const { status, data, time } = await request('/api/floors', { headers: authHeader });
    if ((status === 200 || status === 401) && Array.isArray(data) || typeof data === 'object') {
      results.push({ name, status: 'PASS', message: `OK (${time}ms)`, responseTime: time });
      pass(`${name}: OK (${time}ms)`);
    } else {
      results.push({ name, status: 'FAIL', message: `Invalid response format` });
      fail(`${name}: Invalid response format`);
    }
  } catch (error) {
    results.push({ name, status: 'FAIL', message: (error as Error).message });
    fail(`${name}: ${(error as Error).message}`);
  }
}

// Test 4: Cost summary
async function testCostSummary() {
  const name = 'Cost summary (GET /api/costs/summary)';
  try {
    const authHeader = process.env['EVE_API_KEY'] ? { 'Authorization': `Bearer ${process.env['EVE_API_KEY']}` } : {};
    const { status, data, time } = await request('/api/costs/summary', { headers: authHeader });
    if ((status === 200 || status === 401) && typeof data === 'object') {
      results.push({ name, status: 'PASS', message: `OK (${time}ms)`, responseTime: time });
      pass(`${name}: OK (${time}ms)`);
    } else {
      results.push({ name, status: 'FAIL', message: `Invalid response format` });
      fail(`${name}: Invalid response format`);
    }
  } catch (error) {
    results.push({ name, status: 'FAIL', message: (error as Error).message });
    fail(`${name}: ${(error as Error).message}`);
  }
}

// Test 5: Heartbeat
async function testHeartbeat() {
  const name = 'Heartbeat (GET /api/heartbeat)';
  try {
    const authHeader = process.env['EVE_API_KEY'] ? { 'Authorization': `Bearer ${process.env['EVE_API_KEY']}` } : {};
    const { status, data, time } = await request('/api/heartbeat', { headers: authHeader });
    if ((status === 200 || status === 401) && typeof data === 'object') {
      results.push({ name, status: 'PASS', message: `OK (${time}ms)`, responseTime: time });
      pass(`${name}: OK (${time}ms)`);
    } else {
      results.push({ name, status: 'FAIL', message: `Invalid response format` });
      fail(`${name}: Invalid response format`);
    }
  } catch (error) {
    results.push({ name, status: 'FAIL', message: (error as Error).message });
    fail(`${name}: ${(error as Error).message}`);
  }
}

// Test 6: Swagger docs
async function testSwaggerDocs() {
  const name = 'Swagger docs (GET /docs)';
  try {
    const { status, time } = await request('/docs');
    if (status === 200) {
      results.push({ name, status: 'PASS', message: `OK (${time}ms)`, responseTime: time });
      pass(`${name}: OK (${time}ms)`);
    } else {
      results.push({ name, status: 'FAIL', message: `Unexpected status ${status}` });
      fail(`${name}: Unexpected status ${status}`);
    }
  } catch (error) {
    results.push({ name, status: 'FAIL', message: (error as Error).message });
    fail(`${name}: ${(error as Error).message}`);
  }
}

// Test 7: Auth test (should return 401 if API key is set)
async function testAuthRequired() {
  const name = 'Auth enforcement (GET /api/floors without key)';
  try {
    // Make request without auth header
    const { status } = await request('/api/floors');
    const apiKeySet = !!process.env['EVE_API_KEY'];

    if (apiKeySet && status === 401) {
      results.push({ name, status: 'PASS', message: 'Correctly enforced auth (401)' });
      pass(`${name}: Correctly enforced auth (401)`);
    } else if (!apiKeySet && status === 200) {
      results.push({ name, status: 'PASS', message: 'Dev mode (no auth required)' });
      pass(`${name}: Dev mode (no auth required)`);
    } else {
      results.push({ name, status: 'FAIL', message: `Unexpected status ${status}` });
      fail(`${name}: Unexpected status ${status}`);
    }
  } catch (error) {
    results.push({ name, status: 'FAIL', message: (error as Error).message });
    fail(`${name}: ${(error as Error).message}`);
  }
}

// Print summary table
function printSummary() {
  console.log('\n' + '='.repeat(80));
  console.log('SMOKE TEST SUMMARY');
  console.log('='.repeat(80));

  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;

  console.log(`\n${'Test Name'.padEnd(50)} ${'Status'.padEnd(10)} ${'Message'.padEnd(20)}`);
  console.log('-'.repeat(80));

  results.forEach(result => {
    const statusStr = result.status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    const msg = result.message.substring(0, 19);
    const name = result.name.substring(0, 49).padEnd(50);
    const status = statusStr.padEnd(18);
    const message = msg.padEnd(20);
    console.log(`${name} ${status} ${message}`);
  });

  console.log('-'.repeat(80));
  console.log(`\nTotal: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);

  if (failCount > 0) {
    console.log('\nFailed tests:');
    results.filter(r => r.status === 'FAIL').forEach(result => {
      console.log(`  - ${result.name}: ${result.message}`);
    });
  }

  const avgTime = results
    .filter(r => r.responseTime)
    .reduce((sum, r) => sum + (r.responseTime || 0), 0) / results.filter(r => r.responseTime).length;

  console.log(`\nAverage response time: ${avgTime.toFixed(0)}ms`);
  console.log('='.repeat(80) + '\n');
}

// Main
async function main() {
  console.clear();
  info(`Starting smoke tests against ${BASE_URL}`);
  info(`Time: ${new Date().toISOString()}\n`);

  try {
    // Check if server is reachable
    await request('/api/health');
  } catch (error) {
    fail(`Server not reachable at ${BASE_URL}`);
    fail(`Please ensure the Orchestrator is running: npx tsx src/index.ts`);
    process.exit(1);
  }

  // Run all tests
  await testHealthCheck();
  await testIntegrationHealth();
  await testListFloors();
  await testCostSummary();
  await testHeartbeat();
  await testSwaggerDocs();
  await testAuthRequired();

  // Print summary and exit
  printSummary();

  const failCount = results.filter(r => r.status === 'FAIL').length;
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((error) => {
  fail(`Smoke test runner crashed: ${(error as Error).message}`);
  process.exit(1);
});
