import { ComprehensiveHistoryIngestion } from '../src/data/ingestion/comprehensiveHistoryIngestion.ts';

async function main() {
  console.log('--- STARTING COMPREHENSIVE MATCH HISTORY MASS INGESTION ---');
  const start = Date.now();
  const res = await ComprehensiveHistoryIngestion.ingestAllHistoricalMatches((msg) => {
    console.log(`[STATUS] ${msg}`);
  });
  const durationSec = Math.round((Date.now() - start) / 1000);
  console.log(`\n--- COMPREHENSIVE INGESTION COMPLETED IN ${durationSec}s ---`);
  console.log(`Processed: ${res.totalProcessed}`);
  console.log(`Inserted:  ${res.totalInserted}`);
  console.log(`Updated:   ${res.totalUpdated}`);
  if (res.errors.length > 0) {
    console.log(`Errors encountered (${res.errors.length}):`, res.errors.slice(0, 5));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error during mass ingestion:', err);
  process.exit(1);
});
