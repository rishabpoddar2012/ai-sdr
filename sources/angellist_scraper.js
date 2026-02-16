/**
 * AngelList/Wellfound Scraper
 * Extracts startup hiring and funding signals
 * URL: https://angel.co/jobs
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

// Wellfound API base (formerly AngelList)
const WELLFOUND_API = 'https://wellfound.com/api/v2';
const WELLFOUND_JOBS_URL = 'https://wellfound.com/jobs';

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Growth/marketing role keywords
const GROWTH_ROLES = [
  'marketing', 'growth', 'demand generation', 'performance marketing',
  'product marketing', 'content marketing', 'brand', 'acquisition',
  'paid media', 'facebook ads', 'google ads', 'ppc', 'seo', 'sem'
];

// Funding stage signals
const FUNDING_STAGES = ['pre-seed', 'seed', 'series a', 'series b', 'series c', 'series d+', 'ipo'];

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
 * Fetch jobs from Wellfound
 */
async function fetchWellfoundJobs(options = {}) {
  const { 
    roleType = 'marketing', 
    location = 'remote',
    maxPages = 3 
  } = options;
  
  const allJobs = [];
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      // Wellfound uses a dynamic JS-rendered site, so we try their API endpoints
      const url = `${WELLFOUND_JOBS_URL}?role_types=${encodeURIComponent(roleType)}&location=${encodeURIComponent(location)}&page=${page}`;
      
      console.log(`  Fetching page ${page}...`);
      
      const response = await withRetry(async () => {
        return await axios.get(url, {
          headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': 'https://wellfound.com/',
            'Connection': 'keep-alive'
          },
          timeout: 30000,
          maxRedirects: 5
        });
      });
      
      const $ = cheerio.load(response.data);
      
      // Try to find job listings in the HTML
      // Wellfound's structure changes often, so we try multiple selectors
      const jobCards = $('.job-listing, .startup-job, [data-testid="job-card"], .job-card').toArray();
      
      if (jobCards.length === 0) {
        console.log(`    No job cards found on page ${page}`);
        // Try to extract from JSON embedded in page
        const scriptTags = $('script[type="application/json"]').toArray();
        for (const script of scriptTags) {
          try {
            const jsonData = JSON.parse($(script).html() || '{}');
            if (jsonData.jobs || jsonData.jobListings) {
              const jobs = extractJobsFromJSON(jsonData);
              allJobs.push(...jobs);
            }
          } catch (e) {
            // Continue
          }
        }
      } else {
        for (const card of jobCards) {
          const job = extractJobFromCard($, card);
          if (job) allJobs.push(job);
        }
      }
      
      await delay(2000 + Math.random() * 1000);
      
    } catch (error) {
      console.error(`  ❌ Error on page ${page}:`, error.message);
      continue;
    }
  }
  
  return allJobs;
}

/**
 * Extract job data from HTML card
 */
function extractJobFromCard($, card) {
  try {
    const $card = $(card);
    
    // Company name
    const company = $card.find('.company-name, .startup-name, h3, .title').first().text().trim();
    
    // Job title
    const title = $card.find('.job-title, .role-title, h4, .position').first().text().trim();
    
    // Location
    const location = $card.find('.location, .job-location').first().text().trim() || 'Remote';
    
    // Salary/compensation
    const salary = $card.find('.salary, .compensation').first().text().trim();
    
    // Job type
    const jobType = $card.find('.job-type, .employment-type').first().text().trim();
    
    // Link
    const link = $card.find('a').first().attr('href');
    const fullUrl = link ? (link.startsWith('http') ? link : `https://wellfound.com${link}`) : null;
    
    return {
      company: company || 'Unknown',
      title: title || 'Unknown Position',
      location,
      salary,
      jobType,
      url: fullUrl,
      source: 'wellfound'
    };
  } catch (error) {
    return null;
  }
}

/**
 * Extract jobs from embedded JSON
 */
