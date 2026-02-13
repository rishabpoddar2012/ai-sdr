/**
 * Main Collector - Orchestrates all lead sources
 */
const fs = require('fs');
const path = require('path');
const { collectHNLeads } = require('../sources/hn_intent');
const { collectRedditLeads } = require('../sources/reddit_jobs');
const { collectUpworkLeads } = require('../sources/upwork_rss');
const { collectLinkedInLeads } = require('../sources/linkedin_scraper');
const { getInstance: getDb } = require('../lib/db');
const { Deduplicator } = require('../lib/dedupe');
const config = require('../config/env');

const db = getDb();
const dedupe = new Deduplicator();

/**
 * Run all enabled collectors
 */
async function collectAll() {
  console.log('🚀 Starting lead collection from all sources...\n');
  
  const results = {
    timestamp: new Date().toISOString(),
    sources: {}
  };

  // Hacker News
  try {
    console.log('📰 Hacker News');
    const hnLeads = await collectHNLeads();
    results.sources.hackernews = hnLeads.length;
    await processLeads(hnLeads);
  } catch (err) {
    console.error('  Error:', err.message);
    results.sources.hackernews = 0;
  }

  // Reddit
  try {
    console.log('\n🔴 Reddit');
    const redditLeads = await collectRedditLeads();
    results.sources.reddit = redditLeads.length;
    await processLeads(redditLeads);
  } catch (err) {
    console.error('  Error:', err.message);
    results.sources.reddit = 0;
  }

  // Upwork
  try {
    console.log('\n💼 Upwork');
    const upworkLeads = await collectUpworkLeads();
    results.sources.upwork = upworkLeads.length;
    await processLeads(upworkLeads);
  } catch (err) {
    console.error('  Error:', err.message);
    results.sources.upwork = 0;
  }

  // LinkedIn (only if credentials are configured)
  if (config.linkedinEmail && config.linkedinPassword) {
    try {
      console.log('\n💼 LinkedIn');
      const linkedinLeads = await collectLinkedInLeads();
      results.sources.linkedin = linkedinLeads.length;
      await processLeads(linkedinLeads);
    } catch (err) {
      console.error('  Error:', err.message);
      results.sources.linkedin = 0;
    }
  } else {
    console.log('\n💼 LinkedIn (skipped - no credentials)');
    results.sources.linkedin = 0;
  }

  // Save summary
  const summaryPath = path.join(__dirname, '../leads', `collection_summary_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));

  console.log('\n✅ Collection complete!');
  console.log('📊 Summary:', results.sources);
  console.log(`💾 Saved to: ${summaryPath}`);

  return results;
}

/**
 * Process leads through deduplication and add to DB
 */
async function processLeads(leads) {
  let added = 0;
  let duplicates = 0;

  for (const lead of leads) {
    // Check for existing in DB
    const existing = await dedupe.checkExisting(lead, db);
    
    if (existing.exists) {
      duplicates++;
      continue;
    }

    // Add to DB
    const result = db.addLead({
      ...lead,
      score: 'PENDING', // Will be updated by scorer
      processed: false
    });

    if (result.added) {
      added++;
    }
  }

  console.log(`  → ${added} new leads added, ${duplicates} duplicates skipped`);
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--all')) {
    collectAll().catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
  } else if (args.includes('--source')) {
    const sourceIndex = args.indexOf('--source');
    const source = args[sourceIndex + 1];
    
    switch (source) {
      case 'hn':
        collectHNLeads().catch(console.error);
        break;
      case 'reddit':
        collectRedditLeads().catch(console.error);
        break;
      case 'upwork':
        collectUpworkLeads().catch(console.error);
        break;
      case 'linkedin':
        collectLinkedInLeads().catch(console.error);
        break;
      default:
        console.error('Unknown source. Use: hn, reddit, upwork, or linkedin');
        process.exit(1);
    }
  } else {
    console.log('Usage:');
    console.log('  node collector.js --all           # Collect from all sources');
    console.log('  node collector.js --source hn     # Collect from specific source');
    process.exit(0);
  }
}

module.exports = { collectAll };
