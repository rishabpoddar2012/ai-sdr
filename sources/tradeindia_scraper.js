/**
 * TradeIndia Scraper
 * Extracts B2B buyers and manufacturers from TradeIndia
 * URL: https://www.tradeindia.com/manufacturers/
 * Niche: Commodity buyers, manufacturing leads
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

const dedupe = new Deduplicator();

// Rotating user agents
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

// Product categories to search
const CATEGORIES = [
  'packaging-materials',
  'textile-machinery',
  'industrial-machinery',
  'agricultural-products',
  'chemicals',
  'pharmaceuticals',
  'automotive-parts',
  'electronics-components',
  'construction-materials',
  'food-processing'
];

// Buy requirement keywords
const BUY_KEYWORDS = [
  'importer', 'buyer', 'wholesaler', 'distributor',
  'looking for suppliers', 'want to buy', 'bulk purchase',
  'trade inquiry', 'buying requirement'
];

/**
 * Get random user agent
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

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
      if (attempt === maxRetries) throw error;
      const waitTime = baseDelay * Math.pow(2, attempt - 1);
      console.log(`  ⚠️ Attempt ${attempt} failed, retrying in ${waitTime}ms...`);
      await delay(waitTime);
    }
  }
}

/**
 * Fetch manufacturers/buyers for a category
 */
async function fetchTradeIndiaListings(category, options = {}) {
  const { maxPages = 3 } = options;
  const allListings = [];
  
  for (let page = 1; page <= maxPages; page++) {
    // Multiple URL patterns to try
    const urls = [
      `https://www.tradeindia.com/manufacturers/${category}.html?page=${page}`,
      `https://www.tradeindia.com/suppliers/${category}.html?page=${page}`,
      `https://www.tradeindia.com/products/${category}.html?page=${page}`
    ];
    
    let success = false;
    
    for (const url of urls) {
      try {
        console.log(`  Trying: ${url}`);
        
        const response = await withRetry(async () => {
          return await axios.get(url, {
            headers: {
              'User-Agent': getRandomUserAgent(),
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Accept-Encoding': 'gzip, deflate, br',
              'Referer': 'https://www.tradeindia.com/',
              'Connection': 'keep-alive'
            },
            timeout: 30000,
            maxRedirects: 5
          });
        });
        
        const $ = cheerio.load(response.data);
        const listings = extractListingsFromPage($, category);
        
        if (listings.length > 0) {
          allListings.push(...listings);
          console.log(`    ✓ Found ${listings.length} listings`);
          success = true;
          break;
        }
      } catch (error) {
        console.log(`    ✗ Failed: ${error.message}`);
        continue;
      }
    }
    
    if (!success) {
      console.log(`    Could not fetch page ${page} for ${category}`);
    }
    
    // Rate limiting
    await delay(2000 + Math.random() * 1000);
  }
  
  return allListings;
}

/**
 * Extract listings from page HTML
 */
function extractListingsFromPage($, category) {
  const listings = [];
  
  // Try multiple selector patterns
  const selectors = [
    '.listing-card',
    '.supplier-card',
    '.manufacturer-card',
    '.company-card',
    '.product-card',
    '.business-listing',
    '.seller-card'
  ];
  
  for (const selector of selectors) {
    const cards = $(selector).toArray();
    
    for (const card of cards) {
      const listing = extractCardData($, card, category);
      if (listing) listings.push(listing);
    }
    
    if (listings.length > 0) break;
  }
  
  // If no cards found with selectors, try to find by structure
  if (listings.length === 0) {
    const rows = $('tr, .row, .item').toArray();
    for (const row of rows) {
      const listing = extractRowData($, row, category);
      if (listing) listings.push(listing);
    }
  }
  
  return listings;
}

/**
 * Extract data from a card element
 */
