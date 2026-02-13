/**
 * Hacker News Intent Detection
 * Searches HN Algolia API for buyer intent posts
 */
const fs = require('fs');
const path = require('path');
const config = require('../config/sources');
const { Deduplicator } = require('../lib/dedupe');

const OUT_DIR = path.resolve(__dirname, '../leads');
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const dedupe = new Deduplicator();

/**
 * Search HN Algolia API
 */
async function searchHN(query, options = {}) {
  const { maxResults = 25 } = options;
  
  const url = `https://hn.algolia.com/api/v1/search_by_date?` + new URLSearchParams({
    query,
    tags: 'story,comment',
    hitsPerPage: maxResults.toString()
  });

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error searching HN for "${query}":`, error.message);
    return { hits: [] };
  }
}

/**
 * Check if post has buyer intent
 */
function hasBuyerIntent(hit) {
  const hnConfig = config.hackernews;
  const text = `${hit.story_title || hit.title || ''} ${hit.comment_text || hit.story_text || ''}`.toLowerCase();
  
  return hnConfig.buyerIntentPatterns.some(pattern => pattern.test(text));
}

/**
 * Extract signals from HN post
 */
function extractSignals(hit) {
  const signals = [];
  const text = `${hit.story_title || ''} ${hit.comment_text || hit.story_text || ''}`.toLowerCase();

  // Platform signals
  if (/facebook ads?|meta ads?/i.test(text)) signals.push('Meta/Facebook Ads');
  if (/google ads?|adwords/i.test(text)) signals.push('Google Ads');
  if (/shopify/i.test(text)) signals.push('Shopify');
  if (/ppc|paid media/i.test(text)) signals.push('PPC');
  
  // Intent signals
  if (/agency/i.test(text)) signals.push('Looking for agency');
  if (/freelancer|contractor/i.test(text)) signals.push('Looking for freelancer');
  if (/hire|hiring/i.test(text)) signals.push('Hiring');
  
  // Budget signals
  if (/\$[\d,]+|budget/i.test(text)) signals.push('Budget mentioned');
  
  // Company signals
  if (/startup/i.test(text)) signals.push('Startup');
  if (/saas/i.test(text)) signals.push('SaaS');
  if (/ecommerce|e-commerce/i.test(text)) signals.push('E-commerce');

  return signals;
}

/**
 * Infer geo from content
 */
function inferGeo(hit) {
  const text = `${hit.story_title || ''} ${hit.comment_text || hit.story_text || ''}`.toLowerCase();
  
  if (/\b(us|usa|united states|nyc|sf|la|austin|remote us|pst|est)\b/i.test(text)) return 'US';
  if (/\b(uk|gb|united kingdom|london|manchester|bristol|edinburgh)\b/i.test(text)) return 'UK';
  if (/\b(canada|toronto|vancouver|montreal)\b/i.test(text)) return 'Canada';
  if (/\b(eu|europe|berlin|paris|amsterdam|remote eu)\b/i.test(text)) return 'EU';
  
  // Check author profile hints (very basic)
  if (hit.author) {
    // Some HN users indicate location in their profile
    // This is a heuristic
  }
  
  return 'Other';
}

/**
 * Normalize HN hit to lead format
 */
function normalizeHit(hit, query) {
  const isComment = hit._tags?.includes('comment');
  const text = (hit.comment_text || hit.story_text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const title = hit.story_title || hit.title || '(no title)';
  
  // Build URL
  let url;
  if (isComment) {
    url = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  } else {
    url = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
  }

  return {
    id: `hn-${hit.objectID}`,
    source: 'hackernews',
    query,
    title: title.slice(0, 150),
    text: text.slice(0, 2000),
    url,
    author: hit.author,
    createdAt: hit.created_at,
    points: hit.points || 0,
    signals: extractSignals(hit),
    geo: inferGeo(hit),
    raw: hit
  };
}

/**
 * Main collection function
 */
async function collectHNLeads(options = {}) {
  const hnConfig = config.hackernews;
  const allLeads = [];

  console.log('🔍 Collecting leads from Hacker News...');

  for (const query of hnConfig.queries) {
    console.log(`  Searching: "${query}"`);
    
    const data = await searchHN(query, { maxResults: hnConfig.maxResults });
    let matchCount = 0;

    for (const hit of (data.hits || [])) {
      if (hasBuyerIntent(hit)) {
        const lead = normalizeHit(hit, query);
        allLeads.push(lead);
        matchCount++;
      }
    }

    console.log(`    ✓ Found ${matchCount} intent matches`);
  }

  // Deduplicate
  const { unique, duplicates } = dedupe.dedupe(allLeads);
  console.log(`✅ Total unique leads: ${unique.length} (${duplicates.length} duplicates removed)`);

  // Save raw output
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUT_DIR, `raw_hn_${timestamp}.json`);
  
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    config: hnConfig,
    leads: unique,
    duplicates: duplicates.length
  }, null, 2));

  console.log(`💾 Saved to: ${outputPath}`);
  
  return unique;
}

// CLI usage
if (require.main === module) {
  collectHNLeads().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { collectHNLeads, searchHN };
