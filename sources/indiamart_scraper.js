/**
 * IndiaMART Scraper
 * Extracts B2B leads from IndiaMART - India's largest B2B marketplace
 * URL: https://dir.indiamart.com/search.mp?ss=software+development
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { Deduplicator } = require('../lib/dedupe');

const OUT_DIR = path.resolve(__dirname, '../leads');
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// Rotating user agents for stealth
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
];

const dedupe = new Deduplicator();

/**
 * Get random user agent
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Delay function for rate limiting
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
      if (attempt === maxRetries) throw error;
      const waitTime = baseDelay * Math.pow(2, attempt - 1);
      console.log(`  ⚠️ Attempt ${attempt} failed, retrying in ${waitTime}ms...`);
      await delay(waitTime);
    }
  }
}

/**
 * Search IndiaMART and extract listings
 */
async function searchIndiaMART(query, options = {}) {
  const { maxPages = 3, minResults = 10 } = options;
  const allListings = [];
  
  const encodedQuery = encodeURIComponent(query);
  
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://dir.indiamart.com/search.mp?ss=${encodedQuery}&page=${page}`;
    
    console.log(`  Scraping page ${page}: ${url}`);
    
    try {
      const response = await withRetry(async () => {
        return await axios.get(url, {
          headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0'
          },
          timeout: 30000,
          maxRedirects: 5
        });
      });
      
      const $ = cheerio.load(response.data);
      
      // IndiaMART listing cards
      const listings = $('.card.card--product, .listing-card, [data-testid="product-card"]').toArray();
      
      if (listings.length === 0) {
        // Try alternative selectors
        const altListings = $('.card, .product-card, .seller-card').toArray();
        console.log(`    Found ${altListings.length} listings (alt selector)`);
        
        for (const el of altListings) {
          const listing = extractListingData($, el, query);
          if (listing) allListings.push(listing);
        }
      } else {
        console.log(`    Found ${listings.length} listings`);
        
        for (const el of listings) {
          const listing = extractListingData($, el, query);
          if (listing) allListings.push(listing);
        }
      }
      
      // Check if we have enough results
      if (allListings.length >= minResults) {
        console.log(`    ✓ Reached minimum results threshold (${minResults})`);
        break;
      }
      
      // Rate limiting delay
      await delay(2000 + Math.random() * 1000);
      
    } catch (error) {
      console.error(`  ❌ Error scraping page ${page}:`, error.message);
      if (error.response) {
        console.error(`     Status: ${error.response.status}`);
      }
      // Continue to next page instead of failing completely
      continue;
    }
  }
  
  return allListings;
}

/**
 * Extract data from a listing element
 */
