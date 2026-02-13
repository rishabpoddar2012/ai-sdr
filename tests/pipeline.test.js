/**
 * Pipeline Tests
 * Run with: npm test
 */
const { collectHNLeads } = require('../sources/hn_intent');
const { collectRedditLeads } = require('../sources/reddit_jobs');
const { collectUpworkLeads } = require('../sources/upwork_rss');
const { scoreLead } = require('../pipeline/scorer');
const { enrichLead } = require('../pipeline/enricher');
const { Deduplicator } = require('../lib/dedupe');
const { getInstance: getDb } = require('../lib/db');

const db = getDb();

// Test configuration
const TEST_TIMEOUT = 60000;

async function runTests() {
  console.log('🧪 Running AI SDR Pipeline Tests\n');
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  // Test 1: Hacker News Collection
  await runTest('HN Collection', async () => {
    const leads = await collectHNLeads();
    console.log(`  Collected ${leads.length} leads from HN`);
    return leads.length >= 0; // May be 0 if no matches, that's OK
  }, results);

  // Test 2: Reddit Collection
  await runTest('Reddit Collection', async () => {
    const leads = await collectRedditLeads();
    console.log(`  Collected ${leads.length} leads from Reddit`);
    return leads.length >= 0;
  }, results);

  // Test 3: Upwork Collection
  await runTest('Upwork Collection', async () => {
    const leads = await collectUpworkLeads();
    console.log(`  Collected ${leads.length} leads from Upwork`);
    return leads.length >= 0;
  }, results);

  // Test 4: Lead Scoring
  await runTest('Lead Scoring', async () => {
    const testLead = {
      id: 'test-1',
      source: 'test',
      title: 'Looking for Facebook Ads specialist for Shopify store',
      text: 'We are a growing ecommerce brand doing $50k/month and need help scaling our Facebook ads. Budget is $5k/month for ad spend plus management fees. Looking to start ASAP.',
      url: 'https://example.com/test',
      author: 'testuser',
      capturedAt: new Date().toISOString()
    };
    
    const scored = await scoreLead(testLead);
    console.log(`  Score: ${scored.score}`);
    console.log(`  Geo: ${scored.geo}`);
    console.log(`  Intent: ${scored.intent}`);
    
    return scored.score && ['HOT', 'WARM', 'COLD'].includes(scored.score);
  }, results);

  // Test 5: Lead Enrichment
  await runTest('Lead Enrichment', async () => {
    const testLead = {
      id: 'test-2',
      source: 'test',
      title: 'Need Google Ads help urgent',
      text: 'Looking for someone to fix our campaigns ASAP. Spending $10k/month.',
      signals: ['budget mentioned', 'urgent']
    };
    
    const enriched = enrichLead(testLead);
    console.log(`  Engagement Score: ${enriched.engagementScore}`);
    console.log(`  Tags: ${enriched.tags?.join(', ')}`);
    console.log(`  Estimated Value: ${enriched.estimatedValue?.min}-${enriched.estimatedValue?.max}`);
    
    return enriched.engagementScore > 0 && enriched.tags?.length > 0;
  }, results);

  // Test 6: Deduplication
  await runTest('Deduplication', async () => {
    const dedupe = new Deduplicator();
    
    const leads = [
      { id: '1', source: 'test', title: 'Need Facebook Ads Help', url: 'http://example.com/1' },
      { id: '2', source: 'test', title: 'Need Facebook Ads Help', url: 'http://example.com/1' }, // Duplicate
      { id: '3', source: 'test', title: 'Google Ads Specialist Needed', url: 'http://example.com/2' }
    ];
    
    const { unique, duplicates } = dedupe.dedupe(leads);
    console.log(`  Unique: ${unique.length}, Duplicates: ${duplicates.length}`);
    
    return unique.length === 2 && duplicates.length === 1;
  }, results);

  // Test 7: Database Operations
  await runTest('Database Operations', async () => {
    const testLead = {
      id: 'test-db-' + Date.now(),
      source: 'test',
      title: 'Test Lead',
      score: 'HOT',
      capturedAt: new Date().toISOString()
    };
    
    // Add lead
    const addResult = db.addLead(testLead);
    console.log(`  Added: ${addResult.added}`);
    
    // Retrieve lead
    const retrieved = db.getLeadById(testLead.id);
    console.log(`  Retrieved: ${retrieved ? 'yes' : 'no'}`);
    
    // Update lead
    db.updateLead(testLead.id, { score: 'WARM' });
    const updated = db.getLeadById(testLead.id);
    console.log(`  Updated score: ${updated.score}`);
    
    // Delete lead
    db.deleteLead(testLead.id);
    const deleted = db.getLeadById(testLead.id);
    console.log(`  Deleted: ${deleted ? 'no' : 'yes'}`);
    
    return addResult.added && retrieved && updated.score === 'WARM' && !deleted;
  }, results);

  // Test 8: Database Stats
  await runTest('Database Stats', async () => {
    const stats = db.getStats();
    console.log(`  Total leads: ${stats.total}`);
    console.log(`  By source:`, stats.bySource);
    console.log(`  By score:`, stats.byScore);
    
    return stats.total >= 0 && typeof stats.bySource === 'object';
  }, results);

  // Print summary
  console.log('\n═══════════════════════════════════════════');
  console.log('📊 Test Results');
  console.log('═══════════════════════════════════════════');
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📈 Success Rate: ${Math.round((results.passed / (results.passed + results.failed)) * 100)}%`);
  
  if (results.failed > 0) {
    console.log('\nFailed Tests:');
    results.tests.filter(t => !t.passed).forEach(t => {
      console.log(`  ❌ ${t.name}: ${t.error}`);
    });
  }
  
  process.exit(results.failed > 0 ? 1 : 0);
}

async function runTest(name, fn, results) {
  console.log(`\n📝 Testing: ${name}`);
  console.log('─'.repeat(40));
  
  try {
    const passed = await Promise.race([
      fn(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), TEST_TIMEOUT)
      )
    ]);
    
    if (passed) {
      console.log(`  ✅ PASSED`);
      results.passed++;
      results.tests.push({ name, passed: true });
    } else {
      console.log(`  ❌ FAILED`);
      results.failed++;
      results.tests.push({ name, passed: false, error: 'Test returned false' });
    }
  } catch (error) {
    console.log(`  ❌ FAILED: ${error.message}`);
    results.failed++;
    results.tests.push({ name, passed: false, error: error.message });
  }
}

// Run tests
runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