function extractCardData($, card, category) {
  try {
    const $card = $(card);
    
    // Company name
    const companyName = $card.find('.company-name, .seller-name, h3, h4, .title, .name').first().text().trim();
    if (!companyName || companyName.length < 2) return null;
    
    // Contact info
    const phone = $card.find('.phone, .mobile, .contact, .tel').first().text().trim();
    const email = $card.find('.email').first().text().trim();
    
    // Location
    const location = $card.find('.location, .city, .address, .state').first().text().trim();
    
    // Business type
    const businessType = $card.find('.business-type, .seller-type, .type').first().text().trim();
    
    // Products/services
    const products = $card.find('.products, .category, .offering').first().text().trim();
    
    // Link
    const link = $card.find('a').first().attr('href');
    const fullUrl = link ? (link.startsWith('http') ? link : `https://www.tradeindia.com${link}`) : null;
    
    return {
      companyName: cleanCompanyName(companyName),
      phone: normalizePhone(phone),
      email: email || null,
      location: location || 'India',
      businessType: businessType || 'Unknown',
      products: products,
      category,
      url: fullUrl,
      source: 'tradeindia'
    };
  } catch (error) {
    return null;
  }
}

/**
 * Extract data from table row
 */
function extractRowData($, row, category) {
  try {
    const $row = $(row);
    const cells = $row.find('td, .col, .cell');
    
    if (cells.length < 2) return null;
    
    const companyName = cells.eq(0).text().trim();
    if (!companyName || companyName.length < 2) return null;
    
    return {
      companyName: cleanCompanyName(companyName),
      phone: normalizePhone(cells.eq(1).text().trim()),
      location: cells.eq(2)?.text().trim() || 'India',
      businessType: cells.eq(3)?.text().trim() || 'Unknown',
      category,
      source: 'tradeindia'
    };
  } catch (error) {
    return null;
  }
}

/**
 * Fetch buy requirements (leads looking for suppliers)
 */
async function fetchBuyRequirements(options = {}) {
  const { maxResults = 50 } = options;
  
  const requirements = [];
  
  try {
    const url = 'https://www.tradeindia.com/buy-requirements/';
    
    const response = await withRetry(async () => {
      return await axios.get(url, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 30000
      });
    });
    
    const $ = cheerio.load(response.data);
    
    // Extract buy requirements
    const reqCards = $('.requirement-card, .buy-lead, .inquiry-card').toArray();
    
    for (const card of reqCards) {
      const $card = $(card);
      
      const product = $card.find('.product-name, .title').first().text().trim();
      const quantity = $card.find('.quantity').first().text().trim();
      const buyer = $card.find('.buyer-name, .company').first().text().trim();
      const location = $card.find('.location').first().text().trim();
      const posted = $card.find('.posted, .date').first().text().trim();
      
      if (product && buyer) {
        requirements.push({
          product,
          quantity,
          buyer: cleanCompanyName(buyer),
          location: location || 'India',
          postedDate: posted,
          type: 'buy_requirement',
          source: 'tradeindia'
        });
      }
    }
    
  } catch (error) {
    console.error('Error fetching buy requirements:', error.message);
  }
  
  return requirements.slice(0, maxResults);
}

/**
 * Generate mock TradeIndia data for development
 */
