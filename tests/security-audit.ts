/**
 * EVE Security Audit
 * Run with: npx tsx tests/security-audit.ts
 * Checks the codebase for security issues without requiring a running server.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface AuditCheck {
  name: string;
  description: string;
  result: 'PASS' | 'FAIL' | 'WARNING';
  details: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
}

const checks: AuditCheck[] = [];

// Utility: colored output
function pass(msg: string) { console.log(`\x1b[32m✓ ${msg}\x1b[0m`); }
function fail(msg: string) { console.log(`\x1b[31m✗ ${msg}\x1b[0m`); }
function warn(msg: string) { console.log(`\x1b[33m⚠ ${msg}\x1b[0m`); }
function info(msg: string) { console.log(`\x1b[36mℹ ${msg}\x1b[0m`); }

// Recursively read all files in a directory
function getAllFiles(dir: string, excludeDirs = new Set(['node_modules', '.git', 'dist', 'build'])): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (excludeDirs.has(entry)) continue;

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...getAllFiles(fullPath, excludeDirs));
      } else {
        files.push(fullPath);
      }
    }
  } catch {
    // Ignore permission errors
  }

  return files;
}

// Read file safely
function readFile(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

// Check 1: No PII in logs
function checkNoPiiInLogs() {
  const srcDir = join(process.cwd(), 'src');
  const files = getAllFiles(srcDir).filter(f => f.endsWith('.ts'));
  const details: string[] = [];

  const piiPatterns = [
    { pattern: /console\.log\([^)]*(?:email|phone|ssn|credit.?card|password)[^)]*\)/gi, name: 'console.log with PII' },
    { pattern: /console\.error\([^)]*(?:email|phone|ssn|credit.?card|password)[^)]*\)/gi, name: 'console.error with PII' },
    { pattern: /logger\.(?:info|error|warn|debug)\([^)]*(?:email|phone|ssn|credit.?card|password)[^)]*\)/gi, name: 'logger with PII' },
  ];

  for (const file of files) {
    const content = readFile(file);
    for (const { pattern, name } of piiPatterns) {
      if (pattern.test(content)) {
        const relPath = file.replace(process.cwd(), '.');
        details.push(`${relPath}: Found ${name}`);
      }
    }
  }

  const check: AuditCheck = {
    name: 'No PII in logs',
    description: 'Verify logs do not contain email, phone, SSN, or credit card data',
    result: details.length === 0 ? 'PASS' : 'FAIL',
    details,
    severity: 'critical',
  };

  checks.push(check);
  return check;
}

// Check 2: No hardcoded secrets
function checkNoHardcodedSecrets() {
  const srcDir = join(process.cwd(), 'src');
  const files = getAllFiles(srcDir).filter(f => f.endsWith('.ts') || f.endsWith('.json'));
  const details: string[] = [];

  const secretPatterns = [
    { pattern: /API_KEY\s*=\s*['"](sk-|pk-)[^'"]+['"]/gi, name: 'Hardcoded API key' },
    { pattern: /SECRET\s*=\s*['"]\w+['"]/gi, name: 'Hardcoded secret' },
    { pattern: /PASSWORD\s*=\s*['"]\w+['"]/gi, name: 'Hardcoded password' },
    { pattern: /STRIPE_KEY\s*=\s*['"](sk_|pk_)[^'"]+['"]/gi, name: 'Hardcoded Stripe key' },
    { pattern: /DATABASE_URL\s*=\s*['"](postgres|mysql):\/\/[^'"]+['"]/gi, name: 'Hardcoded DB URL' },
    // Exclude process.env references
    { pattern: /(?<!process\.env\[)API_KEY\s*=\s*['"](sk-|pk-)[^'"]*['"]/gi, name: 'Hardcoded API key (not env)' },
  ];

  for (const file of files) {
    const content = readFile(file);
    // Skip if it's importing from .env or using process.env
    if (content.includes('process.env') && (file.includes('config') || file.includes('.env'))) {
      continue;
    }

    for (const { pattern, name } of secretPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        const relPath = file.replace(process.cwd(), '.');
        details.push(`${relPath}: Found ${name}`);
      }
    }
  }

  const check: AuditCheck = {
    name: 'No hardcoded secrets',
    description: 'Verify no API keys, passwords, or database URLs are hardcoded',
    result: details.length === 0 ? 'PASS' : 'FAIL',
    details,
    severity: 'critical',
  };

  checks.push(check);
  return check;
}

// Check 3: Budget enforcement imported in all API clients
function checkBudgetEnforcement() {
  const clientsDir = join(process.cwd(), 'src', 'clients');
  const files = getAllFiles(clientsDir)
    .filter(f => f.endsWith('.ts') && ['anthropic.ts', 'fal.ts', 'openai.ts', 'elevenlabs.ts'].some(cf => f.includes(cf)));
  const details: string[] = [];

  const requiredImports = ['budget-check', 'BudgetEnforcer', 'checkBudget'];

  for (const file of files) {
    const content = readFile(file);
    const hasImport = requiredImports.some(imp => content.includes(imp));

    if (!hasImport) {
      const relPath = file.replace(process.cwd(), '.');
      details.push(`${relPath}: Missing budget enforcement import`);
    }
  }

  const check: AuditCheck = {
    name: 'Budget enforcement in API clients',
    description: 'Verify budget-check is imported in anthropic.ts, fal.ts, openai.ts, elevenlabs.ts',
    result: details.length === 0 ? 'PASS' : 'FAIL',
    details,
    severity: 'high',
  };

  checks.push(check);
  return check;
}

// Check 4: HMAC tokens exist and are used
function checkHmacTokens() {
  const securityDir = join(process.cwd(), 'src', 'security');
  const approvalTokenFile = join(securityDir, 'approval-token.ts');
  const approvalsRouteFile = join(process.cwd(), 'src', 'server', 'routes', 'approvals.ts');
  const details: string[] = [];

  const tokenContent = readFile(approvalTokenFile);
  if (!tokenContent.includes('generateApprovalToken') || !tokenContent.includes('verifyApprovalToken')) {
    details.push('approval-token.ts: Missing generateApprovalToken or verifyApprovalToken functions');
  }

  const approvalsContent = readFile(approvalsRouteFile);
  if (!approvalsContent.includes('approvalToken') && !approvalsContent.includes('generateApprovalToken')) {
    details.push('approvals.ts: Not using approval tokens');
  }

  const check: AuditCheck = {
    name: 'HMAC approval tokens',
    description: 'Verify approval-token.ts exists and is used in approval routes',
    result: details.length === 0 ? 'PASS' : 'FAIL',
    details,
    severity: 'high',
  };

  checks.push(check);
  return check;
}

// Check 5: Immutable rules
function checkImmutableRules() {
  const rulesFile = join(process.cwd(), 'src', 'security', 'immutable-rules.ts');
  const details: string[] = [];

  const content = readFile(rulesFile);
  if (!content.includes('IMMUTABLE_RULES')) {
    details.push('immutable-rules.ts: Missing IMMUTABLE_RULES export');
  }

  const ruleCount = (content.match(/name:\s*'/g) || []).length;
  if (ruleCount < 10) {
    details.push(`immutable-rules.ts: Found ${ruleCount} rules, expected at least 10`);
  }

  const requiredRules = [
    'no-pii-in-prompts',
    'no-cross-floor-access',
    'budget-ceiling-enforced',
    'no-unapproved-transactions',
    'no-external-commands',
    'human-approval-gates',
    'no-credential-exposure',
    'escalate-when-uncertain',
    'no-direct-owner-contact',
    'immutable-rules-cannot-change',
  ];

  for (const rule of requiredRules) {
    if (!content.includes(`'${rule}'`)) {
      details.push(`immutable-rules.ts: Missing rule "${rule}"`);
    }
  }

  const check: AuditCheck = {
    name: 'Immutable rules completeness',
    description: 'Verify all 10 immutable rules are defined',
    result: details.length === 0 ? 'PASS' : 'FAIL',
    details,
    severity: 'critical',
  };

  checks.push(check);
  return check;
}

// Check 6: Cross-floor isolation (RLS)
function checkCrossFloorIsolation() {
  const migrationsDir = join(process.cwd(), 'migrations') || join(process.cwd(), 'supabase', 'migrations');
  const details: string[] = [];

  try {
    const files = getAllFiles(migrationsDir).filter(f => f.endsWith('.sql'));
    const hasRls = files.some(f => {
      const content = readFile(f);
      return content.includes('RLS') || content.includes('ENABLE ROW LEVEL SECURITY');
    });

    if (!hasRls) {
      details.push('migrations: No RLS (Row Level Security) enabled in database migrations');
    }
  } catch {
    details.push('migrations: Could not check RLS in database migrations (migrations dir not found)');
  }

  const check: AuditCheck = {
    name: 'Cross-floor isolation (RLS)',
    description: 'Verify row-level security is configured in database',
    result: details.length === 0 ? 'PASS' : 'WARNING',
    details,
    severity: 'high',
  };

  checks.push(check);
  return check;
}

// Check 7: Auth middleware
function checkAuthMiddleware() {
  const authFile = join(process.cwd(), 'src', 'server', 'middleware', 'auth.ts');
  const details: string[] = [];

  const content = readFile(authFile);
  if (!content.includes('registerAuthMiddleware') || !content.includes('authorization')) {
    details.push('auth.ts: Missing authorization header check');
  }

  if (!content.includes('Bearer ') && !content.includes('Bearer')) {
    details.push('auth.ts: Not checking Bearer token');
  }

  if (!content.includes('EVE_API_KEY') && !content.includes('API_KEY')) {
    details.push('auth.ts: Not checking API key from environment');
  }

  const check: AuditCheck = {
    name: 'Auth middleware',
    description: 'Verify auth.ts checks authorization header and API key',
    result: details.length === 0 ? 'PASS' : 'FAIL',
    details,
    severity: 'critical',
  };

  checks.push(check);
  return check;
}

// Check 8: Guardian security checks
function checkGuardian() {
  const guardianFile = join(process.cwd(), 'src', 'security', 'guardian.ts');
  const details: string[] = [];

  const content = readFile(guardianFile);
  const requiredMethods = ['checkOutputPII', 'checkAntiSlop', 'verify'];

  for (const method of requiredMethods) {
    if (!content.includes(method)) {
      details.push(`guardian.ts: Missing ${method} method`);
    }
  }

  const requiredChecks = ['PII', 'budget', 'concurrency', 'API key', 'SSN', 'credit card'];
  for (const check of requiredChecks) {
    if (!content.includes(check)) {
      details.push(`guardian.ts: Missing check for ${check}`);
    }
  }

  const checkObj: AuditCheck = {
    name: 'Guardian security checks',
    description: 'Verify Guardian class has all required security checks',
    result: details.length === 0 ? 'PASS' : 'FAIL',
    details,
    severity: 'high',
  };

  checks.push(checkObj);
  return checkObj;
}

// Check 9: No debug mode in production
function checkNoDebugMode() {
  const srcDir = join(process.cwd(), 'src');
  const files = getAllFiles(srcDir).filter(f => f.endsWith('.ts'));
  const details: string[] = [];

  const debugPatterns = [
    { pattern: /DEBUG\s*=\s*true/gi, name: 'DEBUG=true hardcoded' },
    { pattern: /NODE_ENV\s*===\s*['"]development['"]/gi, name: 'Direct development check (should use env var)' },
  ];

  for (const file of files) {
    const content = readFile(file);
    for (const { pattern, name } of debugPatterns) {
      if (pattern.test(content) && !file.includes('test') && !file.includes('config')) {
        const relPath = file.replace(process.cwd(), '.');
        details.push(`${relPath}: Found ${name}`);
      }
    }
  }

  const check: AuditCheck = {
    name: 'No debug mode in production',
    description: 'Verify DEBUG or development-only code is not hardcoded',
    result: details.length === 0 ? 'PASS' : 'WARNING',
    details,
    severity: 'medium',
  };

  checks.push(check);
  return check;
}

// Check 10: Dependency security
function checkDependencySecurity() {
  const packageJsonPath = join(process.cwd(), 'package.json');
  const details: string[] = [];

  const content = readFile(packageJsonPath);
  try {
    const pkg = JSON.parse(content) as Record<string, unknown>;
    const deps = { ...((pkg.dependencies || {}) as Record<string, string>), ...((pkg.devDependencies || {}) as Record<string, string>) };

    // Check for known vulnerable packages (very basic check)
    const suspiciousPatterns = [
      { name: 'eval', words: ['eval', 'Function'] },
      { name: 'unsafe-polyfill', words: ['unsafe'] },
    ];

    const depNames = Object.keys(deps);
    for (const { name, words } of suspiciousPatterns) {
      for (const word of words) {
        const found = depNames.filter(d => d.toLowerCase().includes(word));
        if (found.length > 0) {
          details.push(`Found potentially unsafe dependency: ${found.join(', ')}`);
        }
      }
    }

    // Check for recommended security packages
    if (!depNames.includes('helmet') && !depNames.includes('@fastify/helmet')) {
      details.push('Consider adding helmet for HTTP header security');
    }
  } catch {
    details.push('Could not parse package.json');
  }

  const check: AuditCheck = {
    name: 'Dependency security',
    description: 'Verify dependencies are safe and security packages are included',
    result: details.length === 0 ? 'PASS' : 'WARNING',
    details,
    severity: 'medium',
  };

  checks.push(check);
  return check;
}

// Print success message
function printSuccess(msg: string) { pass(msg); }

// Print results
function printResults() {
  console.clear();
  console.log('\x1b[1m' + '='.repeat(80));
  console.log('EVE SECURITY AUDIT');
  console.log('='.repeat(80) + '\x1b[0m\n');

  const bySeverity = {
    critical: checks.filter(c => c.severity === 'critical'),
    high: checks.filter(c => c.severity === 'high'),
    medium: checks.filter(c => c.severity === 'medium'),
    low: checks.filter(c => c.severity === 'low'),
  };

  // Print by severity
  for (const [severity, severityChecks] of Object.entries(bySeverity)) {
    if (severityChecks.length === 0) continue;

    const severityColor = severity === 'critical' ? '\x1b[31m' : severity === 'high' ? '\x1b[33m' : '\x1b[36m';
    console.log(`${severityColor}${severity.toUpperCase()} (${severityChecks.length})\x1b[0m`);
    console.log('-'.repeat(80));

    for (const check of severityChecks) {
      const icon = check.result === 'PASS' ? '\x1b[32m✓\x1b[0m' : check.result === 'FAIL' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m⚠\x1b[0m';
      console.log(`${icon} ${check.name}`);
      console.log(`  ${check.description}`);

      if (check.details.length > 0) {
        for (const detail of check.details.slice(0, 3)) {
          console.log(`    - ${detail}`);
        }
        if (check.details.length > 3) {
          console.log(`    ... and ${check.details.length - 3} more`);
        }
      }
      console.log('');
    }
  }

  // Summary
  const passCount = checks.filter(c => c.result === 'PASS').length;
  const failCount = checks.filter(c => c.result === 'FAIL').length;
  const warnCount = checks.filter(c => c.result === 'WARNING').length;

  console.log('='.repeat(80));
  console.log(`SUMMARY: ${passCount} passed, ${failCount} failed, ${warnCount} warnings\n`);

  if (failCount > 0) {
    fail(`${failCount} critical security issue(s) found. Please address before deployment.`);
    return 1;
  }

  if (warnCount > 0) {
    warn(`${warnCount} warning(s) found. Review and remediate if necessary.`);
  }

  printSuccess('Security audit complete!');
  return 0;
}

// Main
async function main() {
  info('Running security audit...\n');

  // Run all checks
  checkNoPiiInLogs();
  checkNoHardcodedSecrets();
  checkBudgetEnforcement();
  checkHmacTokens();
  checkImmutableRules();
  checkCrossFloorIsolation();
  checkAuthMiddleware();
  checkGuardian();
  checkNoDebugMode();
  checkDependencySecurity();

  // Print results and exit
  const exitCode = printResults();
  process.exit(exitCode);
}

main().catch((err) => {
  fail(`Audit crashed: ${(err as Error).message}`);
  process.exit(1);
});
