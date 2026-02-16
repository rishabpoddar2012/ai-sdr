/**
 * GitHub Jobs Scraper
 * Uses the GitHub Jobs API (whoishiring/feed)
 * Extracts company hiring signals for agency services
 * API: https://api.github.com/repos/whoishiring/feed/issues
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

// API Configuration
const GITHUB_API_BASE = 'https://api.github.com/repos/whoishiring/feed/issues';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

// Keywords that indicate high-value hiring (for agencies)
const GROWTH_KEYWORDS = [
  'marketing', 'growth', 'sales', 'demand generation', 'lead generation',
  'performance marketing', 'digital marketing', 'seo', 'sem', 'ppc',
  'facebook ads', 'meta ads', 'google ads', 'linkedin ads',
  'content marketing', 'email marketing', 'marketing automation',
  'product marketing', 'brand', 'acquisition', 'revenue'
];

const TECH_KEYWORDS = [
  'react', 'node', 'python', 'javascript', 'typescript', 'aws',
  'docker', 'kubernetes', 'sql', 'mongodb', 'postgresql'
];

// Remote-friendly indicators
const REMOTE_PATTERNS = [/remote/i, /work from home/i, /wfh/i, /distributed/i, /anywhere/i];

/**
 * Delay function
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry(fn, maxRetries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Handle rate limiting
      if (error.response?.status === 403 && error.response?.headers['x-ratelimit-remaining'] === '0') {
        const resetTime = parseInt(error.response.headers['x-ratelimit-reset']) * 1000;
        const waitTime = resetTime - Date.now();
        console.log(`  ⏳ Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s...`);
        await delay(Math.max(waitTime, 60000));
        continue;
      }
      
      if (attempt === maxRetries) throw error;
      const waitTime = RETRY_DELAY * Math.pow(2, attempt - 1);
      console.log(`  ⚠️ Attempt ${attempt} failed, retrying in ${waitTime}ms...`);
      await delay(waitTime);
    }
  }
}

/**
 * Fetch issues from GitHub Jobs feed
 */
async function fetchGitHubJobs(options = {}) {
  const { 
    maxIssues = 100, 
    since = null,
    state = 'open'
  } = options;
  
  const params = {
    state,
    per_page: Math.min(maxIssues, 100),
    sort: 'created',
    direction: 'desc'
  };
  
  if (since) {
    params.since = since;
  }
  
  console.log(`  Fetching up to ${maxIssues} issues...`);
  
  const response = await withRetry(async () => {
    return await axios.get(GITHUB_API_BASE, {
      params,
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'AI-SDR-GitHub-Jobs-Scraper/1.0'
      },
      timeout: 30000
    });
  });
  
  return response.data || [];
}

/**
 * Parse job posting from issue body
 */
function parseJobPosting(issue) {
  const body = issue.body || '';
  const title = issue.title || '';
  
  // Extract company name from title (usually first part)
  let company = null;
  const companyMatch = title.match(/^([^|\-\[\(]+)/);
  if (companyMatch) {
    company = companyMatch[1].trim();
  }
  
  // Extract role/title
  let role = null;
  const rolePatterns = [
    /\[([^\]]+)\]/,
    /\(([^)]+)\)/,
    /\|\s*([^|]+)\s*$/,
    /hiring\s+([^\[]+)/i
  ];
  
  for (const pattern of rolePatterns) {
    const match = title.match(pattern) || body.match(pattern);
    if (match) {
      role = match[1].trim();
      break;
    }
  }
  
  // Extract location
  let location = 'Remote/Unknown';
  const locationPatterns = [
    /\b(remote|distributed|anywhere)\b/i,
    /\b(nyc|new york|san francisco|sf|london|berlin|toronto|austin|seattle|boston|chicago|los angeles)\b/i
  ];
  
  for (const pattern of locationPatterns) {
    const match = body.match(pattern) || title.match(pattern);
    if (match) {
      location = match[0];
      break;
    }
  }
  
  // Check if remote-friendly
  const isRemote = REMOTE_PATTERNS.some(pattern => 
    pattern.test(body) || pattern.test(title)
  );
  
  // Extract tech stack
  const techStack = [];
  for (const tech of TECH_KEYWORDS) {
    const pattern = new RegExp(`\\b${tech}\\b`, 'i');
    if (pattern.test(body) || pattern.test(title)) {
      techStack.push(tech);
    }
  }
  
  // Extract salary/budget hints
  let salaryHint = null;
  const salaryMatch = body.match(/(\$[\d,]+(?:k?)|\d+\s*k\s*-\s*\d+\s*k|\$\d{2,3},?\d{3})/i);
  if (salaryMatch) {
    salaryHint = salaryMatch[0];
  }
  
  // Extract apply link
  let applyLink = issue.html_url;
  const linkMatch = body.match(/(https?:\/\/[^\s\)\]]+)/);
  if (linkMatch && !linkMatch[0].includes('github.com')) {
    applyLink = linkMatch[0];
  }
  
  return {
    company,
    role,
    location,
    isRemote,
    techStack,
    salaryHint,
    applyLink,
    rawTitle: title,
    rawBody: body.slice(0, 2000)
  };
}

/**
 * Check if job matches marketing/growth criteria
 */
function isGrowthHire(job) {
  const text = `${job.rawTitle} ${job.rawBody}`.toLowerCase();
  
  // Must match at least one growth keyword
  const hasGrowthKeyword = GROWTH_KEYWORDS.some(keyword => {
    const pattern = new RegExp(`\\b${keyword.toLowerCase()}\\b`);
    return pattern.test(text);
  });
  
  return hasGrowthKeyword;
}

