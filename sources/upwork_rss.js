/**
 * Upwork RSS Feed Collector
 * Uses Upwork's RSS feeds instead of scraping (which is blocked)
 */
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');
const config = require('../config/sources');
const { Deduplicator } = require('../lib/dedupe');

const OUT_DIR = path.resolve(__dirname, '../leads');
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const rssParser = new Parser({
  customFields: {
    item: ['description', 'link', 'guid', 'pubDate', 'category']
  }
});

const dedupe = new Deduplicator();

/**
 * Build Upwork RSS URL for a search query
 */
function buildRssUrl(query) {
  // Upwork RSS feed for job searches
  const encodedQuery = encodeURIComponent(query);
  return `https://www.upwork.com/ab/feed/jobs/rss?q=${encodedQuery}&sort=recency`;
}

/**
 * Parse RSS feed for a keyword
 */
async function fetchUpworkRss(keyword) {
  const url = buildRssUrl(keyword);
  
  try {
    console.log(`  Fetching RSS for: "${keyword}"`);
    const feed = await rssParser.parseURL(url);
    return feed.items || [];
  } catch (error) {
    console.error(`  Error fetching RSS for "${keyword}":`, error.message);
    return [];
  }
}

/**
 * Extract signals from job description
 */
function extractSignals(item) {
  const signals = [];
  const text = `${item.title} ${item.content || item.description || ''}`.toLowerCase();
  const categories = item.categories || [];

  // Budget signals
  if (/\$[\d,]+|budget|hourly|fixed.price/i.test(text)) signals.push('Budget specified');
  if (/(\$\d+\s*-\s*\$\d+|\$\d+\+)/i.test(text)) signals.push('Rate range given');
  
  // Experience level
  if (/expert|senior|advanced/i.test(text)) signals.push('Expert level');
  if (/intermediate|mid/i.test(text)) signals.push('Intermediate level');
  if (/entry|beginner|junior/i.test(text)) signals.push('Entry level');
  
  // Duration
  if (/long.term|ongoing|permanent/i.test(text)) signals.push('Long-term');
  if (/short.term|project/i.test(text)) signals.push('Project-based');
  
  // Platform signals
  if (/facebook ads?|meta ads?/i.test(text)) signals.push('Meta/Facebook Ads');
  if (/google ads?|adwords/i.test(text)) signals.push('Google Ads');
  if (/shopify/i.test(text)) signals.push('Shopify');
  if (/ppc|paid.search/i.test(text)) signals.push('PPC');
  if (/roas|roi|cpa|cpc/i.test(text)) signals.push('Performance focus');

  // Category-based signals
  if (categories.some(c => /marketing|advertising/i.test(c))) signals.push('Marketing category');

  return signals;
}

/**
 * Infer geo from content
 */
function inferGeo(text) {
  if (!text) return 'Other';
  const t = text.toLowerCase();
  if (/\b(us|usa|united states|pst|est|cst|mst)\b/i.test(t)) return 'US';
  if (/\b(uk|gb|united kingdom|london|gmt|bst)\b/i.test(t)) return 'UK';
  if (/\b(canada|toronto|vancouver|montreal)\b/i.test(t)) return 'Canada';
  if (/\b(australia|sydney|melbourne)\b/i.test(t)) return 'Australia';
  return 'Other';
}

/**
 * Normalize RSS item to lead format
 */
function normalizeItem(item, keyword) {
  const content = item.content || item.description || item.summary || '';
  const signals = extractSignals(item);
  const geo = inferGeo(`${item.title} ${content}`);

  // Extract budget if present
  let budgetHint = null;
  const budgetMatch = content.match(/Budget:\s*\$?([\d,]+(?:\s*-\s*\$?[\d,]+)?)/i);
  if (budgetMatch) budgetHint = budgetMatch[1];

  // Extract hourly rate if present
  const hourlyMatch = content.match(/(\$\d+(?:\.\d+)?)\s*-\s*(\$\d+(?:\.\d+)?)\/hr/i);
  if (hourlyMatch) budgetHint = `${hourlyMatch[1]}-${hourlyMatch[2]}/hr`;

  return {
    id: `upwork-${item.guid || item.link}`,
    source: 'upwork',
    keyword,
    title: item.title?.slice(0, 150) || 'Untitled',
    text: content.replace(/<[^>]*>/g, ' ').slice(0, 3000),
    url: item.link,
    author: null, // RSS doesn't expose client name
    createdAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    signals,
    geo,
    budgetHint,
    raw: {
      categories: item.categories || [],
      guid: item.guid
    }
  };
}

/**
 * Main collection function
 */
async function collectUpworkLeads(options = {}) {
  const upworkConfig = config.upwork;
  const allLeads = [];

  console.log('🔍 Collecting leads from Upwork RSS...');

  for (const keyword of upworkConfig.keywords) {
    const items = await fetchUpworkRss(keyword);
    
    for (const item of items.slice(0, upworkConfig.maxResults)) {
      const lead = normalizeItem(item, keyword);
      allLeads.push(lead);
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 1000));
  }

  // Deduplicate
  const { unique, duplicates } = dedupe.dedupe(allLeads);
  console.log(`✅ Total unique leads: ${unique.length} (${duplicates.length} duplicates removed)`);

  // Save raw output
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUT_DIR, `raw_upwork_${timestamp}.json`);
  
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    config: upworkConfig,
    leads: unique,
    duplicates: duplicates.length
  }, null, 2));

  console.log(`💾 Saved to: ${outputPath}`);
  
  return unique;
}

// CLI usage
if (require.main === module) {
  collectUpworkLeads().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { collectUpworkLeads, fetchUpworkRss };