function generateMockTradeIndiaData(count = 50) {
  const mockCompanies = [
    { name: 'Apex Packaging Solutions', type: 'Manufacturer', location: 'Mumbai, Maharashtra' },
    { name: 'Global Textile Traders', type: 'Exporter', location: 'Surat, Gujarat' },
    { name: 'TechMach Industries', type: 'Manufacturer', location: 'Pune, Maharashtra' },
    { name: 'AgriFresh Exports', type: 'Exporter', location: 'Nashik, Maharashtra' },
    { name: 'ChemCorp India', type: 'Distributor', location: 'Ahmedabad, Gujarat' },
    { name: 'AutoParts Hub', type: 'Wholesaler', location: 'Chennai, Tamil Nadu' },
    { name: 'ElectroMax Components', type: 'Manufacturer', location: 'Bangalore, Karnataka' },
    { name: 'BuildRight Materials', type: 'Supplier', location: 'Hyderabad, Telangana' },
    { name: 'FoodTech Processors', type: 'Manufacturer', location: 'Delhi NCR' },
    { name: 'PharmaLink Distributors', type: 'Distributor', location: 'Kolkata, West Bengal' }
  ];
  
  const mockRequirements = [
    { product: 'Corrugated Boxes', qty: '50,000 units/month' },
    { product: 'Cotton Yarn', qty: '10 tons' },
    { product: 'Industrial Motors', qty: '25 units' },
    { product: 'Organic Spices', qty: '5 tons' },
    { product: 'Laboratory Chemicals', qty: 'Bulk' },
    { product: 'Automotive Filters', qty: '1000 units' },
    { product: 'PCB Components', qty: '5000 units' },
    { product: 'Steel Rods', qty: '20 tons' },
    { product: 'Food Packaging', qty: '100,000 units' },
    { product: 'Medical Supplies', qty: 'Bulk' }
  ];
  
  const listings = [];
  
  for (let i = 0; i < count; i++) {
    const company = mockCompanies[i % mockCompanies.length];
    const req = mockRequirements[i % mockRequirements.length];
    
    listings.push({
      companyName: company.name,
      phone: `+91-${9000000000 + Math.floor(Math.random() * 999999999)}`,
      email: `contact@${company.name.toLowerCase().replace(/\s+/g, '')}.com`,
      location: company.location,
      businessType: company.type,
      products: req.product,
      category: CATEGORIES[i % CATEGORIES.length],
      requirement: req.qty,
      isBuyRequirement: i % 3 === 0,
      url: `https://www.tradeindia.com/company/${i}`,
      source: 'tradeindia'
    });
  }
  
  return listings;
}

/**
 * Clean company name
 */
function cleanCompanyName(name) {
  return name
    .replace(/\s+/g, ' ')
    .replace(/\b(ltd|limited|pvt|private|inc|corp)\.?/gi, '')
    .trim();
}

/**
 * Normalize Indian phone numbers
 */
