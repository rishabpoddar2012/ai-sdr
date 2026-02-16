/**
 * X/Twitter Scraper
 * Uses X API v2 (free tier: 1500 tweets/month)
 * Searches for buyer intent signals
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Deduplicator } = require('../lib/dedupe');

const OUT_DIR = path.resolve(__dirname, '../leads');
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const dedupe = new Deduplicator();

// X API v2 endpoints
const X_API_BASE = 'https://api.twitter.com/2';

// Search queries for buyer intent
const INTENT_QUERIES = [
  'looking for agency',
  'hiring marketing',
  'need marketing help',
  'looking for freelancer',
  'need leads',
  'looking for growth',
  'hire ppc',
  'need facebook ads',
  'need google ads',
  'looking for seo',
  'recommend marketing agency',
  'searching for agency'
];

// Negative keywords to filter out
const NEGATIVE_KEYWORDS = [
  'job', 'career', 'position', 'apply now', 'we are hiring',
  'internship', 'junior', 'entry level'
];

/**
 * Delay function
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry(fn, maxRetries = 3, baseDelay = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error.response?.status === 429) {
        // Rate limit - wait longer
        const resetTime = error.response.headers['x-rate-limit-reset'];
        const waitTime = resetTime ? (parseInt(resetTime) * 1000 - Date.now()) : 900000;
        console.log(`  ⏳ Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s...`);
        await delay(Math.max(waitTime, 60000));
        continue;
      }
      
      if (attempt === maxRetries) throw error;
      const waitTime = baseDelay * Math.pow(2, attempt - 1);
      console.log(`  ⚠️ Attempt ${attempt} failed, retrying in ${waitTime}ms...`);
      await delay(waitTime);
    }
  }
}

/**
 * Search tweets using X API v2
 */
async function searchTweets(query, options = {}) {
  const {
    maxResults = 25,
    startTime = null,
    bearerToken = process.env.X_BEARER_TOKEN
  } = options;
  
  if (!bearerToken) {
    console.log('  ⚠️ No X_BEARER_TOKEN found, using mock data mode');
    return generateMockTweets(query, maxResults);
  }
  
  const params = new URLSearchParams({
    query: `${query} -is:retweet lang:en`,
    max_results: Math.min(maxResults, 100).toString(),
    'tweet.fields': 'created_at,author_id,public_metrics,context_annotations,entities',
    'user.fields': 'username,description,public_metrics,location,url',
    'expansions': 'author_id'
  });
  
  if (startTime) {
    params.append('start_time', startTime);
  }
  
  const url = `${X_API_BASE}/tweets/search/recent?${params.toString()}`;
  
  const response = await withRetry(async () => {
    return await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'User-Agent': 'AI-SDR-Twitter-Scraper/1.0'
      },
      timeout: 30000
    });
  });
  
  const tweets = response.data.data || [];
  const users = response.data.includes?.users || [];
  
  // Map users to tweets
  return tweets.map(tweet => {
    const author = users.find(u => u.id === tweet.author_id);
    return { ...tweet, author };
  });
}

/**
 * Generate mock tweets for development/testing
 */
function generateMockTweets(query, count) {
  const mockUsers = [
    { username: 'startupfounder', name: 'Startup Founder', location: 'San Francisco, CA' },
    { username: 'ecommercepro', name: 'Ecommerce Pro', location: 'New York, NY' },
    { username: 'saasceo', name: 'SaaS CEO', location: 'Austin, TX' },
    { username: 'marketingmgr', name: 'Marketing Manager', location: 'London, UK' },
    { username: 'growthlead', name: 'Growth Lead', location: 'Remote' }
  ];
  
  const mockTweets = [];
  
  for (let i = 0; i < Math.min(count, 5); i++) {
    const user = mockUsers[i % mockUsers.length];
    mockTweets.push({
      id: `mock-${Date.now()}-${i}`,
      text: `Looking for a great marketing agency to help with ${query.replace(/"/g, '')}. Any recommendations? DM me!`,
      created_at: new Date(Date.now() - i * 3600000).toISOString(),
      author_id: user.username,
      author: user,
      public_metrics: {
        retweet_count: Math.floor(Math.random() * 10),
        reply_count: Math.floor(Math.random() * 5),
        like_count: Math.floor(Math.random() * 20),
        quote_count: Math.floor(Math.random() * 3)
      },
      isMock: true
    });
  }
  
  return mockTweets;
}

