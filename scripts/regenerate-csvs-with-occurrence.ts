/**
 * Regenerate all partitioned CSVs with occurrence tracking
 * 
 * This script re-partitions all CSV files from the _originals folders
 * to add the new _occurrence column for split payment tracking.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { partitionCSVFile } from '../server/utils/csv-partitioner.js';
import { ACCOUNTS } from '../server/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATEMENTS_DIR = path.resolve(__dirname, '../statements');

console.log('🔄 Regenerating all CSVs with occurrence tracking...\n');

let totalProcessed = 0;
let totalSkipped = 0;

for (const account of ACCOUNTS) {
  const csvDir = path.join(STATEMENTS_DIR, account, 'csv');
  const originalsDir = path.join(csvDir, '_originals');
  
  if (!fs.existsSync(originalsDir)) {
    console.log(`⏭️  Skipping ${account} (no _originals folder)`);
    continue;
  }
  
  const originals = fs.readdirSync(originalsDir).filter(f => f.endsWith('.csv'));
  
  if (originals.length === 0) {
    console.log(`⏭️  Skipping ${account} (no original CSVs)`);
    continue;
  }
  
  console.log(`📁 Processing ${account}: ${originals.length} original CSV(s)`);
  
  for (const originalFile of originals) {
    const originalPath = path.join(originalsDir, originalFile);
    
    try {
      console.log(`   ⚙️  Re-partitioning: ${originalFile}`);
      
      // Re-partition the original CSV (this will overwrite existing partitioned files)
      const result = partitionCSVFile(originalPath, account);
      
      if (result.filesCreated.length > 0) {
        console.log(`   ✅ Created ${result.filesCreated.length} file(s): ${result.filesCreated.join(', ')}`);
        totalProcessed++;
      } else {
        console.log(`   ℹ️  No partitioning needed (single month)`);
        totalSkipped++;
      }
    } catch (error) {
      console.error(`   ❌ Error processing ${originalFile}:`, error);
    }
  }
  
  console.log('');
}

console.log(`\n✨ Done!`);
console.log(`   Processed: ${totalProcessed} files`);
console.log(`   Skipped: ${totalSkipped} files`);
console.log(`\n📝 Note: Restart the server to reload the database with new CSVs`);