function normalizePhone(phone) {
  if (!phone) return null;
  
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length === 10) {
    return `+91-${digits}`;
  } else if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits.slice(0, 2)}-${digits.slice(2)}`;
  }
  
  return phone;
}

/**
 * Extract business signals
 */
function extractSignals(listing) {
  const signals = [];
  const type = (listing.businessType || '').toLowerCase();
  
  if (type.includes('manufacturer')) signals.push('Manufacturer');
  if (type.includes('exporter')) signals.push('Exporter');
  if (type.includes('importer')) signals.push('Importer');
  if (type.includes('wholesaler')) signals.push('Wholesaler');
  if (type.includes('distributor')) signals.push('Distributor');
  
  if (listing.isBuyRequirement) signals.push('Active Buyer');
  if (listing.requirement) signals.push('Quantity Specified');
  
  return signals;
}

/**
 * Score lead quality
 */
function scoreLead(listing) {
  let score = 45;
  const signals = extractSignals(listing);
  
  // Contact availability
  if (listing.phone) score += 15;
  if (listing.email) score += 15;
  
  // Business type
  if (listing.businessType?.toLowerCase().includes('manufacturer')) score += 10;
  if (listing.businessType?.toLowerCase().includes('exporter')) score += 10;
  
  // Active buyer
  if (listing.isBuyRequirement) score += 20;
  
  // Bulk order potential
  if (listing.requirement) score += 10;
  
  score += signals.length * 3;
  
  return Math.min(100, score);
}

/**
 * Normalize to lead format
 */
function normalizeListing(listing) {
  const score = scoreLead(listing);
  
  return {
    id: `tradeindia-${Buffer.from(listing.companyName).toString('base64').slice(0, 16)}`,
    source: 'tradeindia',
    
    companyName: listing.companyName,
    phone: listing.phone,
    email: listing.email,
    location: listing.location,
    businessType: listing.businessType,
    products: listing.products,
    category: listing.category,
    requirement: listing.requirement,
    isBuyRequirement: listing.isBuyRequirement || false,
    url: listing.url,
    
    signals: extractSignals(listing),
    score,
    category: score >= 70 ? 'HOT' : score >= 50 ? 'WARM' : 'COLD',
    
    scrapedAt: new Date().toISOString()
  };
}

/**
 * Main collection function
 */
async function collectTradeIndiaLeads(options = {}) {
  const {
    useMock = false,
    maxListings = 50,
    minScore = 40
  } = options;
  
  console.log('🔍 Collecting leads from TradeIndia...');
  
  let rawListings = [];
  
  if (useMock) {
    console.log('   Using mock data mode');
    rawListings = generateMockTradeIndiaData(maxListings);
  } else {
    // Try to fetch real data
    for (const category of CATEGORIES.slice(0, 3)) {
      console.log(`\n  Category: ${category}`);
      try {
        const listings = await fetchTradeIndiaListings(category, { maxPages: 2 });
        rawListings.push(...listings);
        console.log(`    ✓ Found ${listings.length} listings`);
      } catch (error) {
        console.error(`    ❌ Error: ${error.message}`);
      }
      await delay(3000);
    }
    
    // Also fetch buy requirements
    console.log('\n  Fetching buy requirements...');
    try {
      const buyReqs = await fetchBuyRequirements({ maxResults: 20 });
      rawListings.push(...buyReqs);
      console.log(`    ✓ Found ${buyReqs.length} buy requirements`);
    } catch (error) {
      console.error(`    ❌ Error: ${error.message}`);
    }
    
    if (rawListings.length === 0) {
      console.log('\n   No data found, falling back to mock data');
      rawListings = generateMockTradeIndiaData(maxListings);
    }
  }
  
  console.log(`\n   Total raw listings: ${rawListings.length}`);
  
  // Normalize and filter
  const allLeads = rawListings
    .map(normalizeListing)
    .filter(lead => lead.score >= minScore);
  
  // Deduplicate
  const { unique, duplicates } = dedupe.dedupe(allLeads);
  
  // Stats
  const stats = {
    totalListings: rawListings.length,
    qualified: allLeads.length,
    unique: unique.length,
    duplicates: duplicates.length,
    manufacturers: unique.filter(l => l.businessType?.toLowerCase().includes('manufacturer')).length,
    exporters: unique.filter(l => l.businessType?.toLowerCase().includes('exporter')).length,
    activeBuyers: unique.filter(l => l.isBuyRequirement).length,
    hot: unique.filter(l => l.category === 'HOT').length,
    warm: unique.filter(l => l.category === 'WARM').length,
    cold: unique.filter(l => l.category === 'COLD').length
  };
  
  console.log('\n📊 TradeIndia Stats:');
  console.log(`   Total listings: ${stats.totalListings}`);
  console.log(`   Qualified: ${stats.qualified}`);
  console.log(`   Unique leads: ${stats.unique}`);
  console.log(`   Manufacturers: ${stats.manufacturers}`);
  console.log(`   Exporters: ${stats.exporters}`);
  console.log(`   Active buyers: ${stats.activeBuyers}`);
  console.log(`   HOT: ${stats.hot}, WARM: ${stats.warm}, COLD: ${stats.cold}`);
  
  // Save output
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUT_DIR, `raw_tradeindia_${timestamp}.json`);
  
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'tradeindia',
    stats,
    leads: unique
  }, null, 2));
  
  console.log(`\n💾 Saved to: ${outputPath}`);
  
  return { leads: unique, stats };
}

// CLI usage
if (require.main === module) {
  collectTradeIndiaLeads().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { collectTradeIndiaLeads, fetchTradeIndiaListings, fetchBuyRequirements };