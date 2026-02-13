/**
 * Reddit Job Board Scraper
 * Scrapes r/forhire, r/startups, and related subreddits for hiring posts
 */
const axios = require('axios');
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
 * Fetch posts from a subreddit
 */
async function fetchSubreddit(subreddit, options = {}) {
  const { sort = 'new', time = 'day', limit = 50 } = options;
  
  try {
    // Use Reddit's public JSON API
    const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?t=${time}&limit=${limit}`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': config.reddit.userAgent || 'AI_SDR_Bot/1.0'
      },
      timeout: 10000
    });

    return response.data?.data?.children || [];
  } catch (error) {
    console.error(`Error fetching r/${subreddit}:`, error.message);
    return [];
  }
}

/**
 * Check if a post matches our keywords and intent patterns
 */
function matchesKeywords(post, keywords) {
  const title = (post.title || '').toLowerCase();
  const body = (post.selftext || '').toLowerCase();
  const combined = `${title} ${body}`;

  // Must have at least one keyword
  const hasKeyword = keywords.some(kw => combined.includes(kw.toLowerCase()));
  
  // Must indicate hiring intent
  const intentPatterns = [
    /hiring/i,
    /looking for/i,
    /seeking/i,
    /need a/i,
    /need help/i,
    /want to hire/i,
    /recruiting/i
  ];
  const hasIntent = intentPatterns.some(p => p.test(title) || p.test(body));

  return hasKeyword && hasIntent;
}

/**
 * Extract signals from post content
 */
function extractSignals(post) {
  const signals = [];
  const text = `${post.title} ${post.selftext}`.toLowerCase();

  // Budget signals
  if (/\$[\d,]+|budget|spend|monthly/i.test(text)) signals.push('Budget mentioned');
  
  // Urgency signals
  if (/asap|urgent|immediately|this week|right now/i.test(text)) signals.push('Urgent timeline');
  
  // Platform signals
  if (/facebook ads?|meta ads?/i.test(text)) signals.push('Meta/Facebook Ads');
  if (/google ads?|adwords/i.test(text)) signals.push('Google Ads');
  if (/shopify/i.test(text)) signals.push('Shopify');
  if (/ppc|paid media/i.test(text)) signals.push('PPC');
  
  // Company size signals
  if (/startup/i.test(text)) signals.push('Startup');
  if (/ecommerce|e-commerce/i.test(text)) signals.push('E-commerce');
  
  // Location signals
  if (/\b(us|usa|united states|remote us)\b/i.test(text)) signals.push('US-based');
  if (/\b(uk|united kingdom|london)\b/i.test(text)) signals.push('UK-based');
  if (/remote|anywhere/i.test(text)) signals.push('Remote OK');

  return signals;
}

/**
 * Normalize a Reddit post to our lead format
 */
function normalizePost(post, subreddit) {
  const p = post.data;
  const signals = extractSignals(p);
  
  // Infer geo
  let geo = 'Other';
  const text = `${p.title} ${p.selftext}`.toLowerCase();
  if (/\b(us|usa|united states|nyc|sf|la|austin|remote us)\b/i.test(text)) geo = 'US';
  else if (/\b(uk|gb|united kingdom|london|manchester)\b/i.test(text)) geo = 'UK';

  return {
    id: `reddit-${p.id}`,
    source: `reddit_${subreddit}`,
    title: p.title.slice(0, 150),
    text: p.selftext.slice(0, 2000),
    url: `https://reddit.com${p.permalink}`,
    author: p.author,
    createdAt: new Date(p.created_utc * 1000).toISOString(),
    score: p.score,
    signals,
    geo,
    raw: p
  };
}

/**
 * Main collection function
 */
async function collectRedditLeads(options = {}) {
  const redditConfig = config.reddit;
  const allLeads = [];

  console.log('🔍 Collecting leads from Reddit...');

  for (const subreddit of redditConfig.subreddits) {
    console.log(`  Scanning r/${subreddit}...`);
    
    const posts = await fetchSubreddit(subreddit, {
      limit: redditConfig.maxResultsPerSubreddit,
      time: redditConfig.timeWindow
    });

    let matchCount = 0;
    for (const post of posts) {
      if (matchesKeywords(post.data, redditConfig.keywords)) {
        const lead = normalizePost(post, subreddit);
        allLeads.push(lead);
        matchCount++;
      }
    }

    console.log(`    ✓ Found ${matchCount} matches`);
  }

  // Deduplicate
  const { unique, duplicates } = dedupe.dedupe(allLeads);
  console.log(`✅ Total unique leads: ${unique.length} (${duplicates.length} duplicates removed)`);

  // Save raw output
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUT_DIR, `raw_reddit_${timestamp}.json`);
  
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    config: redditConfig,
    leads: unique,
    duplicates: duplicates.length
  }, null, 2));

  console.log(`💾 Saved to: ${outputPath}`);
  
  return unique;
}

// CLI usage
if (require.main === module) {
  collectRedditLeads().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { collectRedditLeads, fetchSubreddit };
