/**
 * Lead Scorer - Uses OpenAI to score and qualify leads
 */
const fs = require('fs');
const path = require('path');
const { openaiChatJSON } = require('../lib/openai_client');
const { getInstance: getDb } = require('../lib/db');
const config = require('../config/env');

const db = getDb();

// Scoring schema for OpenAI
const SCORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { 
      type: 'string', 
      enum: ['HOT', 'WARM', 'COLD'],
      description: 'Lead quality score based on buying intent'
    },
    geo: { 
      type: 'string', 
      enum: ['US', 'UK', 'EU', 'Canada', 'Australia', 'Other'],
      description: 'Geographic region of the lead'
    },
    intent: { 
      type: 'string', 
      enum: ['buyer_request', 'hiring_employee', 'self_promo', 'other'],
      description: 'Type of intent detected'
    },
    why: { 
      type: 'string',
      description: 'Detailed explanation of the scoring decision'
    },
    signals: { 
      type: 'array', 
      items: { type: 'string' },
      maxItems: 8,
      description: 'Key signals detected in the lead'
    },
    first_message: { 
      type: 'string',
      description: 'Personalized first outreach message'
    },
    extracted: {
      type: 'object',
      additionalProperties: false,
      properties: {
        budget_hint: { 
          type: ['string', 'null'],
          description: 'Any budget information mentioned'
        },
        timeline_hint: { 
          type: ['string', 'null'],
          description: 'Any timeline/urgency mentioned'
        },
        niche: { 
          type: ['string', 'null'],
          description: 'Industry/niche if mentioned'
        }
      },
      required: ['budget_hint', 'timeline_hint', 'niche']
    }
  },
  required: ['score', 'geo', 'intent', 'why', 'signals', 'first_message', 'extracted']
};

/**
 * Score a single lead using OpenAI
 */
async function scoreLead(lead) {
  const systemPrompt = `You are an expert AI Sales Development Representative for a performance marketing agency specializing in Meta (Facebook) Ads and Google Ads.

Your task is to score and qualify leads based on their buying intent.

SCORING CRITERIA:
- HOT: Clear buying intent + budget signals + urgency + good fit for performance marketing
- WARM: Some intent but missing details OR lower urgency OR partial fit
- COLD: Vague, no budget mentioned, low urgency, or poor fit

KEY SIGNALS TO LOOK FOR:
- Budget mentions ($X/month, $Xk spend, etc.)
- Urgency words (ASAP, urgent, this week, immediately)
- Platform fit (Facebook/Meta Ads, Google Ads, PPC, Shopify)
- Intent clarity (clear ask vs vague inquiry)
- Company type (ecommerce, SaaS, local business)

GEO CLASSIFICATION:
- Look for location hints in the text (cities, timezones, "remote US", etc.)

FIRST MESSAGE:
- Write a personalized, concise outreach message (2-3 sentences max)
- Reference specific details from their post
- Include a clear call to action
- Be professional but conversational

Respond with valid JSON only.`;

  const userContent = `
Source: ${lead.source}
Title: ${lead.title}
Content: ${lead.text}
URL: ${lead.url}
Author: ${lead.author || 'Unknown'}
Existing Signals: ${(lead.signals || []).join(', ')}
`;

  try {
    const result = await openaiChatJSON({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      jsonSchema: SCORE_SCHEMA,
      temperature: 0.2
    });

    return {
      ...lead,
      score: result.score,
      geo: result.geo,
      intent: result.intent,
      why: result.why,
      signals: result.signals,
      recommended_message: result.first_message,
      extracted: result.extracted,
      scoredAt: new Date().toISOString(),
      processed: true
    };
  } catch (error) {
    console.error(`Error scoring lead ${lead.id}:`, error.message);
    return {
      ...lead,
      score: 'COLD',
      why: `Scoring error: ${error.message}`,
      signals: lead.signals || [],
      scoredAt: new Date().toISOString(),
      processed: true
    };
  }
}

/**
 * Score all pending leads
 */
async function scorePendingLeads(options = {}) {
  const { limit = 50, minScore = config.minScore } = options;
  
  console.log('🎯 Starting lead scoring...');
  
  // Get pending leads from DB
  const pendingLeads = db.getAllLeads()
    .filter(l => !l.processed || l.score === 'PENDING')
    .slice(0, limit);

  if (pendingLeads.length === 0) {
    console.log('  No pending leads to score.');
    return { scored: 0, results: [] };
  }

  console.log(`  Found ${pendingLeads.length} pending leads`);

  const results = [];
  let hotCount = 0;
  let warmCount = 0;
  let coldCount = 0;

  for (let i = 0; i < pendingLeads.length; i++) {
    const lead = pendingLeads[i];
    console.log(`  [${i + 1}/${pendingLeads.length}] Scoring: ${lead.title.slice(0, 60)}...`);
    
    const scored = await scoreLead(lead);
    
    // Update in DB
    db.updateLead(lead.id, scored);
    
    results.push(scored);
    
    if (scored.score === 'HOT') hotCount++;
    else if (scored.score === 'WARM') warmCount++;
    else coldCount++;

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  // Save scored results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(__dirname, '../leads', `scored_${timestamp}.json`);
  
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, hot: hotCount, warm: warmCount, cold: coldCount },
    leads: results
  }, null, 2));

  console.log('\n✅ Scoring complete!');
  console.log(`📊 Results: ${hotCount} HOT, ${warmCount} WARM, ${coldCount} COLD`);
  console.log(`💾 Saved to: ${outputPath}`);

  // Update web dashboard data
  await updateDashboardData();

  return { scored: results.length, results };
}

/**
 * Update the web dashboard with latest leads
 */
async function updateDashboardData() {
  const webDataPath = path.join(__dirname, '../web/data/leads.json');
  
  // Get all scored leads, sorted by score and date
  const leads = db.getAllLeads()
    .filter(l => l.score && l.score !== 'PENDING')
    .sort((a, b) => {
      const scoreOrder = { HOT: 0, WARM: 1, COLD: 2, SKIP: 3 };
      if (scoreOrder[a.score] !== scoreOrder[b.score]) {
        return scoreOrder[a.score] - scoreOrder[b.score];
      }
      return new Date(b.capturedAt) - new Date(a.capturedAt);
    })
    .map((lead, index) => ({
      id: lead.id,
      source: lead.source,
      geo: lead.geo || 'Unknown',
      score: lead.score,
      title: lead.title,
      summary: lead.why || lead.summary || lead.text?.slice(0, 150),
      url: lead.url,
      author: lead.author,
      recommended_message: lead.recommended_message || lead.first_message,
      signals: lead.signals || [],
      intent: lead.intent,
      capturedAt: lead.capturedAt,
      scoredAt: lead.scoredAt,
      // For freemium display
      _index: index
    }));

  const webData = {
    generatedAt: new Date().toISOString(),
    plan: 'freemium',
    freeLeadCount: 5,
    stats: db.getStats(),
    leads
  };

  fs.writeFileSync(webDataPath, JSON.stringify(webData, null, 2));
  console.log(`📊 Dashboard updated: ${webDataPath}`);
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex > -1 ? parseInt(args[limitIndex + 1]) : 50;

  scorePendingLeads({ limit }).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { scorePendingLeads, scoreLead, updateDashboardData };
