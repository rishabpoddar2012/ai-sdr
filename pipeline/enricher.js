/**
 * Lead Enricher - Adds additional data to leads
 */
const { getInstance: getDb } = require('../lib/db');

const db = getDb();

/**
 * Enrich a lead with additional computed fields
 */
function enrichLead(lead) {
  const enriched = { ...lead };

  // Calculate engagement score
  enriched.engagementScore = calculateEngagementScore(lead);

  // Add tags based on content
  enriched.tags = generateTags(lead);

  // Estimate company size if possible
  enriched.estimatedCompanySize = estimateCompanySize(lead);

  // Calculate lead value estimate
  enriched.estimatedValue = estimateLeadValue(lead);

  // Add priority score (composite of multiple factors)
  enriched.priorityScore = calculatePriorityScore(enriched);

  enriched.enrichedAt = new Date().toISOString();

  return enriched;
}

/**
 * Calculate engagement score based on signals and content
 */
function calculateEngagementScore(lead) {
  let score = 0;
  const text = `${lead.title} ${lead.text || ''}`.toLowerCase();

  // Budget mentions
  if (/\$[\d,]+k?/i.test(text)) score += 20;
  if (/budget|spend/i.test(text)) score += 15;

  // Urgency
  if (/asap|urgent|immediately/i.test(text)) score += 25;
  if (/this week|soon|quickly/i.test(text)) score += 15;

  // Contact info
  if (lead.author) score += 10;
  if (/email|contact|dm/i.test(text)) score += 10;

  // Platform fit
  if (/facebook ads?|meta ads?/i.test(text)) score += 20;
  if (/google ads?|adwords/i.test(text)) score += 20;
  if (/shopify|ecommerce/i.test(text)) score += 15;

  // Signal count
  score += (lead.signals?.length || 0) * 5;

  return Math.min(100, score);
}

/**
 * Generate tags based on content
 */
function generateTags(lead) {
  const tags = [];
  const text = `${lead.title} ${lead.text || ''}`.toLowerCase();

  // Platform tags
  if (/facebook ads?|meta ads?/i.test(text)) tags.push('meta-ads');
  if (/google ads?|adwords/i.test(text)) tags.push('google-ads');
  if (/tiktok ads?/i.test(text)) tags.push('tiktok-ads');
  if (/linkedin ads?/i.test(text)) tags.push('linkedin-ads');

  // Industry tags
  if (/shopify|woocommerce/i.test(text)) tags.push('ecommerce');
  if (/saas|b2b/i.test(text)) tags.push('saas');
  if (/local business|service/i.test(text)) tags.push('local-business');
  if (/app|mobile/i.test(text)) tags.push('mobile-app');

  // Service type
  if (/agency/i.test(text)) tags.push('wants-agency');
  if (/freelancer|contractor/i.test(text)) tags.push('wants-freelancer');
  if (/full.time|employee/i.test(text)) tags.push('wants-employee');

  // Urgency
  if (/asap|urgent/i.test(text)) tags.push('urgent');

  // Budget level
  if (/\$[\d,]+000|k\s*\+?/i.test(text)) tags.push('high-budget');
  else if (/\$[\d,]+/i.test(text)) tags.push('has-budget');

  return tags;
}

/**
 * Estimate company size from context
 */
function estimateCompanySize(lead) {
  const text = `${lead.title} ${lead.text || ''}`.toLowerCase();

  if (/enterprise|fortune 500|large company|corporation/i.test(text)) {
    return 'enterprise';
  }
  if (/startup|seed|series a/i.test(text)) {
    return 'startup';
  }
  if (/smb|small business|local/i.test(text)) {
    return 'smb';
  }
  if (/solo|freelance|individual|one person/i.test(text)) {
    return 'solo';
  }

  return 'unknown';
}

/**
 * Estimate potential lead value
 */
function estimateLeadValue(lead) {
  const text = `${lead.title} ${lead.text || ''}`.toLowerCase();

  // Look for budget indicators
  const budgetMatch = text.match(/\$([\d,]+)\s*(k?)/i);
  if (budgetMatch) {
    let amount = parseInt(budgetMatch[1].replace(/,/g, ''));
    if (budgetMatch[2].toLowerCase() === 'k') amount *= 1000;
    return { min: amount * 0.1, max: amount * 0.3, confidence: 'medium' };
  }

  // Default estimates based on company size
  const size = estimateCompanySize(lead);
  const estimates = {
    enterprise: { min: 10000, max: 50000, confidence: 'low' },
    startup: { min: 3000, max: 10000, confidence: 'low' },
    smb: { min: 1000, max: 5000, confidence: 'low' },
    solo: { min: 500, max: 2000, confidence: 'low' },
    unknown: { min: 0, max: 0, confidence: 'none' }
  };

  return estimates[size] || estimates.unknown;
}

/**
 * Calculate overall priority score
 */
function calculatePriorityScore(enrichedLead) {
  let score = enrichedLead.engagementScore || 0;

  // Boost for HOT leads
  if (enrichedLead.score === 'HOT') score += 30;
  else if (enrichedLead.score === 'WARM') score += 15;

  // Boost for high-budget tags
  if (enrichedLead.tags?.includes('high-budget')) score += 20;
  if (enrichedLead.tags?.includes('urgent')) score += 15;

  // Boost for platform fit
  if (enrichedLead.tags?.includes('meta-ads')) score += 10;
  if (enrichedLead.tags?.includes('google-ads')) score += 10;

  return Math.min(100, score);
}

/**
 * Enrich all leads that haven't been enriched yet
 */
async function enrichLeads(options = {}) {
  const { limit = 100 } = options;

  console.log('🔧 Starting lead enrichment...');

  const leads = db.getAllLeads()
    .filter(l => !l.enrichedAt)
    .slice(0, limit);

  if (leads.length === 0) {
    console.log('  No leads to enrich.');
    return { enriched: 0 };
  }

  console.log(`  Enriching ${leads.length} leads...`);

  let count = 0;
  for (const lead of leads) {
    const enriched = enrichLead(lead);
    db.updateLead(lead.id, enriched);
    count++;
  }

  console.log(`✅ Enriched ${count} leads`);
  return { enriched: count };
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex > -1 ? parseInt(args[limitIndex + 1]) : 100;

  enrichLeads({ limit }).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { enrichLeads, enrichLead };
