/**
 * Task Runner Entry Point
 *
 * Usage: npx ts-node tasks/index.ts <task-name>
 * Example: npx ts-node tasks/index.ts run-daily
 *
 * Scheduled entry points:
 * - run-daily:   update-currency, process-dca, dividend-sync           (cron: 0 1 * * *)
 * - run-weekly:  price-cache-cleanup                                    (cron: 0 2 * * 0)
 * - run-monthly: portfolio-snapshot                                     (cron: 0 3 1 * *)
 *
 * Individual tasks:
 * - update-currency:  Fetch and update exchange rates
 * - process-dca:      Generate pending DCA confirmation records for due plans
 * - dividend-sync:    Sync dividends from yfinance into the dividends table
 * - price-cache-cleanup: Delete price_cache records older than 7 days
 * - portfolio-snapshot:  Generate month-end portfolio snapshots (--month=YYYY-MM to override)
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.task first (task-specific overrides), then fall back to .env
const taskEnvPath = path.join(__dirname, '..', '.env.task');
if (fs.existsSync(taskEnvPath)) {
  dotenv.config({ path: taskEnvPath });
} else {
  dotenv.config();
}

import { UpdateCurrencyTask } from './update-currency.task';
import { DividendSyncTask } from './dividend-sync.task';
import { PortfolioSnapshotTask } from './portfolio-snapshot.task';
import { PriceCacheCleanupTask } from './price-cache-cleanup.task';
import { ProcessDcaTask } from './process-dca.task';

// ── Task factory ────────────────────────────────────────────────────────────

const TASK_FACTORY: Record<string, () => { run: () => Promise<void> }> = {
  'update-currency':    () => new UpdateCurrencyTask(),
  'process-dca':        () => new ProcessDcaTask(),
  'dividend-sync':      () => new DividendSyncTask(),
  'price-cache-cleanup': () => new PriceCacheCleanupTask(),
  'portfolio-snapshot': () => new PortfolioSnapshotTask(),
};

// ── Schedule config ─────────────────────────────────────────────────────────

function loadConfig(): { dailyTasks: string[]; weeklyTasks: string[]; monthlyTasks: string[] } {
  const defaults = {
    dailyTasks:   ['update-currency', 'process-dca', 'dividend-sync'],
    weeklyTasks:  ['price-cache-cleanup'],
    monthlyTasks: ['portfolio-snapshot'],
  };

  const configPath = path.join(__dirname, 'tasks.config.json');
  if (!fs.existsSync(configPath)) return defaults;

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      dailyTasks:   Array.isArray(config.dailyTasks)   ? config.dailyTasks   : defaults.dailyTasks,
      weeklyTasks:  Array.isArray(config.weeklyTasks)  ? config.weeklyTasks  : defaults.weeklyTasks,
      monthlyTasks: Array.isArray(config.monthlyTasks) ? config.monthlyTasks : defaults.monthlyTasks,
    };
  } catch {
    console.error('Failed to parse tasks.config.json, using defaults');
    return defaults;
  }
}

// ── Runner ──────────────────────────────────────────────────────────────────

async function runTasks(label: string, taskNames: string[]): Promise<void> {
  const invalid = taskNames.filter(n => !TASK_FACTORY[n]);
  if (invalid.length > 0) {
    console.error(`Unknown tasks: ${invalid.join(', ')}`);
    console.log('Available tasks:', Object.keys(TASK_FACTORY).join(', '));
    return;
  }

  console.log(`\n[${label}] Tasks to run: ${taskNames.join(' -> ')}\n`);

  for (const name of taskNames) {
    console.log(`\n--- Starting: ${name} ---`);
    const start = Date.now();
    try {
      await TASK_FACTORY[name]().run();
      console.log(`--- Completed: ${name} (${((Date.now() - start) / 1000).toFixed(2)}s) ---`);
    } catch (error) {
      console.error(`--- Failed: ${name} ---`);
      console.error(error);
      // Continue with remaining tasks
    }
  }

  console.log('\n========================================');
  console.log(`  [${label}] All tasks completed`);
  console.log('========================================');
}

// ── Task registry ───────────────────────────────────────────────────────────

const TASKS: Record<string, () => Promise<void>> = {
  // Scheduled entry points
  'run-daily':   () => { const c = loadConfig(); return runTasks('Daily',   c.dailyTasks);   },
  'run-weekly':  () => { const c = loadConfig(); return runTasks('Weekly',  c.weeklyTasks);  },
  'run-monthly': () => { const c = loadConfig(); return runTasks('Monthly', c.monthlyTasks); },
  // Individual tasks
  'update-currency':     () => new UpdateCurrencyTask().run(),
  'process-dca':         () => new ProcessDcaTask().run(),
  'dividend-sync':       () => new DividendSyncTask().run(),
  'price-cache-cleanup': () => new PriceCacheCleanupTask().run(),
  'portfolio-snapshot':  () => new PortfolioSnapshotTask().run(),
};

// ── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const taskName = process.argv[2];

  console.log('========================================');
  console.log('  Firewise Task Runner');
  console.log('========================================');

  if (!taskName) {
    console.log('\nUsage: npx ts-node tasks/index.ts <task-name>\n');
    console.log('Scheduled entry points:');
    console.log('  run-daily    — update-currency, process-dca, dividend-sync');
    console.log('  run-weekly   — price-cache-cleanup');
    console.log('  run-monthly  — portfolio-snapshot');
    console.log('\nIndividual tasks:');
    ['update-currency', 'process-dca', 'dividend-sync', 'price-cache-cleanup', 'portfolio-snapshot']
      .forEach(n => console.log(`  ${n}`));
    process.exit(1);
  }

  if (!TASKS[taskName]) {
    console.error(`\nError: Unknown task "${taskName}"\n`);
    console.log('Available tasks:', Object.keys(TASKS).join(', '));
    process.exit(1);
  }

  console.log(`\nRunning: ${taskName}\n`);
  const startTime = Date.now();

  try {
    await TASKS[taskName]();
    console.log(`\n✓ "${taskName}" completed in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    process.exit(0);
  } catch (error) {
    console.error(`\n✗ "${taskName}" failed after ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    console.error(error);
    process.exit(1);
  }
}

main();