function extractListingData($, element, query) {
  try {
    const $el = $(element);
    
    // Company/Business name
    const companyName = $el.find('.company-name, .seller-name, [data-testid="company-name"], h3, .card-title').first().text().trim();
    
    if (!companyName || companyName.length < 2) {
      return null;
    }
    
    // Contact info
    let phone = $el.find('.contact-number, .phone, [data-testid="phone"]').first().text().trim();
    let mobile = $el.find('.mobile-number, .mobile').first().text().trim();
    
    // Extract phone numbers from text
    const textContent = $el.text();
    const phoneMatches = textContent.match(/(\+91[\s-]?\d{10}|\d{10,12})/g);
    if (phoneMatches && !phone) {
      phone = phoneMatches[0];
    }
    
    // Location
    const location = $el.find('.location, .city, .address, [data-testid="location"]').first().text().trim();
    
    // Product/Service description
    const description = $el.find('.product-desc, .description, .detail, p').first().text().trim();
    
    // Requirements (what they're looking for)
    const requirements = $el.find('.requirement, .looking-for, .need').first().text().trim();
    
    // Link to listing
    const link = $el.find('a').first().attr('href');
    const fullUrl = link ? (link.startsWith('http') ? link : `https://dir.indiamart.com${link}`) : null;
    
    // Business type (Manufacturer, Exporter, etc.)
    const businessType = $el.find('.business-type, .seller-type').first().text().trim();
    
    // GST number if available
    const gstMatch = textContent.match(/GST[\s-]?(\w{15})/i);
    const gstNumber = gstMatch ? gstMatch[1] : null;
    
    return {
      id: `indiamart-${Buffer.from(companyName).toString('base64').slice(0, 16)}`,
      source: 'indiamart',
      query,
      companyName: cleanCompanyName(companyName),
      phone: normalizePhone(phone),
      mobile: normalizePhone(mobile),
      location: location || 'India',
      description: description?.slice(0, 500),
      requirements: requirements?.slice(0, 300),
      url: fullUrl,
      businessType: businessType || 'Unknown',
      gstNumber,
      country: 'India',
      scrapedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error extracting listing:', error.message);
    return null;
  }
}

/**
 * Clean company name
 */
function cleanCompanyName(name) {
  return name
    .replace(/\s+/g, ' ')
    .replace(/\b(ltd|limited|pvt|private|inc|corp|corporation)\.?/gi, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Normalize Indian phone numbers
 */
function normalizePhone(phone) {
  if (!phone) return null;
  
  // Remove all non-digits
  let digits = phone.replace(/\D/g, '');
  
  // Handle Indian numbers
  if (digits.length === 10) {
    return `+91-${digits}`;
  } else if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits.slice(0, 2)}-${digits.slice(2)}`;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    return `+91-${digits.slice(1)}`;
  }
  
  return phone;
}

/**
 * Extract intent signals from IndiaMART data
 */
function extractSignals(listing) {
  const signals = [];
  const text = `${listing.description} ${listing.requirements}`.toLowerCase();
  
  // Intent signals
  if (/looking for|need|require|searching for|want/i.test(text)) signals.push('Active Requirement');
  if (/bulk|wholesale|large quantity/i.test(text)) signals.push('Bulk Buyer');
  if (/urgent|immediately|asap/i.test(text)) signals.push('Urgent Need');
  if (/export|international|overseas/i.test(text)) signals.push('Export Focus');
  
  // Business type signals
  if (listing.businessType?.toLowerCase().includes('manufacturer')) signals.push('Manufacturer');
  if (listing.businessType?.toLowerCase().includes('exporter')) signals.push('Exporter');
  if (listing.businessType?.toLowerCase().includes('wholesaler')) signals.push('Wholesaler');
  
  // Budget signals
  if (/\d+\s*(lac|lakh|crore|k|thousand)/i.test(text)) signals.push('Budget Mentioned');
  
  return signals;
}

/**
 * Score lead quality
 */
function scoreLead(listing) {
  let score = 50; // Base score
  
  // Contact info available
  if (listing.phone) score += 15;
  if (listing.mobile) score += 10;
  
  // Detailed description
  if (listing.description && listing.description.length > 100) score += 10;
  
  // Has requirements
  if (listing.requirements) score += 15;
  
  // Business signals
  const signals = extractSignals(listing);
  score += signals.length * 5;
  
  // Verified business
  if (listing.gstNumber) score += 10;
  
  return Math.min(100, score);
}

/**
 * Main collection function
 */
async function collectIndiaMARTLeads(options = {}) {
  const queries = options.queries || [
    'software development',
    'digital marketing',
    'website development',
    'mobile app development',
    'digital marketing services',
    'seo services',
    'social media marketing',
    'ecommerce development',
    'crm software',
    'erp software'
  ];
  
  const allLeads = [];
  let successCount = 0;
  let failCount = 0;
  
  console.log('🔍 Collecting leads from IndiaMART...');
  console.log(`   Queries: ${queries.length}`);
  
  for (const query of queries) {
    console.log(`\n  Query: "${query}"`);
    
    try {
      const listings = await searchIndiaMART(query, { 
        maxPages: 2, 
        minResults: 5 
      });
      
      // Enrich listings with signals and scores
      const enrichedListings = listings.map(listing => ({
        ...listing,
        signals: extractSignals(listing),
        score: scoreLead(listing),
        category: scoreLead(listing) >= 70 ? 'HOT' : scoreLead(listing) >= 50 ? 'WARM' : 'COLD'
      }));
      
      allLeads.push(...enrichedListings);
      successCount++;
      
      console.log(`    ✓ Found ${enrichedListings.length} leads`);
      
      // Delay between queries
      await delay(3000 + Math.random() * 2000);
      
    } catch (error) {
      console.error(`  ❌ Failed to scrape "${query}":`, error.message);
      failCount++;
      
      // Continue with next query
      continue;
    }
  }
  
  // Deduplicate
  const { unique, duplicates } = dedupe.dedupe(allLeads);
  
  // Final stats
  const stats = {
    totalScraped: allLeads.length,
    unique: unique.length,
    duplicates: duplicates.length,
    queriesSuccess: successCount,
    queriesFailed: failCount,
    hot: unique.filter(l => l.category === 'HOT').length,
    warm: unique.filter(l => l.category === 'WARM').length,
    cold: unique.filter(l => l.category === 'COLD').length
  };
  
  console.log('\n📊 IndiaMART Scraping Stats:');
  console.log(`   Total scraped: ${stats.totalScraped}`);
  console.log(`   Unique leads: ${stats.unique}`);
  console.log(`   Duplicates removed: ${stats.duplicates}`);
  console.log(`   HOT: ${stats.hot}, WARM: ${stats.warm}, COLD: ${stats.cold}`);
  
  // Save raw output
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUT_DIR, `raw_indiamart_${timestamp}.json`);
  
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'indiamart',
    stats,
    leads: unique
  }, null, 2));
  
  console.log(`\n💾 Saved to: ${outputPath}`);
  
  return { leads: unique, stats };
}

// CLI usage
if (require.main === module) {
  collectIndiaMARTLeads().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { collectIndiaMARTLeads, searchIndiaMART };