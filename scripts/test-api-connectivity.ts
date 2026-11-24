#!/usr/bin/env tsx
/**
 * Diagnostic Utility Script: Football Data Providers Connectivity & Schema Validation
 * Tests authentication, HTTP headers, rate-limiting quotas, and JSON response structure
 * for Football-Data.org (v4) and API-Football (v3).
 *
 * Usage:
 *   npx tsx scripts/test-api-connectivity.ts
 *   npm run test:api
 */

import dotenv from 'dotenv';
dotenv.config();

import { FootballDataProvider } from '../src/data/providers/footballDataProvider.ts';
import { ApiFootballProvider } from '../src/data/providers/apiFootballProvider.ts';

// ANSI terminal colors for formatted output
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function maskKey(key: string | undefined): string {
  if (!key) return '(not set)';
  if (key.length <= 8) return '****' + key.slice(-2);
  return `${key.slice(0, 4)}...${key.slice(-4)} (${key.length} chars)`;
}

interface TestResult {
  provider: string;
  configured: boolean;
  authenticated: boolean;
  httpStatus: number | string;
  latencyMs: number;
  rateLimitInfo: string;
  schemaValid: boolean;
  moduleHealth: boolean;
  notes: string[];
}

async function testFootballDataOrg(): Promise<TestResult> {
  console.log(`\n${c.bold}${c.cyan}================================================================${c.reset}`);
  console.log(`${c.bold}${c.cyan} 1. DIAGNOSTIC: Football-Data.org (API v4 Direct)${c.reset}`);
  console.log(`${c.bold}${c.cyan}================================================================${c.reset}`);

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  console.log(`[Config] FOOTBALL_DATA_API_KEY: ${c.yellow}${maskKey(apiKey)}${c.reset}`);

  const notes: string[] = [];
  if (!apiKey) {
    console.log(`${c.yellow}⚠ Warning: FOOTBALL_DATA_API_KEY is not defined in environment.${c.reset}`);
    notes.push('Missing FOOTBALL_DATA_API_KEY; running in STANDBY mode.');
    return {
      provider: 'Football-Data.org',
      configured: false,
      authenticated: false,
      httpStatus: 'N/A',
      latencyMs: 0,
      rateLimitInfo: 'N/A',
      schemaValid: false,
      moduleHealth: false,
      notes,
    };
  }

  // 1. Direct Raw HTTP Check to verify authentication & response schema
  console.log(`\n[Direct HTTP Check] Requesting GET https://api.football-data.org/v4/competitions ...`);
  const startTime = Date.now();
  let directOk = false;
  let status = 0;
  let latency = 0;
  let rateLimit = 'Unknown';
  let schemaOk = false;

  try {
    const res = await fetch('https://api.football-data.org/v4/competitions', {
      headers: {
        'X-Auth-Token': apiKey,
        'User-Agent': 'PitchIntel-Diagnostic/1.0',
      },
    });

    latency = Date.now() - startTime;
    status = res.status;
    console.log(`[HTTP Response] Status: ${status === 200 ? c.green : c.red}${status} ${res.statusText}${c.reset} (${latency}ms)`);

    // Extract Football-Data.org rate limit headers
    const reqAvailable = res.headers.get('x-requests-available-minute');
    const reqReset = res.headers.get('x-requestcounter-reset');
    if (reqAvailable !== null) {
      rateLimit = `${reqAvailable} req/min available (Resets in ${reqReset || '?'}s)`;
      console.log(`[Rate Limit Header] Available: ${c.cyan}${reqAvailable}${c.reset} req/min, Reset: ${reqReset || '?'}s`);
    }

    if (res.ok) {
      directOk = true;
      const data = await res.json();

      // Validate JSON response structure
      console.log(`\n[Response Structure Validation]`);
      const hasCount = typeof data.count === 'number';
      const hasCompetitions = Array.isArray(data.competitions);
      const compsCount = data.competitions?.length || 0;
      const clientName = data.filters?.client || 'Free/Standard Tier';

      console.log(`  - Top-level count field: ${hasCount ? c.green + '✓ Present (' + data.count + ')' : c.red + '✗ Missing'}${c.reset}`);
      console.log(`  - Competitions array: ${hasCompetitions ? c.green + '✓ Present (' + compsCount + ' items)' : c.red + '✗ Missing'}${c.reset}`);
      console.log(`  - Authenticated Client / Plan: ${c.cyan}${clientName}${c.reset}`);

      if (hasCompetitions && compsCount > 0) {
        const sample = data.competitions[0];
        console.log(`  - Sample entity [${sample.code || sample.id}]: "${sample.name}" in ${sample.area?.name || 'Global'} (${sample.plan || 'Standard'})`);
        schemaOk = typeof sample.name === 'string' && typeof sample.id === 'number';
      }

      notes.push(`Authenticated successfully (${compsCount} competitions reachable, ${clientName}).`);
    } else {
      const errText = await res.text();
      console.log(`${c.red}Authentication/API Error:${c.reset} ${errText}`);
      notes.push(`HTTP ${status}: ${errText.slice(0, 120)}`);
    }
  } catch (err: any) {
    latency = Date.now() - startTime;
    console.log(`${c.red}Network / Connection Error:${c.reset} ${err.message}`);
    notes.push(`Network error: ${err.message}`);
  }

  // 2. Integration Module Verification (FootballDataProvider class)
  console.log(`\n[Module Check] Testing FootballDataProvider class implementation ...`);
  const provider = new FootballDataProvider();
  const health = await provider.checkHealth();
  console.log(`  - provider.checkHealth(): ${health.isOnline ? c.green + 'ONLINE' : c.red + 'OFFLINE'}${c.reset} (Latency: ${health.latencyMs}ms)`);
  console.log(`  - Health message: ${c.dim}${health.message}${c.reset}`);

  try {
    const competitions = await provider.fetchCompetitions();
    console.log(`  - provider.fetchCompetitions(): ${c.green}✓ Returned ${competitions.length} normalized competitions${c.reset}`);
    const sample = competitions.slice(0, 3).map((comp) => `${comp.code} (${comp.name})`).join(', ');
    console.log(`  - Normalized samples: ${c.dim}${sample}${c.reset}`);
  } catch (err: any) {
    console.log(`  - provider.fetchCompetitions() error: ${c.red}${err.message}${c.reset}`);
    notes.push(`Module method error: ${err.message}`);
  }

  return {
    provider: 'Football-Data.org (v4)',
    configured: true,
    authenticated: directOk,
    httpStatus: status,
    latencyMs: latency,
    rateLimitInfo: rateLimit,
    schemaValid: schemaOk,
    moduleHealth: health.isOnline,
    notes,
  };
}