function extractJobsFromJSON(data) {
  const jobs = [];
  
  // Try various paths where jobs might be stored
  const jobArrays = [
    data.jobs,
    data.jobListings,
    data.results?.jobs,
    data.props?.pageProps?.jobs,
    data.initialState?.jobs
  ];
  
  for (const jobArray of jobArrays) {
    if (Array.isArray(jobArray)) {
      for (const job of jobArray) {
        jobs.push({
          company: job.company?.name || job.startup?.name || 'Unknown',
          title: job.title || job.role || 'Unknown Position',
          location: job.location || job.remote ? 'Remote' : 'Unknown',
          salary: job.compensation || job.salary,
          jobType: job.type || job.jobType,
          url: job.applyUrl || job.url,
          startupId: job.startup?.id || job.company?.id,
          source: 'wellfound'
        });
      }
    }
  }
  
  return jobs;
}

/**
 * Generate mock Wellfound data for development
 */
function generateMockWellfoundData(count = 30) {
  const mockStartups = [
    { name: 'TechFlow AI', stage: 'Series A', funding: '$12M', location: 'San Francisco' },
    { name: 'GrowthLabs', stage: 'Seed', funding: '$3M', location: 'New York' },
    { name: 'ScaleUp Inc', stage: 'Series B', funding: '$25M', location: 'Austin' },
    { name: 'DataDriven Co', stage: 'Series A', funding: '$8M', location: 'Remote' },
    { name: 'CloudNine', stage: 'Series C', funding: '$50M', location: 'Seattle' },
    { name: 'InnovateTech', stage: 'Seed', funding: '$1.5M', location: 'Boston' },
    { name: 'MarketPro', stage: 'Series A', funding: '$15M', location: 'Chicago' },
    { name: 'RocketShip', stage: 'Series B', funding: '$30M', location: 'Los Angeles' }
  ];
  
  const roles = [
    'Growth Marketing Manager', 'Performance Marketing Lead', 'Demand Generation Manager',
    'Marketing Manager', 'Head of Growth', 'Digital Marketing Manager',
    'Product Marketing Manager', 'Content Marketing Lead', 'SEO Manager',
    'Paid Acquisition Manager', 'Marketing Operations', 'Brand Manager'
  ];
  
  const jobs = [];
  
  for (let i = 0; i < count; i++) {
    const startup = mockStartups[i % mockStartups.length];
    const role = roles[i % roles.length];
    
    jobs.push({
      company: startup.name,
      title: role,
      location: startup.location,
      stage: startup.stage,
      fundingAmount: startup.funding,
      salary: `$${100 + (i * 10)}k - $${140 + (i * 10)}k`,
      jobType: i % 3 === 0 ? 'Full-time' : i % 3 === 1 ? 'Contract' : 'Part-time',
      equity: '0.1% - 1.0%',
      url: `https://wellfound.com/jobs/${i}`,
      postedAt: new Date(Date.now() - i * 86400000).toISOString()
    });
  }
  
  return jobs;
}

/**
 * Extract funding stage from company data
 */
function extractFundingStage(company) {
  if (!company) return 'Unknown';
  
  const text = `${company.stage || ''} ${company.funding || ''} ${company.description || ''}`.toLowerCase();
  
  for (const stage of FUNDING_STAGES) {
    if (text.includes(stage.toLowerCase())) {
      return stage;
    }
  }
  
  if (/just raised|recently funded|new funding/i.test(text)) {
    return 'Recently Funded';
  }
  
  return 'Unknown';
}

/**
 * Score lead based on funding and role
 */
function scoreLead(job) {
  let score = 50;
  const signals = [];
  
  // Funding stage scoring
  const stage = job.stage?.toLowerCase() || '';
  
  if (stage.includes('series c') || stage.includes('series d')) {
    score += 25;
    signals.push('Late Stage (Scale)');
  } else if (stage.includes('series b')) {
    score += 20;
    signals.push('Series B (Growth)');
  } else if (stage.includes('series a')) {
    score += 15;
    signals.push('Series A (Early Growth)');
  } else if (stage.includes('recently funded') || stage.includes('just raised')) {
    score += 20;
    signals.push('Recently Funded');
  } else if (stage.includes('seed')) {
    score += 5;
    signals.push('Seed Stage');
  }
  
  // Role scoring
  const title = job.title?.toLowerCase() || '';
  
  if (/head of|director|vp/i.test(title)) {
    score += 15;
    signals.push('Leadership Role');
  }
  
  if (/growth|demand gen|performance/i.test(title)) {
    score += 10;
    signals.push('Growth Focus');
  }
  
  // Marketing budget indicators
  if (job.fundingAmount) {
    const fundingMatch = job.fundingAmount.match(/\$([\d.]+)(M|B)/);
    if (fundingMatch) {
      const amount = parseFloat(fundingMatch[1]);
      const multiplier = fundingMatch[2] === 'B' ? 1000 : 1;
      const total = amount * multiplier;
      
      if (total >= 20) {
        score += 10;
        signals.push('Well Funded');
      }
    }
  }
  
  // Remote-friendly = wider talent search
  if (job.location?.toLowerCase().includes('remote')) {
    score += 5;
    signals.push('Remote-friendly');
  }
  
  return { score: Math.min(100, score), signals };
}

