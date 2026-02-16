/**
 * Master Scraper Runner
 * Runs all scrapers with robust error handling, retry logic, and monitoring
 */

const fs = require('fs');
const path = require('path');

// Import all scrapers
const { collectHNLeads } = require('./sources/hn_intent');
const { collectUpworkLeads } = require('./sources/upwork_rss');
const { collectRedditLeads } = require('./sources/reddit_jobs');
const { collectIndiaMARTLeads } = require('./sources/indiamart_scraper');
const { collectGitHubJobs } = require('./sources/github_jobs_scraper');
const { collectTwitterLeads } = require('./sources/twitter_scraper');
const { collectAngelListLeads } = require('./sources/angellist_scraper');
const { collectTradeIndiaLeads } = require('./sources/tradeindia_scraper');

const OUT_DIR = path.resolve(__dirname, 'leads');
const LOG_DIR = path.resolve(__dirname, 'logs');

// Ensure directories exist
[OUT_DIR, LOG_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Scraper registry
const SCRAPERS = {
  hackernews: {
    name: 'Hacker News',
    fn: collectHNLeads,
    enabled: true,
    priority: 'high'
  },
  upwork: {
    name: 'Upwork',
    fn: collectUpworkLeads,
    enabled: true,
    priority: 'high'
  },
  reddit: {
    name: 'Reddit',
    fn: collectRedditLeads,
    enabled: true,
    priority: 'medium'
  },
  indiamart: {
    name: 'IndiaMART',
    fn: collectIndiaMARTLeads,
    enabled: true,
    priority: 'high'
  },
  github: {
    name: 'GitHub Jobs',
    fn: collectGitHubJobs,
    enabled: true,
    priority: 'high'
  },
  twitter: {
    name: 'Twitter/X',
    fn: collectTwitterLeads,
    enabled: true,
    priority: 'medium'
  },
  angellist: {
    name: 'AngelList',
    fn: collectAngelListLeads,
    enabled: true,
    priority: 'high'
  },
  tradeindia: {
    name: 'TradeIndia',
    fn: collectTradeIndiaLeads,
    enabled: true,
    priority: 'medium'
  }
};

/**
 * Logger class for structured logging
 */
class ScraperLogger {
  constructor() {
    this.logs = [];
    this.startTime = Date.now();
  }

  log(level, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data
    };
    this.logs.push(entry);
    
    // Also console log
    const prefix = `[${level.toUpperCase()}]`;
    if (data.scraper) {
      console.log(`${prefix} [${data.scraper}] ${message}`);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  info(message, data) { this.log('info', message, data); }
  warn(message, data) { this.log('warn', message, data); }
  error(message, data) { this.log('error', message, data); }
  success(message, data) { this.log('success', message, data); }

  save() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(LOG_DIR, `scraper-run-${timestamp}.json`);
    fs.writeFileSync(logPath, JSON.stringify({
      startTime: new Date(this.startTime).toISOString(),
      duration: Date.now() - this.startTime,
      logs: this.logs
    }, null, 2));
    return logPath;
  }
}

/**
 * Run a single scraper with error handling
 */
async function runScraper(key, scraper, logger) {
  const startTime = Date.now();
  const result = {
    key,
    name: scraper.name,
    success: false,
    leads: 0,
    duration: 0,
    error: null,
    retries: 0
  };

  logger.info(`Starting scraper: ${scraper.name}`, { scraper: key });

  try {
    const output = await scraper.fn();
    
    result.success = true;
    result.leads = output.leads?.length || output.stats?.unique || 0;
    result.duration = Date.now() - startTime;
    
    logger.success(`Scraper completed: ${scraper.name}`, {
      scraper: key,
      leads: result.leads,
      duration: `${(result.duration / 1000).toFixed(1)}s`
    });

  } catch (error) {
    result.error = error.message;
    result.duration = Date.now() - startTime;
    
    logger.error(`Scraper failed: ${scraper.name}`, {
      scraper: key,
      error: error.message,
      stack: error.stack
    });
  }

  return result;
}

/**
 * Run all enabled scrapers
 */
async function runAllScrapers(options = {}) {
  const {
    specificScrapers = null,
    parallel = false,
    priorityOnly = false
  } = options;

  const logger = new ScraperLogger();
  const results = [];

  // Filter scrapers
  let scrapersToRun = Object.entries(SCRAPERS)
    .filter(([key, scraper]) => scraper.enabled);

  if (specificScrapers) {
    scrapersToRun = scrapersToRun.filter(([key]) => specificScrapers.includes(key));
  }

  if (priorityOnly) {
    scrapersToRun = scrapersToRun.filter(([_, s]) => s.priority === 'high');
  }

  logger.info(`Starting scraper run`, {
    total: scrapersToRun.length,
    parallel,
    scrapers: scrapersToRun.map(([k]) => k)
  });

  if (parallel) {
    // Run in parallel
    const promises = scrapersToRun.map(([key, scraper]) => 
      runScraper(key, scraper, logger)
    );
    const parallelResults = await Promise.all(promises);
    results.push(...parallelResults);
  } else {
    // Run sequentially
    for (const [key, scraper] of scrapersToRun) {
      const result = await runScraper(key, scraper, logger);
      results.push(result);
      
      // Small delay between scrapers
      if (key !== scrapersToRun[scrapersToRun.length - 1][0]) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  // Calculate stats
  const stats = {
    total: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    totalLeads: results.reduce((sum, r) => sum + r.leads, 0),
    totalDuration: results.reduce((sum, r) => sum + r.duration, 0)
  };

  logger.info(`Scraper run completed`, stats);

  // Save run report
  const report = {
    timestamp: new Date().toISOString(),
    options,
    stats,
    results: results.map(r => ({
      ...r,
      duration: `${(r.duration / 1000).toFixed(1)}s`
    }))
  };

  const reportPath = path.join(LOG_DIR, `run-report-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const logPath = logger.save();

  console.log('\n' + '='.repeat(50));
  console.log('📊 SCRAPER RUN SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total scrapers: ${stats.total}`);
  console.log(`Successful: ${stats.successful} ✅`);
  console.log(`Failed: ${stats.failed} ❌`);
  console.log(`Total leads: ${stats.totalLeads}`);
  console.log(`Duration: ${(stats.totalDuration / 1000).toFixed(1)}s`);
  console.log('='.repeat(50));

  // Print individual results
  console.log('\n📋 Individual Results:');
  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    const leads = result.leads > 0 ? `(${result.leads} leads)` : '';
    console.log(`  ${status} ${result.name} ${leads}`);
    if (result.error) {
      console.log(`     Error: ${result.error}`);
    }
  }

  console.log(`\n💾 Report saved: ${reportPath}`);
  console.log(`📝 Logs saved: ${logPath}`);

  return { stats, results, reportPath };
}

/**
 * Check health of all scrapers (quick test)
 */
async function healthCheck() {
  console.log('🏥 Running health check...\n');
  
  const results = [];
  
  for (const [key, scraper] of Object.entries(SCRAPERS)) {
    if (!scraper.enabled) continue;
    
    process.stdout.write(`Checking ${scraper.name}... `);
    
    try {
      // Try to load the module
      const module = require(`./sources/${key}_scraper.js`);
      console.log('✅ OK');
      results.push({ key, name: scraper.name, status: 'ok' });
    } catch (error) {
      // Try alternative paths
      try {
        let modulePath;
        if (key === 'hackernews') modulePath = './sources/hn_intent';
        else if (key === 'upwork') modulePath = './sources/upwork_rss';
        else if (key === 'reddit') modulePath = './sources/reddit_jobs';
        else modulePath = `./sources/${key}_scraper`;
        
        const module = require(modulePath);
        console.log('✅ OK');
        results.push({ key, name: scraper.name, status: 'ok' });
      } catch (e) {
        console.log(`❌ ${e.message}`);
        results.push({ key, name: scraper.name, status: 'error', error: e.message });
      }
    }
  }
  
  console.log('\n' + '='.repeat(30));
  console.log(`Health check: ${results.filter(r => r.status === 'ok').length}/${results.length} OK`);
  
  return results;
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--health')) {
    healthCheck().then(() => process.exit(0));
  } else if (args.includes('--list')) {
    console.log('Available scrapers:');
    for (const [key, scraper] of Object.entries(SCRAPERS)) {
      const status = scraper.enabled ? '✅' : '❌';
      console.log(`  ${status} ${key}: ${scraper.name} (${scraper.priority})`);
    }
  } else {
    const options = {
      parallel: args.includes('--parallel'),
      priorityOnly: args.includes('--priority'),
      specificScrapers: args.includes('--only') 
        ? args[args.indexOf('--only') + 1]?.split(',') 
        : null
    };
    
    runAllScrapers(options).catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
  }
}

module.exports = { runAllScrapers, healthCheck, SCRAPERS };