async function testApiFootball(): Promise<TestResult> {
  console.log(`\n${c.bold}${c.cyan}================================================================${c.reset}`);
  console.log(`${c.bold}${c.cyan} 2. DIAGNOSTIC: API-Football / API-Sports (v3 Direct)${c.reset}`);
  console.log(`${c.bold}${c.cyan}================================================================${c.reset}`);

  const apiKey = process.env.API_FOOTBALL_KEY || process.env.RAPIDAPI_KEY;
  const isRapidApi = Boolean(!process.env.API_FOOTBALL_KEY && process.env.RAPIDAPI_KEY);
  console.log(`[Config] API_FOOTBALL_KEY: ${c.yellow}${maskKey(apiKey)}${c.reset} ${isRapidApi ? '(RapidAPI mode)' : '(Direct api-sports.io)'}`);

  const notes: string[] = [];
  if (!apiKey) {
    console.log(`${c.yellow}⚠ Warning: API_FOOTBALL_KEY is not defined in environment.${c.reset}`);
    notes.push('Missing API_FOOTBALL_KEY; running in STANDBY mode with Cloud SQL / OpenFootball as active source.');
    return {
      provider: 'API-Football (v3)',
      configured: false,
      authenticated: false,
      httpStatus: 'N/A',
      latencyMs: 0,
      rateLimitInfo: 'N/A',
      schemaValid: false,
      moduleHealth: false,
      notes,
    };
  }

  const baseUrl = isRapidApi
    ? 'https://api-football-v1.p.rapidapi.com/v3'
    : 'https://v3.football.api-sports.io';

  const headers: Record<string, string> = isRapidApi
    ? {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
        'User-Agent': 'PitchIntel-Diagnostic/1.0',
      }
    : {
        'x-apisports-key': apiKey,
        'User-Agent': 'PitchIntel-Diagnostic/1.0',
      };

  // 1. Direct Raw HTTP Check to official /status endpoint
  console.log(`\n[Direct HTTP Check] Requesting GET ${baseUrl}/status ...`);
  const startTime = Date.now();
  let directOk = false;
  let status = 0;
  let latency = 0;
  let rateLimit = 'Unknown';
  let schemaOk = false;

  try {
    const res = await fetch(`${baseUrl}/status`, { headers });
    latency = Date.now() - startTime;
    status = res.status;
    console.log(`[HTTP Response] Status: ${status === 200 ? c.green : c.red}${status} ${res.statusText}${c.reset} (${latency}ms)`);

    // Extract API-Football rate limit headers
    const remaining = res.headers.get('x-ratelimit-requests-remaining');
    const limit = res.headers.get('x-ratelimit-requests-limit');
    if (remaining !== null && limit !== null) {
      rateLimit = `${remaining} / ${limit} requests remaining`;
      console.log(`[Rate Limit Header] Remaining: ${c.cyan}${remaining} / ${limit}${c.reset}`);
    }

    if (res.ok) {
      const data = await res.json();

      // Check if API-Football returned internal errors array
      const errors = data.errors;
      const hasErrors = errors && (Array.isArray(errors) ? errors.length > 0 : Object.keys(errors).length > 0);

      if (hasErrors) {
        console.log(`${c.red}API-Football returned internal error payload:${c.reset}`, JSON.stringify(errors));
        notes.push(`API-Football error: ${JSON.stringify(errors)}`);
      } else {
        directOk = true;
        console.log(`\n[Response Structure Validation]`);
        const account = data.response?.account;
        const subscription = data.response?.subscription;
        const requests = data.response?.requests;

        const hasAccount = !!account;
        const hasSub = !!subscription;
        const hasReq = !!requests;

        console.log(`  - response.account: ${hasAccount ? c.green + '✓ Present (' + (account.email || account.firstname || 'Active Account') + ')' : c.red + '✗ Missing'}${c.reset}`);
        console.log(`  - response.subscription: ${hasSub ? c.green + '✓ Present (Plan: ' + subscription.plan + ', Active: ' + subscription.active + ')' : c.red + '✗ Missing'}${c.reset}`);
        console.log(`  - response.requests: ${hasReq ? c.green + '✓ Present (Used: ' + requests.current + ' / ' + requests.limit_day + ' daily limit)' : c.red + '✗ Missing'}${c.reset}`);

        schemaOk = hasAccount && hasSub && hasReq;
        notes.push(`Authenticated (Plan: ${subscription?.plan || 'Free'}, Used: ${requests?.current || 0}/${requests?.limit_day || 100} daily requests).`);
      }
    } else {
      const errText = await res.text();
      console.log(`${c.red}Authentication/API Error:${c.reset} ${errText}`);
      notes.push(`HTTP ${status}: ${errText.slice(0, 120)}`);
    }
  } catch (err: any) {
    latency = Date.now() - startTime;
    console.log(`${c.red}Network / Connection Error:${c.reset} ${err.message}`);
    notes.push(`Network error: ${err.message}`);
  }

  // 2. Integration Module Verification (ApiFootballProvider class)
  console.log(`\n[Module Check] Testing ApiFootballProvider class implementation ...`);
  const provider = new ApiFootballProvider();
  const health = await provider.checkHealth();
  console.log(`  - provider.checkHealth(): ${health.isOnline ? c.green + 'ONLINE' : c.red + 'OFFLINE'}${c.reset} (Latency: ${health.latencyMs}ms)`);
  console.log(`  - Health message: ${c.dim}${health.message}${c.reset}`);

  const trackedLimits = provider.getRateLimitInfo();
  if (trackedLimits.remaining !== undefined) {
    console.log(`  - provider.getRateLimitInfo(): Remaining: ${trackedLimits.remaining}, Limit: ${trackedLimits.limit}`);
  }

  return {
    provider: 'API-Football (v3)',
    configured: true,
    authenticated: directOk,
    httpStatus: status,
    latencyMs: latency,
    rateLimitInfo: rateLimit,
    schemaValid: schemaOk,
    moduleHealth: health.isOnline,
    notes,
  };
}

