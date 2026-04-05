/**
 * EVE Performance Baseline
 * Run with: npx tsx tests/performance-baseline.ts
 * Requires: Orchestrator running on localhost:3000
 *
 * Measures response times and memory usage for key endpoints.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface PerformanceMetrics {
  endpoint: string;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

interface MemorySnapshot {
  heapUsedMb: number;
  heapTotalMb: number;
  rss: number;
  external: number;
}

interface BaselineReport {
  timestamp: string;
  endpoints: PerformanceMetrics[];
  memory: MemorySnapshot;
  totalTests: number;
  failedTests: number;
}

const BASE_URL = 'http://localhost:3000';
const REQUESTS_PER_ENDPOINT = 10;
const ENDPOINTS = [
  '/api/health',
  '/api/health/integrations',
  '/api/floors',
  '/api/costs/summary',
  '/api/heartbeat',
];

// Utility: colored output
function success(msg: string) { console.log(`\x1b[32m✓ ${msg}\x1b[0m`); }
function error(msg: string) { console.log(`\x1b[31m✗ ${msg}\x1b[0m`); }
function info(msg: string) { console.log(`\x1b[36mℹ ${msg}\x1b[0m`); }
function section(msg: string) { console.log(`\n\x1b[1m${msg}\x1b[0m`); }

// HTTP request with timing
async function request(endpoint: string, headers?: Record<string, string>): Promise<{ status: number; time: number }> {
  const start = Date.now();
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    const time = Date.now() - start;
    return { status: response.status, time };
  } catch (err) {
    const time = Date.now() - start;
    throw new Error(`${endpoint} failed after ${time}ms: ${(err as Error).message}`);
  }
}

// Get auth header if API key is set
function getAuthHeaders(): Record<string, string> {
  if (process.env['EVE_API_KEY']) {
    return { 'Authorization': `Bearer ${process.env['EVE_API_KEY']}` };
  }
  return {};
}

// Calculate percentile from sorted times
function percentile(times: number[], p: number): number {
  const sorted = [...times].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// Benchmark a single endpoint
async function benchmarkEndpoint(endpoint: string): Promise<PerformanceMetrics> {
  const times: number[] = [];
  const authHeaders = getAuthHeaders();
  let failed = 0;

  info(`Benchmarking ${endpoint}...`);

  for (let i = 0; i < REQUESTS_PER_ENDPOINT; i++) {
    try {
      const { time } = await request(endpoint, authHeaders);
      times.push(time);
      process.stdout.write('.');
    } catch (err) {
      error((err as Error).message);
      failed++;
    }
  }

  console.log('');

  if (times.length === 0) {
    throw new Error(`All requests to ${endpoint} failed`);
  }

  return {
    endpoint,
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    p99Ms: percentile(times, 99),
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
  };
}

// Get memory usage from /api/health if available, otherwise from process
async function getMemorySnapshot(): Promise<MemorySnapshot> {
  try {
    const authHeaders = getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/health`, {
      headers: authHeaders,
    });
    const data = await response.json() as Record<string, unknown>;

    if (data && typeof data === 'object' && 'memory' in data && data.memory) {
      const mem = data.memory as Record<string, unknown>;
      return {
        heapUsedMb: (mem.heapUsed as number) / 1024 / 1024 || 0,
        heapTotalMb: (mem.heapTotal as number) / 1024 / 1024 || 0,
        rss: (mem.rss as number) / 1024 / 1024 || 0,
        external: (mem.external as number) / 1024 / 1024 || 0,
      };
    }
  } catch {
    // Fall through to local measurement
  }

  // Local process measurement
  const mem = process.memoryUsage();
  return {
    heapUsedMb: mem.heapUsed / 1024 / 1024,
    heapTotalMb: mem.heapTotal / 1024 / 1024,
    rss: mem.rss / 1024 / 1024,
    external: mem.external / 1024 / 1024,
  };
}

// Format metrics as table
function formatMetricsTable(metrics: PerformanceMetrics[]) {
  console.log(`\n${'Endpoint'.padEnd(35)} ${'Avg'.padEnd(10)} ${'P50'.padEnd(10)} ${'P95'.padEnd(10)} ${'P99'.padEnd(10)}`);
  console.log('-'.repeat(75));

  metrics.forEach(m => {
    const endpoint = m.endpoint.substring(0, 34).padEnd(35);
    const avg = `${m.avgMs.toFixed(1)}ms`.padEnd(10);
    const p50 = `${m.p50Ms.toFixed(1)}ms`.padEnd(10);
    const p95 = `${m.p95Ms.toFixed(1)}ms`.padEnd(10);
    const p99 = `${m.p99Ms.toFixed(1)}ms`.padEnd(10);
    console.log(`${endpoint} ${avg} ${p50} ${p95} ${p99}`);
  });
}

// Format memory info
function formatMemoryInfo(mem: MemorySnapshot) {
  console.log(`\n${'Memory Metric'.padEnd(30)} ${'Value'.padEnd(15)}`);
  console.log('-'.repeat(45));
  console.log(`${'Heap Used'.padEnd(30)} ${mem.heapUsedMb.toFixed(2)} MB`);
  console.log(`${'Heap Total'.padEnd(30)} ${mem.heapTotalMb.toFixed(2)} MB`);
  console.log(`${'RSS (Resident Set)'.padEnd(30)} ${mem.rss.toFixed(2)} MB`);
  console.log(`${'External'.padEnd(30)} ${mem.external.toFixed(2)} MB`);
}

// Main
async function main() {
  console.clear();
  section('EVE Performance Baseline');
  info(`Server: ${BASE_URL}`);
  info(`Requests per endpoint: ${REQUESTS_PER_ENDPOINT}`);
  info(`Timestamp: ${new Date().toISOString()}\n`);

  let totalTests = 0;
  let failedTests = 0;

  // Check connectivity
  try {
    await request('/api/health');
  } catch (err) {
    error(`Server not reachable at ${BASE_URL}`);
    error(`Please ensure the Orchestrator is running: npx tsx src/index.ts`);
    process.exit(1);
  }

  success('Server reachable');

  // Run benchmarks
  const metrics: PerformanceMetrics[] = [];

  for (const endpoint of ENDPOINTS) {
    try {
      totalTests++;
      const result = await benchmarkEndpoint(endpoint);
      metrics.push(result);
      success(`${endpoint}: avg ${result.avgMs.toFixed(1)}ms, p95 ${result.p95Ms.toFixed(1)}ms`);
    } catch (err) {
      error(`${endpoint}: ${(err as Error).message}`);
      failedTests++;
    }
  }

  // Get memory snapshot
  section('Memory Usage');
  const memory = await getMemorySnapshot();

  // Format and print results
  section('Performance Results');
  formatMetricsTable(metrics);

  section('Memory Snapshot');
  formatMemoryInfo(memory);

  // Save results to file
  const report: BaselineReport = {
    timestamp: new Date().toISOString(),
    endpoints: metrics,
    memory,
    totalTests,
    failedTests,
  };

  const reportPath = join(process.cwd(), 'tests', 'baseline-results.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  success(`Baseline results saved to ${reportPath}`);

  // Summary
  section('Summary');
  console.log(`Total endpoints tested: ${totalTests}`);
  console.log(`Failed: ${failedTests}`);

  if (metrics.length > 0) {
    const avgOfAvgs = metrics.reduce((sum, m) => sum + m.avgMs, 0) / metrics.length;
    const avgOfP95s = metrics.reduce((sum, m) => sum + m.p95Ms, 0) / metrics.length;
    console.log(`Overall avg response time: ${avgOfAvgs.toFixed(1)}ms`);
    console.log(`Overall p95 response time: ${avgOfP95s.toFixed(1)}ms`);
  }

  console.log('');
  process.exit(failedTests > 0 ? 1 : 0);
}

main().catch((err) => {
  error(`Baseline runner crashed: ${(err as Error).message}`);
  process.exit(1);
});