/**
 * Score the lead based on hiring signals
 */
function scoreLead(job) {
  let score = 50;
  const signals = [];
  
  // Growth role = high value
  if (isGrowthHire(job)) {
    score += 25;
    signals.push('Growth Hiring');
  }
  
  // Marketing specific
  const text = `${job.rawTitle} ${job.rawBody}`.toLowerCase();
  if (/marketing/i.test(text)) {
    score += 15;
    signals.push('Marketing Focus');
  }
  
  // Sales hiring
  if (/sales/i.test(text)) {
    score += 10;
    signals.push('Sales Hiring');
  }
  
  // Remote = larger talent pool needed
  if (job.isRemote) {
    score += 5;
    signals.push('Remote-friendly');
  }
  
  // Salary mentioned = serious hiring
  if (job.salaryHint) {
    score += 10;
    signals.push('Salary Transparent');
  }
  
  // Senior/experience level
  if (/senior|lead|head of|director|vp/i.test(text)) {
    score += 10;
    signals.push('Senior Role');
  }
  
  // Multiple roles = scaling
  if (/multiple|several|various/i.test(text)) {
    score += 5;
    signals.push('Multiple Openings');
  }
  
  // Agency opportunity signals
  if (/contract|freelance|consultant|agency/i.test(text)) {
    score += 15;
    signals.push('Open to External');
  }
  
  return { score: Math.min(100, score), signals };
}

/**
 * Normalize issue to lead format
 */
function normalizeIssue(issue) {
  const job = parseJobPosting(issue);
  const { score, signals } = scoreLead(job);
  
  return {
    id: `github-${issue.number}`,
    source: 'github_jobs',
    sourceUrl: issue.html_url,
    company: job.company,
    role: job.role,
    location: job.location,
    isRemote: job.isRemote,
    techStack: job.techStack,
    salaryHint: job.salaryHint,
    applyLink: job.applyLink,
    description: job.rawBody.slice(0, 1000),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    signals,
    score,
    category: score >= 70 ? 'HOT' : score >= 50 ? 'WARM' : 'COLD',
    isGrowthHire: isGrowthHire(job),
    scrapedAt: new Date().toISOString()
  };
}

/**
 * Main collection function
 */
async function collectGitHubJobs(options = {}) {
  const {
    maxIssues = 100,
    filterGrowthOnly = true,
    minScore = 40
  } = options;
  
  console.log('🔍 Collecting leads from GitHub Jobs...');
  console.log(`   Max issues: ${maxIssues}`);
  console.log(`   Growth roles only: ${filterGrowthOnly}`);
  
  try {
    const issues = await fetchGitHubJobs({ maxIssues });
    console.log(`   Fetched ${issues.length} issues`);
    
    const allLeads = [];
    let growthCount = 0;
    
    for (const issue of issues) {
      const lead = normalizeIssue(issue);
      
      // Filter by growth roles if enabled
      if (filterGrowthOnly && !lead.isGrowthHire) {
        continue;
      }
      
      // Filter by minimum score
      if (lead.score < minScore) {
        continue;
      }
      
      if (lead.isGrowthHire) growthCount++;
      allLeads.push(lead);
    }
    
    // Deduplicate
    const { unique, duplicates } = dedupe.dedupe(allLeads);
    
    // Stats
    const stats = {
      totalIssues: issues.length,
      growthRoles: growthCount,
      leadsFound: allLeads.length,
      unique: unique.length,
      duplicates: duplicates.length,
      hot: unique.filter(l => l.category === 'HOT').length,
      warm: unique.filter(l => l.category === 'WARM').length,
      cold: unique.filter(l => l.category === 'COLD').length
    };
    
    console.log('\n📊 GitHub Jobs Stats:');
    console.log(`   Total issues: ${stats.totalIssues}`);
    console.log(`   Growth roles: ${stats.growthRoles}`);
    console.log(`   Qualified leads: ${stats.leadsFound}`);
    console.log(`   Unique leads: ${stats.unique}`);
    console.log(`   HOT: ${stats.hot}, WARM: ${stats.warm}, COLD: ${stats.cold}`);
    
    // Save output
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(OUT_DIR, `raw_github_jobs_${timestamp}.json`);
    
    fs.writeFileSync(outputPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'github_jobs',
      stats,
      leads: unique
    }, null, 2));
    
    console.log(`\n💾 Saved to: ${outputPath}`);
    
    return { leads: unique, stats };
    
  } catch (error) {
    console.error('❌ Error collecting GitHub Jobs:', error.message);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Rate limit remaining: ${error.response.headers['x-ratelimit-remaining'] || 'N/A'}`);
    }
    throw error;
  }
}

/**
 * Fetch by company (for enrichment)
 */
async function searchByCompany(companyName, options = {}) {
  console.log(`Searching GitHub Jobs for: ${companyName}`);
  
  const allIssues = await fetchGitHubJobs({ maxIssues: 100 });
  
  const matchingIssues = allIssues.filter(issue => {
    const text = `${issue.title} ${issue.body || ''}`.toLowerCase();
    return text.includes(companyName.toLowerCase());
  });
  
  return matchingIssues.map(normalizeIssue);
}

// CLI usage
if (require.main === module) {
  collectGitHubJobs().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { collectGitHubJobs, searchByCompany, fetchGitHubJobs };