/**
 * Extract email from bio or text
 */
function extractEmail(text, bio = '') {
  const combined = `${text} ${bio}`;
  const emailMatch = combined.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
  return emailMatch ? emailMatch[1] : null;
}

/**
 * Extract website URL from bio or entities
 */
function extractWebsite(entities, bio = '') {
  // From entities
  if (entities?.urls) {
    for (const url of entities.urls) {
      if (url.expanded_url && !url.expanded_url.includes('twitter.com') && !url.expanded_url.includes('x.com')) {
        return url.expanded_url;
      }
    }
  }
  
  // From bio text
  const urlMatch = bio.match(/(https?:\/\/[^\s]+)/);
  if (urlMatch) {
    return urlMatch[1].replace(/[)\]]+$/, '');
  }
  
  return null;
}

/**
 * Check if tweet has negative keywords (job postings, etc.)
 */
function hasNegativeKeywords(text) {
  const lowerText = text.toLowerCase();
  return NEGATIVE_KEYWORDS.some(kw => lowerText.includes(kw.toLowerCase()));
}

/**
 * Extract intent signals from tweet
 */
function extractSignals(tweet) {
  const signals = [];
  const text = tweet.text.toLowerCase();
  
  // Intent signals
  if (/looking for|seeking|searching for|need/i.test(text)) signals.push('Active Search');
  if (/hiring|recruiting/i.test(text)) signals.push('Hiring Mode');
  if (/recommend|suggestion|who knows/i.test(text)) signals.push('Seeking Recommendations');
  if (/budget|\$\d+/i.test(text)) signals.push('Budget Mentioned');
  if (/urgent|asap|immediately/i.test(text)) signals.push('Urgent Need');
  
  // Service signals
  if (/marketing agency|digital agency/i.test(text)) signals.push('Agency Need');
  if (/facebook ads|meta ads/i.test(text)) signals.push('Facebook Ads');
  if (/google ads|adwords/i.test(text)) signals.push('Google Ads');
  if (/seo|search engine/i.test(text)) signals.push('SEO');
  if (/ppc|paid search/i.test(text)) signals.push('PPC');
  if (/growth|acquisition/i.test(text)) signals.push('Growth');
  
  // Engagement signals
  const metrics = tweet.public_metrics || {};
  if (metrics.reply_count > 5) signals.push('High Engagement');
  if (metrics.like_count > 20) signals.push('Popular Tweet');
  
  return signals;
}

/**
 * Score the lead quality
 */
function scoreLead(tweet) {
  let score = 40; // Base score
  const signals = extractSignals(tweet);
  
  // Engagement score
  const metrics = tweet.public_metrics || {};
  score += Math.min(20, (metrics.like_count || 0) / 5);
  score += Math.min(15, (metrics.reply_count || 0) * 2);
  score += Math.min(10, (metrics.retweet_count || 0) * 2);
  
  // Intent signals
  score += signals.length * 5;
  
  // Has contact info
  if (extractEmail(tweet.text, tweet.author?.description)) score += 15;
  if (tweet.author?.url) score += 10;
  
  // Verified or high follower count
  const followers = tweet.author?.public_metrics?.followers_count || 0;
  if (followers > 10000) score += 10;
  else if (followers > 1000) score += 5;
  
  return Math.min(100, score);
}

/**
 * Normalize tweet to lead format
 */
function normalizeTweet(tweet, query) {
  const author = tweet.author || {};
  const website = extractWebsite(tweet.entities, author.description);
  const email = extractEmail(tweet.text, author.description);
  const score = scoreLead(tweet);
  
  return {
    id: `twitter-${tweet.id}`,
    source: 'twitter',
    query,
    tweetId: tweet.id,
    tweetUrl: `https://twitter.com/${author.username}/status/${tweet.id}`,
    text: tweet.text,
    createdAt: tweet.created_at,
    
    // Author info
    username: author.username,
    displayName: author.name,
    bio: author.description,
    location: author.location,
    followers: author.public_metrics?.followers_count,
    following: author.public_metrics?.following_count,
    
    // Contact
    website,
    email,
    
    // Engagement
    likes: tweet.public_metrics?.like_count || 0,
    replies: tweet.public_metrics?.reply_count || 0,
    retweets: tweet.public_metrics?.retweet_count || 0,
    quotes: tweet.public_metrics?.quote_count || 0,
    
    // Scoring
    signals: extractSignals(tweet),
    score,
    category: score >= 70 ? 'HOT' : score >= 50 ? 'WARM' : 'COLD',
    
    scrapedAt: new Date().toISOString()
  };
}