async function runDiagnostic() {
  console.log(`${c.bold}${c.magenta}========================================================================${c.reset}`);
  console.log(`${c.bold}${c.magenta} PITCHINTEL: EXTERNAL FOOTBALL API AUTHENTICATION & DIAGNOSTIC UTILITY${c.reset}`);
  console.log(`${c.bold}${c.magenta} Timestamp: ${new Date().toISOString()}${c.reset}`);
  console.log(`${c.bold}${c.magenta}========================================================================${c.reset}`);

  const results: TestResult[] = [];

  // Run tests
  results.push(await testFootballDataOrg());
  results.push(await testApiFootball());

  // Print Summary Table
  console.log(`\n${c.bold}========================================================================${c.reset}`);
  console.log(`${c.bold} DIAGNOSTIC SUMMARY REPORT${c.reset}`);
  console.log(`${c.bold}========================================================================${c.reset}\n`);

  console.log(
    `${'Provider'.padEnd(25)} | ${'Configured'.padEnd(10)} | ${'Auth'.padEnd(8)} | ${'Status'.padEnd(8)} | ${'Latency'.padEnd(9)} | ${'Schema'.padEnd(8)} | ${'Module'.padEnd(8)}`
  );
  console.log('---------------------------------------------------------------------------------------------------');

  for (const r of results) {
    const configStr = r.configured ? `${c.green}YES${c.reset}` : `${c.yellow}STANDBY${c.reset}`;
    const authStr = r.authenticated ? `${c.green}PASS${c.reset}` : `${c.red}FAIL${c.reset}`;
    const schemaStr = r.schemaValid ? `${c.green}VALID${c.reset}` : `${c.red}INVALID${c.reset}`;
    const moduleStr = r.moduleHealth ? `${c.green}ONLINE${c.reset}` : `${c.red}OFFLINE${c.reset}`;
    const latencyStr = r.latencyMs > 0 ? `${r.latencyMs}ms` : 'N/A';

    console.log(
      `${r.provider.padEnd(25)} | ${configStr.padEnd(19)} | ${authStr.padEnd(17)} | ${String(r.httpStatus).padEnd(8)} | ${latencyStr.padEnd(9)} | ${schemaStr.padEnd(17)} | ${moduleStr}`
    );
  }

  console.log('\n[Detailed Diagnostic Notes]');
  for (const r of results) {
    console.log(`  * ${c.bold}${r.provider}${c.reset}:`);
    for (const note of r.notes) {
      console.log(`      - ${note}`);
    }
  }

  console.log(`\n${c.bold}${c.green}Diagnostic completed.${c.reset}\n`);
}

runDiagnostic().catch((err) => {
  console.error('Fatal diagnostic utility error:', err);
  process.exit(1);
});
