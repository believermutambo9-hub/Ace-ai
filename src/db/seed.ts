import { SyncManager } from '../data/ingestion/syncManager.ts';

async function main() {
  console.log('--- Checking & Syncing Worldwide Football Data ---');
  try {
    const syncManager = new SyncManager();
    await syncManager.initBaseData();
    const results = await syncManager.syncAll();
    console.log(`Successfully verified ${results.length} worldwide league datasets.`);
  } catch (err: any) {
    console.warn('Sync runner notice:', err?.message || err);
  }
  process.exit(0);
}

main();
