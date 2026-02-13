/**
 * Full Pipeline - Runs the complete lead generation workflow
 */
const { collectAll } = require('./collector');
const { scorePendingLeads } = require('./scorer');
const { enrichLeads } = require('./enricher');
const { exportLeads } = require('./exporter');
const { EmailSender } = require('../lib/email');
const { getInstance: getDb } = require('../lib/db');
const config = require('../config/env');

const db = getDb();

/**
 * Run the complete pipeline
 */
async function runPipeline(options = {}) {
  const {
    skipCollect = false,
    skipScore = false,
    skipEnrich = false,
    skipExport = false,
    skipEmail = false,
    minScore = config.minScore
  } = options;

  console.log('╔════════════════════════════════════════╗');
  console.log('║     AI SDR - Full Pipeline Run        ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  const results = {
    startedAt: new Date().toISOString(),
    steps: {}
  };

  // Step 1: Collect
  if (!skipCollect) {
    console.log('\n📥 STEP 1: COLLECT\n');
    try {
      const collectResult = await collectAll();
      results.steps.collect = collectResult;
    } catch (err) {
      console.error('Collect failed:', err.message);
      results.steps.collect = { error: err.message };
    }
  }

  // Step 2: Score
  if (!skipScore) {
    console.log('\n🎯 STEP 2: SCORE\n');
    try {
      const scoreResult = await scorePendingLeads();
      results.steps.score = scoreResult;
    } catch (err) {
      console.error('Score failed:', err.message);
      results.steps.score = { error: err.message };
    }
  }

  // Step 3: Enrich
  if (!skipEnrich) {
    console.log('\n🔧 STEP 3: ENRICH\n');
    try {
      const enrichResult = await enrichLeads();
      results.steps.enrich = enrichResult;
    } catch (err) {
      console.error('Enrich failed:', err.message);
      results.steps.enrich = { error: err.message };
    }
  }

  // Step 4: Export
  if (!skipExport) {
    console.log('\n📤 STEP 4: EXPORT\n');
    try {
      const exportResult = await exportLeads({ minScore });
      results.steps.export = exportResult;
    } catch (err) {
      console.error('Export failed:', err.message);
      results.steps.export = { error: err.message };
    }
  }

  // Step 5: Email Summary
  if (!skipEmail && config.emailTo) {
    console.log('\n📧 STEP 5: EMAIL SUMMARY\n');
    try {
      const emailSender = new EmailSender();
      if (emailSender.isConfigured()) {
        const recentLeads = db.getRecentLeads(24);
        const stats = db.getStats();
        const emailResult = await emailSender.sendDigest(recentLeads, stats);
        results.steps.email = emailResult;
      } else {
        console.log('  Email not configured, skipping');
        results.steps.email = { skipped: true };
      }
    } catch (err) {
      console.error('Email failed:', err.message);
      results.steps.email = { error: err.message };
    }
  }

  // Cleanup old leads
  if (config.leadRetentionDays) {
    console.log('\n🧹 Cleaning up old leads...');
    const removed = db.cleanupOldLeads(config.leadRetentionDays);
    console.log(`  Removed ${removed} old leads`);
    results.cleanup = { removed };
  }

  results.finishedAt = new Date().toISOString();

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║         Pipeline Complete!             ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`Finished: ${new Date().toLocaleString()}`);

  return results;
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);

  const options = {
    skipCollect: args.includes('--skip-collect'),
    skipScore: args.includes('--skip-score'),
    skipEnrich: args.includes('--skip-enrich'),
    skipExport: args.includes('--skip-export'),
    skipEmail: args.includes('--skip-email')
  };

  runPipeline(options).then(results => {
    console.log('\n📊 Final Results:');
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
  }).catch(err => {
    console.error('Pipeline error:', err);
    process.exit(1);
  });
}

module.exports = { runPipeline };