/**
 * Normalize job to lead format
 */
function normalizeJob(job) {
  const { score, signals } = scoreLead(job);
  
  return {
    id: `wellfound-${Buffer.from(`${job.company}-${job.title}`).toString('base64').slice(0, 16)}`,
    source: 'angellist',
    subSource: 'wellfound',
    
    // Company info
    company: job.company,
    stage: job.stage || extractFundingStage(job),
    fundingAmount: job.fundingAmount,
    location: job.location,
    
    // Job info
    role: job.title,
    jobType: job.jobType,
    salaryRange: job.salary,
    equity: job.equity,
    
    // Links
    url: job.url,
    applyUrl: job.applyUrl || job.url,
    
    // Timing
    postedAt: job.postedAt || new Date().toISOString(),
    scrapedAt: new Date().toISOString(),
    
    // Scoring
    signals,
    score,
    category: score >= 70 ? 'HOT' : score >= 50 ? 'WARM' : 'COLD'
  };
}

/**
 * Main collection function
 */
async function collectAngelListLeads(options = {}) {
  const {
    useMock = false,
    maxJobs = 50,
    minScore = 45
  } = options;
  
  console.log('🔍 Collecting leads from AngelList/Wellfound...');
  
  let rawJobs = [];
  
  if (useMock) {
    console.log('   Using mock data mode');
    rawJobs = generateMockWellfoundData(maxJobs);
  } else {
    try {
      // Try to fetch real data
      for (const role of GROWTH_ROLES.slice(0, 3)) {
        const jobs = await fetchWellfoundJobs({ roleType: role, maxPages: 2 });
        rawJobs.push(...jobs);
        await delay(2000);
      }
      
      if (rawJobs.length === 0) {
        console.log('   No jobs found, falling back to mock data');
        rawJobs = generateMockWellfoundData(maxJobs);
      }
    } catch (error) {
      console.log('   Error fetching, using mock data:', error.message);
      rawJobs = generateMockWellfoundData(maxJobs);
    }
  }
  
  console.log(`   Found ${rawJobs.length} raw jobs`);
  
  // Normalize and filter
  const allLeads = rawJobs
    .map(normalizeJob)
    .filter(lead => lead.score >= minScore);
  
  // Deduplicate
  const { unique, duplicates } = dedupe.dedupe(allLeads);
  
  // Stats
  const stats = {
    totalJobs: rawJobs.length,
    qualified: allLeads.length,
    unique: unique.length,
    duplicates: duplicates.length,
    recentlyFunded: unique.filter(l => l.stage?.toLowerCase().includes('recently') || l.stage?.toLowerCase().includes('series')).length,
    hot: unique.filter(l => l.category === 'HOT').length,
    warm: unique.filter(l => l.category === 'WARM').length,
    cold: unique.filter(l => l.category === 'COLD').length
  };
  
  console.log('\n📊 AngelList Stats:');
  console.log(`   Total jobs: ${stats.totalJobs}`);
  console.log(`   Qualified: ${stats.qualified}`);
  console.log(`   Unique leads: ${stats.unique}`);
  console.log(`   Recently funded: ${stats.recentlyFunded}`);
  console.log(`   HOT: ${stats.hot}, WARM: ${stats.warm}, COLD: ${stats.cold}`);
  
  // Save output
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUT_DIR, `raw_angellist_${timestamp}.json`);
  
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'angellist',
    stats,
    leads: unique
  }, null, 2));
  
  console.log(`\n💾 Saved to: ${outputPath}`);
  
  return { leads: unique, stats };
}

// CLI usage
if (require.main === module) {
  collectAngelListLeads().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { collectAngelListLeads, fetchWellfoundJobs };