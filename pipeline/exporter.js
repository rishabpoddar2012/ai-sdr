/**
 * Lead Exporter - Exports leads to various integrations
 */
const { getInstance: getDb } = require('../lib/db');
const { AirtableExporter } = require('../lib/airtable');
const { GoogleSheetsExporter } = require('../lib/google_sheets');
const { WebhookSender } = require('../lib/webhook');
const config = require('../config/env');

const db = getDb();

/**
 * Export leads based on target
 */
async function exportLeads(options = {}) {
  const { 
    target = 'all', 
    minScore = config.minScore,
    onlyNew = true,
    limit = 100
  } = options;

  console.log(`📤 Starting export to ${target}...`);
  console.log(`   Min score: ${minScore}, Only new: ${onlyNew}`);

  // Get leads to export
  let leads = db.getAllLeads()
    .filter(l => l.processed && l.score !== 'PENDING');

  // Filter by score
  if (minScore === 'HOT') {
    leads = leads.filter(l => l.score === 'HOT');
  } else if (minScore === 'WARM') {
    leads = leads.filter(l => l.score === 'HOT' || l.score === 'WARM');
  }

  // Filter to only unexported leads if specified
  if (onlyNew) {
    leads = leads.filter(l => !l.exportedAt);
  }

  leads = leads.slice(0, limit);

  if (leads.length === 0) {
    console.log('  No leads to export.');
    return { exported: 0 };
  }

  console.log(`  Exporting ${leads.length} leads...`);

  const results = {};

  // Export to Airtable
  if (target === 'all' || target === 'airtable') {
    results.airtable = await exportToAirtable(leads);
  }

  // Export to Google Sheets
  if (target === 'all' || target === 'sheets') {
    results.sheets = await exportToSheets(leads);
  }

  // Export via webhooks
  if (target === 'all' || target === 'webhook') {
    results.webhook = await exportToWebhooks(leads);
  }

  // Mark leads as exported
  const now = new Date().toISOString();
  for (const lead of leads) {
    db.updateLead(lead.id, {
      exportedAt: now,
      exportTargets: [...(lead.exportTargets || []), target]
    });
  }

  console.log('✅ Export complete!');
  return { exported: leads.length, results };
}

/**
 * Export to Airtable
 */
async function exportToAirtable(leads) {
  const exporter = new AirtableExporter();

  if (!exporter.isConfigured()) {
    console.log('  ⚠️  Airtable not configured, skipping');
    return { skipped: true };
  }

  try {
    // Filter to only leads not already in Airtable
    const newLeads = [];
    for (const lead of leads) {
      const exists = await exporter.leadExists(lead.id);
      if (!exists) {
        newLeads.push(lead);
      }
    }

    if (newLeads.length === 0) {
      console.log('  No new leads to export to Airtable');
      return { count: 0 };
    }

    console.log(`  Exporting ${newLeads.length} leads to Airtable...`);
    const results = await exporter.exportLeads(newLeads);
    const successCount = results.filter(r => r.success).length;
    console.log(`  ✓ Exported ${successCount}/${newLeads.length} to Airtable`);

    return { count: successCount, total: newLeads.length };
  } catch (error) {
    console.error('  Airtable export error:', error.message);
    return { error: error.message };
  }
}

/**
 * Export to Google Sheets
 */
async function exportToSheets(leads) {
  const exporter = new GoogleSheetsExporter();

  if (!exporter.isConfigured()) {
    console.log('  ⚠️  Google Sheets not configured, skipping');
    return { skipped: true };
  }

  try {
    // Get existing IDs to avoid duplicates
    const existingIds = await exporter.getExistingIds();
    const newLeads = leads.filter(l => !existingIds.has(l.id));

    if (newLeads.length === 0) {
      console.log('  No new leads to export to Google Sheets');
      return { count: 0 };
    }

    console.log(`  Exporting ${newLeads.length} leads to Google Sheets...`);
    const result = await exporter.exportLeads(newLeads);
    
    if (result.success) {
      console.log(`  ✓ Exported ${result.count} leads to Google Sheets`);
      return { count: result.count };
    } else {
      console.error('  Google Sheets error:', result.error);
      return { error: result.error };
    }
  } catch (error) {
    console.error('  Google Sheets export error:', error.message);
    return { error: error.message };
  }
}

/**
 * Export via webhooks
 */
async function exportToWebhooks(leads) {
  const sender = new WebhookSender();

  if (!sender.hasWebhooks()) {
    console.log('  ⚠️  No webhooks configured, skipping');
    return { skipped: true };
  }

  const results = {};

  for (const target of ['hubspot', 'salesforce', 'custom']) {
    if (sender.isConfigured(target)) {
      console.log(`  Sending ${leads.length} leads to ${target} webhook...`);
      const sendResults = await sender.sendLeads(leads, target);
      const successCount = sendResults.filter(r => r.success).length;
      console.log(`  ✓ Sent ${successCount}/${leads.length} to ${target}`);
      results[target] = { count: successCount, total: leads.length };
    }
  }

  return results;
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  let target = 'all';
  let minScore = config.minScore;

  // Parse arguments
  const targetIndex = args.findIndex(a => a.startsWith('--target='));
  if (targetIndex > -1) {
    target = args[targetIndex].split('=')[1];
  }

  const scoreIndex = args.findIndex(a => a.startsWith('--min-score='));
  if (scoreIndex > -1) {
    minScore = args[scoreIndex].split('=')[1];
  }

  exportLeads({ target, minScore }).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { exportLeads, exportToAirtable, exportToSheets, exportToWebhooks };