/**
 * Enrich leads with website data (simulated)
 */
async function enrichLead(lead) {
  // In production, this would scrape the user's website for email/contact
  // For now, return as-is
  return lead;
}

/**
 * Main collection function
 */
async function collectTwitterLeads(options = {}) {
  const {
    queries = INTENT_QUERIES,
    maxResultsPerQuery = 25,
    filterNegative = true,
    minScore = 35
  } = options;
  
  console.log('🔍 Collecting leads from X/Twitter...');
  console.log(`   Queries: ${queries.length}`);
  console.log(`   Max per query: ${maxResultsPerQuery}`);
  
  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken) {
    console.log('   ⚠️ X_BEARER_TOKEN not set - running in mock mode');
  }
  
  const allLeads = [];
  let successCount = 0;
  let failCount = 0;
  
  for (const query of queries) {
    console.log(`\n  Query: "${query}"`);
    
    try {
      const tweets = await searchTweets(query, { maxResults: maxResultsPerQuery, bearerToken });
      console.log(`    Found ${tweets.length} tweets`);
      
      let filteredCount = 0;
      
      for (const tweet of tweets) {
        // Filter negative keywords
        if (filterNegative && hasNegativeKeywords(tweet.text)) {
          filteredCount++;
          continue;
        }
        
        const lead = normalizeTweet(tweet, query);
        
        // Filter by minimum score
        if (lead.score < minScore) {
          continue;
        }
        
        allLeads.push(lead);
      }
      
      if (filteredCount > 0) {
        console.log(`    Filtered out ${filteredCount} tweets with negative keywords`);
      }
      
      successCount++;
      
      // Rate limiting delay between queries
      await delay(2000);
      
    } catch (error) {
      console.error(`  ❌ Error searching "${query}":`, error.message);
      failCount++;
      
      // Continue with next query
      continue;
    }
  }
  
  // Deduplicate
  const { unique, duplicates } = dedupe.dedupe(allLeads);
  
  // Stats
  const stats = {
    queriesAttempted: queries.length,
    queriesSuccess: successCount,
    queriesFailed: failCount,
    totalFound: allLeads.length,
    unique: unique.length,
    duplicates: duplicates.length,
    withEmail: unique.filter(l => l.email).length,
    withWebsite: unique.filter(l => l.website).length,
    hot: unique.filter(l => l.category === 'HOT').length,
    warm: unique.filter(l => l.category === 'WARM').length,
    cold: unique.filter(l => l.category === 'COLD').length
  };
  
  console.log('\n📊 Twitter Stats:');
  console.log(`   Queries: ${stats.queriesSuccess} success, ${stats.queriesFailed} failed`);
  console.log(`   Total found: ${stats.totalFound}`);
  console.log(`   Unique leads: ${stats.unique}`);
  console.log(`   With email: ${stats.withEmail}`);
  console.log(`   With website: ${stats.withWebsite}`);
  console.log(`   HOT: ${stats.hot}, WARM: ${stats.warm}, COLD: ${stats.cold}`);
  
  // Save output
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUT_DIR, `raw_twitter_${timestamp}.json`);
  
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'twitter',
    stats,
    leads: unique
  }, null, 2));
  
  console.log(`\n💾 Saved to: ${outputPath}`);
  
  return { leads: unique, stats };
}

/**
 * Search specific user timeline
 */
async function searchUserTimeline(username, options = {}) {
  const bearerToken = process.env.X_BEARER_TOKEN;
  
  if (!bearerToken) {
    console.log('No bearer token available');
    return [];
  }
  
  // First get user ID
  const userUrl = `${X_API_BASE}/users/by/username/${username}`;
  const userResponse = await axios.get(userUrl, {
    headers: { 'Authorization': `Bearer ${bearerToken}` }
  });
  
  const userId = userResponse.data.data.id;
  
  // Get user's tweets
  const tweetsUrl = `${X_API_BASE}/users/${userId}/tweets?max_results=${options.maxResults || 50}`;
  const tweetsResponse = await axios.get(tweetsUrl, {
    headers: { 'Authorization': `Bearer ${bearerToken}` }
  });
  
  return tweetsResponse.data.data || [];
}

// CLI usage
if (require.main === module) {
  collectTwitterLeads().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { collectTwitterLeads, searchTweets, searchUserTimeline };