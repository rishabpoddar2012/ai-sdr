/**
 * Monitoring Service
 * Tracks scraper performance, success rates, and alerts
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '../logs');
const ALERT_THRESHOLD = 3; // Alert after 3 consecutive failures

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Monitor class for tracking scraper health
 */
class ScraperMonitor {
  constructor(options = {}) {
    this.alertThreshold = options.alertThreshold || ALERT_THRESHOLD;
    this.historyFile = path.join(LOG_DIR, 'scraper-history.json');
    this.alertsFile = path.join(LOG_DIR, 'alerts.json');
    this.history = this.loadHistory();
  }

  /**
   * Load scraper history from file
   */
  loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        return JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading history:', error.message);
    }
    return {};
  }

  /**
   * Save history to file
   */
  saveHistory() {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2));
    } catch (error) {
      console.error('Error saving history:', error.message);
    }
  }

  /**
   * Record a scraper run
   */
  recordRun(scraperName, result) {
    if (!this.history[scraperName]) {
      this.history[scraperName] = {
        runs: [],
        consecutiveFailures: 0,
        totalRuns: 0,
        totalSuccess: 0,
        totalFailures: 0,
        totalLeads: 0
      };
    }

    const scraper = this.history[scraperName];
    const run = {
      timestamp: new Date().toISOString(),
      success: result.success,
      leads: result.leads || 0,
      duration: result.duration || 0,
      error: result.error || null
    };

    scraper.runs.push(run);
    scraper.totalRuns++;

    if (result.success) {
      scraper.totalSuccess++;
      scraper.consecutiveFailures = 0;
      scraper.totalLeads += result.leads || 0;
    } else {
      scraper.totalFailures++;
      scraper.consecutiveFailures++;

      // Check if we need to alert
      if (scraper.consecutiveFailures >= this.alertThreshold) {
        this.createAlert(scraperName, scraper.consecutiveFailures, result.error);
      }
    }

    // Keep only last 100 runs per scraper
    if (scraper.runs.length > 100) {
      scraper.runs = scraper.runs.slice(-100);
    }

    this.saveHistory();
    
    // Log to console
    if (result.success) {
      console.log(`✅ [${scraperName}] Success: ${result.leads} leads in ${(result.duration / 1000).toFixed(1)}s`);
    } else {
      console.log(`❌ [${scraperName}] Failed: ${result.error} (Consecutive: ${scraper.consecutiveFailures})`);
    }

    return scraper;
  }

  /**
   * Create an alert
   */
  createAlert(scraperName, consecutiveFailures, error) {
    const alert = {
      id: `alert-${Date.now()}`,
      scraper: scraperName,
      type: 'consecutive_failures',
      severity: consecutiveFailures >= 5 ? 'critical' : 'warning',
      message: `${scraperName} has failed ${consecutiveFailures} times in a row`,
      error,
      timestamp: new Date().toISOString(),
      acknowledged: false
    };

    // Load existing alerts
    let alerts = [];
    try {
      if (fs.existsSync(this.alertsFile)) {
        alerts = JSON.parse(fs.readFileSync(this.alertsFile, 'utf8'));
      }
    } catch (e) {}

    alerts.push(alert);

    // Keep only last 50 alerts
    if (alerts.length > 50) {
      alerts = alerts.slice(-50);
    }

    fs.writeFileSync(this.alertsFile, JSON.stringify(alerts, null, 2));

    console.error(`\n🚨 ALERT: ${alert.message}\n`);

    return alert;
  }

  /**
   * Get scraper statistics
   */
  getStats(scraperName = null) {
    if (scraperName) {
      const scraper = this.history[scraperName];
      if (!scraper) return null;

      const recentRuns = scraper.runs.slice(-10);
      const recentSuccess = recentRuns.filter(r => r.success).length;

      return {
        name: scraperName,
        totalRuns: scraper.totalRuns,
        totalSuccess: scraper.totalSuccess,
        totalFailures: scraper.totalFailures,
        successRate: ((scraper.totalSuccess / scraper.totalRuns) * 100).toFixed(1),
        totalLeads: scraper.totalLeads,
        consecutiveFailures: scraper.consecutiveFailures,
        recentSuccessRate: ((recentSuccess / recentRuns.length) * 100).toFixed(1),
        avgLeadsPerRun: (scraper.totalLeads / scraper.totalRuns).toFixed(1),
        lastRun: scraper.runs[scraper.runs.length - 1]?.timestamp || null
      };
    }

    // Return stats for all scrapers
    const allStats = {};
    for (const [name, scraper] of Object.entries(this.history)) {
      allStats[name] = this.getStats(name);
    }
    return allStats;
  }

  /**
   * Get active alerts
   */
  getAlerts(acknowledged = false) {
    try {
      if (!fs.existsSync(this.alertsFile)) return [];
      const alerts = JSON.parse(fs.readFileSync(this.alertsFile, 'utf8'));
      return alerts.filter(a => a.acknowledged === acknowledged);
    } catch (error) {
      return [];
    }
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId) {
    try {
      const alerts = JSON.parse(fs.readFileSync(this.alertsFile, 'utf8'));
      const alert = alerts.find(a => a.id === alertId);
      if (alert) {
        alert.acknowledged = true;
        alert.acknowledgedAt = new Date().toISOString();
        fs.writeFileSync(this.alertsFile, JSON.stringify(alerts, null, 2));
        return true;
      }
    } catch (error) {
      console.error('Error acknowledging alert:', error.message);
    }
    return false;
  }

  /**
   * Reset consecutive failures for a scraper
   */
  resetFailures(scraperName) {
    if (this.history[scraperName]) {
      this.history[scraperName].consecutiveFailures = 0;
      this.saveHistory();
    }
  }

  /**
   * Generate health report
   */
  generateHealthReport() {
    const stats = this.getStats();
    const alerts = this.getAlerts(false);

    const healthy = [];
    const warning = [];
    const critical = [];

    for (const [name, stat] of Object.entries(stats)) {
      if (!stat) continue;

      const successRate = parseFloat(stat.successRate);
      const consecutiveFailures = stat.consecutiveFailures;

      if (consecutiveFailures >= 5) {
        critical.push({ name, ...stat });
      } else if (consecutiveFailures >= 3 || successRate < 70) {
        warning.push({ name, ...stat });
      } else {
        healthy.push({ name, ...stat });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        total: Object.keys(stats).length,
        healthy: healthy.length,
        warning: warning.length,
        critical: critical.length,
        activeAlerts: alerts.length
      },
      healthy,
      warning,
      critical,
      alerts
    };
  }

  /**
   * Print health report to console
   */
  printHealthReport() {
    const report = this.generateHealthReport();

    console.log('\n' + '='.repeat(60));
    console.log('🏥 SCRAPER HEALTH REPORT');
    console.log('='.repeat(60));
    console.log(`Generated: ${report.generatedAt}`);
    console.log(`\nSummary:`);
    console.log(`  ✅ Healthy: ${report.summary.healthy}`);
    console.log(`  ⚠️  Warning: ${report.summary.warning}`);
    console.log(`  🚨 Critical: ${report.summary.critical}`);
    console.log(`  🔔 Active Alerts: ${report.summary.activeAlerts}`);

    if (report.critical.length > 0) {
      console.log('\n🚨 CRITICAL:');
      for (const s of report.critical) {
        console.log(`  - ${s.name}: ${s.consecutiveFailures} consecutive failures`);
      }
    }

    if (report.warning.length > 0) {
      console.log('\n⚠️  WARNING:');
      for (const s of report.warning) {
        console.log(`  - ${s.name}: ${s.successRate}% success rate`);
      }
    }

    console.log('\n📊 Detailed Stats:');
    for (const [name, stat] of Object.entries(this.getStats())) {
      const status = report.critical.find(s => s.name === name) ? '🚨' :
                     report.warning.find(s => s.name === name) ? '⚠️' : '✅';
      console.log(`  ${status} ${name}: ${stat.successRate}% (${stat.totalLeads} leads)`);
    }

    console.log('='.repeat(60) + '\n');

    return report;
  }
}

// Singleton instance
let monitorInstance = null;

function getMonitor(options = {}) {
  if (!monitorInstance) {
    monitorInstance = new ScraperMonitor(options);
  }
  return monitorInstance;
}

/**
 * Middleware for Express to track request metrics
 */
function monitoringMiddleware() {
  return (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      const logEntry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        ip: req.ip
      };
      
      // Log slow requests
      if (duration > 5000) {
        console.warn(`⚠️ Slow request: ${req.method} ${req.path} took ${duration}ms`);
      }
    });
    
    next();
  };
}

/**
 * Log scraper metrics to console in structured format
 */
function logScraperMetrics(scraperName, metrics) {
  console.log(JSON.stringify({
    type: 'scraper_metric',
    scraper: scraperName,
    timestamp: new Date().toISOString(),
    ...metrics
  }));
}

module.exports = {
  ScraperMonitor,
  getMonitor,
  monitoringMiddleware,
  logScraperMetrics
};