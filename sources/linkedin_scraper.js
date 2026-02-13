/**
 * LinkedIn Job/Post Scraper
 * Note: Requires authentication. Use responsibly and comply with LinkedIn's ToS.
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const config = require('../config/env');

const OUT_DIR = path.resolve(__dirname, '../leads');
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

/**
 * Login to LinkedIn
 */
async function linkedInLogin(page) {
  const email = config.linkedinEmail;
  const password = config.linkedinPassword;

  if (!email || !password) {
    throw new Error('LinkedIn credentials not configured. Set LINKEDIN_EMAIL and LINKEDIN_PASSWORD in .env');
  }

  console.log('  Logging into LinkedIn...');
  
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });
  
  await page.type('#username', email);
  await page.type('#password', password);
  await page.click('button[type="submit"]');
  
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  
  // Check for successful login
  const currentUrl = page.url();
  if (currentUrl.includes('login') || currentUrl.includes('challenge')) {
    throw new Error('LinkedIn login failed or requires verification');
  }
  
  console.log('  ✓ Logged in successfully');
}

/**
 * Search for posts with keywords
 */
async function searchPosts(page, query) {
  console.log(`  Searching posts for: "${query}"`);
  
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`;
  await page.goto(searchUrl, { waitUntil: 'networkidle2' });
  
  // Wait for results to load
  await page.waitForSelector('.search-results-container', { timeout: 10000 });
  
  // Scroll to load more results
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 2000));
  }

  // Extract post data
  const posts = await page.evaluate(() => {
    const results = [];
    const postElements = document.querySelectorAll('.feed-shared-update-v2');
    
    postElements.forEach(post => {
      const textEl = post.querySelector('.feed-shared-update-v2__description-wrapper');
      const authorEl = post.querySelector('.feed-shared-actor__name');
      const linkEl = post.querySelector('a.app-aware-link');
      
      if (textEl) {
        results.push({
          text: textEl.innerText,
          author: authorEl ? authorEl.innerText : 'Unknown',
          url: linkEl ? linkEl.href : window.location.href,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    return results;
  });

  return posts;
}

/**
 * Extract signals from LinkedIn post
 */
function extractSignals(post) {
  const signals = [];
  const text = (post.text || '').toLowerCase();

  // Hiring intent
  if (/hiring|looking for|seeking|recruiting/i.test(text)) signals.push('Hiring intent');
  
  // Platform signals
  if (/facebook ads?|meta ads?/i.test(text)) signals.push('Meta/Facebook Ads');
  if (/google ads?|adwords/i.test(text)) signals.push('Google Ads');
  if (/shopify/i.test(text)) signals.push('Shopify');
  if (/ppc|paid media/i.test(text)) signals.push('PPC');
  
  // Urgency
  if (/asap|urgent|immediately/i.test(text)) signals.push('Urgent');

  return signals;
}

/**
 * Normalize LinkedIn post to lead format
 */
function normalizePost(post, query) {
  const signals = extractSignals(post);
  
  return {
    id: `linkedin-${Buffer.from(post.url).toString('base64').slice(0, 16)}`,
    source: 'linkedin',
    query,
    title: post.text.slice(0, 100) + (post.text.length > 100 ? '...' : ''),
    text: post.text.slice(0, 2000),
    url: post.url,
    author: post.author,
    createdAt: post.timestamp,
    signals,
    geo: 'Unknown', // LinkedIn doesn't easily expose geo from posts
    raw: post
  };
}

/**
 * Main collection function
 */
async function collectLinkedInLeads(options = {}) {
  const { headless = true, maxResults = 30 } = options;
  
  console.log('🔍 Collecting leads from LinkedIn...');
  console.log('  ⚠️  Note: LinkedIn scraping requires authentication and may be rate-limited');

  const browser = await puppeteer.launch({ 
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Login
    await linkedInLogin(page);

    // Search for posts
    const queries = [
      'looking for marketing agency',
      'hiring facebook ads specialist',
      'need google ads help'
    ];

    const allLeads = [];

    for (const query of queries) {
      const posts = await searchPosts(page, query);
      
      for (const post of posts.slice(0, maxResults / queries.length)) {
        const lead = normalizePost(post, query);
        allLeads.push(lead);
      }

      // Delay between searches
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log(`✅ Collected ${allLeads.length} leads from LinkedIn`);

    // Save output
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(OUT_DIR, `raw_linkedin_${timestamp}.json`);
    
    fs.writeFileSync(outputPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      leads: allLeads
    }, null, 2));

    console.log(`💾 Saved to: ${outputPath}`);
    
    return allLeads;

  } finally {
    await browser.close();
  }
}

// CLI usage
if (require.main === module) {
  collectLinkedInLeads().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { collectLinkedInLeads };
