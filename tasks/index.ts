/**
 * Task Runner Entry Point
 *
 * Usage: npx ts-node tasks/index.ts <task-name>
 * Example: npx ts-node tasks/index.ts update-currency
 *
 * Available tasks:
 * - update-currency: Fetch and update exchange rates from external API
 */

import { UpdateCurrencyTask } from './update-currency.task';

// Registry of all available tasks
const TASKS: Record<string, () => Promise<void>> = {
  'update-currency': () => new UpdateCurrencyTask().run(),
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
