/**
 * Task Runner Entry Point
 *
 * Usage: npx ts-node tasks/index.ts <task-name>
 * Example: npx ts-node tasks/index.ts update-currency
 *
 * Available tasks:
 * - run-all: Run configured tasks in sequence (see DAILY_TASKS env or tasks.config.json)
 * - update-currency: Fetch and update exchange rates from external API
 * - check-dividends: Check for dividend payments and create flows
 * - update-growth-rates: Fetch 5yr/10yr growth rates for assets with tickers
 * - generate-monthly-snapshot: Generate monthly financial snapshots for all users
 * - dividend-sync: Sync dividends from yfinance into the dividends table
 * - portfolio-snapshot: Generate month-end portfolio snapshots (use --month=YYYY-MM to override)
 * - price-cache-cleanup: Delete price_cache records older than 7 days
 *
 * Configuration:
 * - Set DAILY_TASKS env var: DAILY_TASKS=update-currency,process-dca,check-dividends
 * - Or create tasks/tasks.config.json with: { "dailyTasks": ["update-currency", ...] }
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
import { CheckDividendsTask } from './check-dividends.task';
import { UpdateGrowthRatesTask } from './update-growth-rates.task';
import { GenerateMonthlySnapshotTask } from './generate-monthly-snapshot.task';
import { DividendSyncTask } from './dividend-sync.task';
import { PortfolioSnapshotTask } from './portfolio-snapshot.task';
import { PriceCacheCleanupTask } from './price-cache-cleanup.task';

/**
 * Load task configuration from env or config file
 */
function loadDailyTasksConfig(): string[] {
  // 1. Check environment variable first
  if (process.env.DAILY_TASKS) {
    const tasks = process.env.DAILY_TASKS.split(',').map(t => t.trim()).filter(Boolean);
    console.log('Using tasks from DAILY_TASKS env var');
    return tasks;
  }

  // 2. Load from config file (required)
  const configPath = path.join(__dirname, 'tasks.config.json');
  if (!fs.existsSync(configPath)) {
    console.error('Config file not found: tasks/tasks.config.json');
    console.log('Create it with: { "dailyTasks": ["update-currency", ...] }');
    return [];
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (Array.isArray(config.dailyTasks)) {
      console.log('Using tasks from tasks.config.json');
      return config.dailyTasks;
    }
    console.error('Invalid config: dailyTasks must be an array');
    return [];
  } catch (e) {
    console.error('Failed to parse tasks.config.json');
    return [];
  }
}

// Task factory map
const TASK_FACTORY: Record<string, () => { run: () => Promise<void> }> = {
  'update-currency': () => new UpdateCurrencyTask(),
  'check-dividends': () => new CheckDividendsTask(),
  'update-growth-rates': () => new UpdateGrowthRatesTask(),
  'generate-monthly-snapshot': () => new GenerateMonthlySnapshotTask(),
  'dividend-sync': () => new DividendSyncTask(),
  'portfolio-snapshot': () => new PortfolioSnapshotTask(),
  'price-cache-cleanup': () => new PriceCacheCleanupTask(),
};

/**
 * Run configured daily tasks in sequence
 */
async function runAllTasks(): Promise<void> {
  const taskNames = loadDailyTasksConfig();

  // Validate task names
  const invalidTasks = taskNames.filter(name => !TASK_FACTORY[name]);
  if (invalidTasks.length > 0) {
    console.error(`Unknown tasks: ${invalidTasks.join(', ')}`);
    console.log('Available tasks:', Object.keys(TASK_FACTORY).join(', '));
    return;
  }

  console.log(`\nTasks to run: ${taskNames.join(' -> ')}\n`);

  for (const name of taskNames) {
    console.log(`\n--- Starting: ${name} ---`);
    const start = Date.now();
    try {
      const task = TASK_FACTORY[name]();
      await task.run();
      const duration = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`--- Completed: ${name} (${duration}s) ---`);
    } catch (error) {
      console.error(`--- Failed: ${name} ---`);
      console.error(error);
      // Continue with next task instead of stopping
    }
  }

  console.log('\n========================================');
  console.log('  All tasks completed');
  console.log('========================================');
}

// Registry of all available tasks
const TASKS: Record<string, () => Promise<void>> = {
  'run-all': runAllTasks,
  'update-currency': () => new UpdateCurrencyTask().run(),
  'check-dividends': () => new CheckDividendsTask().run(),
  'update-growth-rates': () => new UpdateGrowthRatesTask().run(),
  'generate-monthly-snapshot': () => new GenerateMonthlySnapshotTask().run(),
  'dividend-sync': () => new DividendSyncTask().run(),
  'portfolio-snapshot': () => new PortfolioSnapshotTask().run(),
  'price-cache-cleanup': () => new PriceCacheCleanupTask().run(),
};

async function main() {
  const taskName = process.argv[2];

  console.log('========================================');
  console.log('  Firewise Task Runner');
  console.log('========================================');

  if (!taskName) {
    console.log('\nUsage: npx ts-node tasks/index.ts <task-name>\n');
    console.log('Available tasks:');
    Object.keys(TASKS).forEach((name) => {
      console.log(`  - ${name}`);
    });
    process.exit(1);
  }

  if (!TASKS[taskName]) {
    console.error(`\nError: Unknown task "${taskName}"\n`);
    console.log('Available tasks:');
    Object.keys(TASKS).forEach((name) => {
      console.log(`  - ${name}`);
    });
    process.exit(1);
  }

  console.log(`\nRunning task: ${taskName}\n`);

  const startTime = Date.now();

  try {
    await TASKS[taskName]();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✓ Task "${taskName}" completed in ${duration}s`);
    process.exit(0);
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`\n✗ Task "${taskName}" failed after ${duration}s`);
    console.error(error);
    process.exit(1);
  }
}

main();
