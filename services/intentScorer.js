/**
 * Intent Scoring Service
 * Advanced lead scoring with budget detection, urgency detection, and competitive intelligence
 * This is what sets us apart from Apollo.io
 */

const { OpenAI } = require('openai');

// Initialize OpenAI if API key available
const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Intent patterns (regex-based fast scoring)
const INTENT_PATTERNS = {
  // Budget detection patterns
  budget: {
    high: [
      /\$\d{2,3},?\d{3}\s*[-+]?\s*\/?\s*(month|mo|mth)/i,
      /\$\d{2,3}k\s*[-+]?\s*(month|mo|mth)/i,
      /\$\d+\s*million/i,
      /budget\s*(of\s*)?\$\d{2,6}/i,
      /\d{2,3}\s*lakh/i,
      /\d+\s*crore/i,
      /\$50k|\$100k|\$200k|\$500k/i
    ],
    medium: [
      /\$\d{1,2},?\d{3}\s*[-+]?\s*(month|mo|mth)/i,
      /\$\d{1,2}k\s*[-+]?\s*(month|mo|mth)/i,
      /budget\s*(of\s*)?\$\d{1,4}/i,
      /\d+\s*lakh/i,
      /\$10k|\$20k|\$30k|\$40k/i
    ],
    low: [
      /\$\d{3,4}\s*(month|mo|mth)/i,
      /\$\d{1,3}k/i,
      /small budget/i,
      /limited budget/i
    ]
  },
  
  // Urgency detection patterns
  urgency: {
    critical: [
      /asap/i,
      /urgent/i,
      /immediately/i,
      /right now/i,
      /emergency/i,
      /today/i,
      /this morning/i
    ],
    high: [
      /this week/i,
      /by friday/i,
      /end of week/i,
      /within \d+ days/i,
      /starting (soon|immediately)/i
    ],
    medium: [
      /next week/i,
      /this month/i,
      /within (2|two) weeks/i,
      /in a (fortnight|couple weeks)/i
    ]
  },
  
  // Hiring intent patterns
  hiring: {
    active: [
      /hiring/i,
      /looking to hire/i,
      /seeking.*\b(for|to)\b/i,
      /recruiting/i
    ],
    passive: [
      /might be looking/i,
      /considering/i,
      /exploring options/i,
      /open to/i
    ]
  },
  
  // Service-specific patterns
  services: {
    facebookAds: [/\bfacebook ads?\b/i, /\bmeta ads?\b/i, /\bfb ads?\b/i, /\binstagram ads?\b/i],
    googleAds: [/\bgoogle ads?\b/i, /\badwords\b/i, /\bgoogle adwords\b/i, /\bsearch ads?\b/i],
    ppc: [/\bppc\b/i, /\bpaid search\b/i, /\bsearch marketing\b/i, /\bsem\b/i],
    seo: [/\bseo\b/i, /\bsearch engine optimization\b/i, /\borganic search\b/i],
    content: [/\bcontent marketing\b/i, /\bblog\b/i, /\bcontent strategy\b/i],
    email: [/\bemail marketing\b/i, /\bklaviyo\b/i, /\bmailchimp\b/i, /\bnurture\b/i],
    cro: [/\bcro\b/i, /\bconversion rate\b/i, /\blanding page\b/i, /\bab test\b/i],
    analytics: [/\banalytics\b/i, /\bgoogle analytics\b/i, /\bga4\b/i, /\bdata\b/i],
    shopify: [/\bshopify\b/i, /\be-?commerce\b/i, /\bonline store\b/i, /\bd2c\b/i]
  },
  
  // Negative patterns (reduce score)
  negative: [
    /not looking/i,
    /already have/i,
    /we use/i,
    /not interested/i,
    /no budget/i,
    /spam/i,
    /promotional/i
  ]
};

// Industry scoring weights
const INDUSTRY_WEIGHTS = {
  'saas': 1.3,
  'software': 1.3,
  'ecommerce': 1.4,
  'fintech': 1.2,
  'healthcare': 1.1,
  'real estate': 1.2,
  'insurance': 1.1,
  'manufacturing': 1.0,
  'agency': 0.8,
  'consulting': 1.0
};

// Company size weights
const SIZE_WEIGHTS = {
  'startup': 1.3,
  'small': 1.0,
  'medium': 1.2,
  'enterprise': 1.4
};

/**
 * Calculate intent score using pattern matching
 */
function calculateIntentScore(lead) {
  const text = `${lead.title || ''} ${lead.text || ''} ${lead.description || ''}`.toLowerCase();
  let score = 50; // Base score
  const signals = [];
  
  // Budget scoring
  let budgetLevel = null;
  for (const [level, patterns] of Object.entries(INTENT_PATTERNS.budget)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        budgetLevel = level;
        signals.push(`Budget: ${level}`);
        break;
      }
    }
    if (budgetLevel) break;
  }
  
  switch (budgetLevel) {
    case 'high': score += 25; break;
    case 'medium': score += 15; break;
    case 'low': score += 5; break;
  }
  
  // Urgency scoring
  let urgencyLevel = null;
  for (const [level, patterns] of Object.entries(INTENT_PATTERNS.urgency)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        urgencyLevel = level;
        signals.push(`Urgency: ${level}`);
        break;
      }
    }
    if (urgencyLevel) break;
  }
  
  switch (urgencyLevel) {
    case 'critical': score += 20; break;
    case 'high': score += 15; break;
    case 'medium': score += 5; break;
  }
  
  // Hiring intent
  for (const [type, patterns] of Object.entries(INTENT_PATTERNS.hiring)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        signals.push(`Hiring: ${type}`);
        score += type === 'active' ? 15 : 5;
        break;
      }
    }
  }
  
  // Service match scoring
  const matchedServices = [];
  for (const [service, patterns] of Object.entries(INTENT_PATTERNS.services)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        matchedServices.push(service);
        signals.push(`Service: ${service}`);
        score += 3;
        break;
      }
    }
  }
  
  // Negative pattern penalty
  for (const pattern of INTENT_PATTERNS.negative) {
    if (pattern.test(text)) {
      signals.push('Negative signal');
      score -= 15;
    }
  }
  
  // Industry weight
  const industry = (lead.industry || '').toLowerCase();
  for (const [ind, weight] of Object.entries(INDUSTRY_WEIGHTS)) {
    if (industry.includes(ind)) {
      score = Math.round(score * weight);
      signals.push(`Industry: ${ind}`);
      break;
    }
  }
  
  // Company size weight
  const size = (lead.companySize || '').toLowerCase();
  for (const [sz, weight] of Object.entries(SIZE_WEIGHTS)) {
    if (size.includes(sz)) {
      score = Math.round(score * weight);
      break;
    }
  }
  
  // Contact info bonus
  if (lead.contactEmail) score += 5;
  if (lead.contactLinkedIn) score += 3;
  if (lead.companyWebsite) score += 2;
  
  return {
    score: Math.max(0, Math.min(100, score)),
    signals: [...new Set(signals)], // Remove duplicates
    matchedServices: [...new Set(matchedServices)],
    budgetLevel,
    urgencyLevel
  };
}

/**
 * Extract budget amount from text
 */
function extractBudget(text) {
  if (!text) return null;
  
  const patterns = [
    // Dollar amounts with k/m suffix
    /\$?(\d+\.?\d*)\s*(k|thousand|m|million)\b/i,
    // Monthly budgets
    /\$?(\d{1,3}(?:,\d{3})+)\s*(?:per|\/)\s*month/i,
    // Range budgets
    /\$?(\d+)-\$?(\d+)\s*(k|thousand)?/i,
    // INR amounts
    /(\d+)\s*(lakh|lac|crore)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let amount = parseFloat(match[1].replace(/,/g, ''));
      const suffix = (match[2] || '').toLowerCase();
      
      if (suffix === 'k' || suffix === 'thousand') amount *= 1000;
      if (suffix === 'm' || suffix === 'million') amount *= 1000000;
      if (suffix === 'lakh' || suffix === 'lac') amount *= 100000;
      if (suffix === 'crore') amount *= 10000000;
      
      return {
        amount,
        currency: text.includes('₹') || /(lakh|lac|crore)/i.test(text) ? 'INR' : 'USD',
        period: text.includes('month') ? 'monthly' : text.includes('year') ? 'yearly' : 'unknown'
      };
    }
  }
  
  return null;
}

/**
 * Detect competition mentions
 */
function detectCompetition(text) {
  if (!text) return [];
  
  const competitors = [
    { name: 'Apollo', pattern: /\bapollo\b/i },
    { name: 'ZoomInfo', pattern: /\bzoominfo\b/i },
    { name: 'Lusha', pattern: /\blusha\b/i },
    { name: 'Cognism', pattern: /\bcognism\b/i },
    { name: 'SEMrush', pattern: /\bsemrush\b/i },
    { name: 'Ahrefs', pattern: /\bahrefs\b/i },
    { name: 'HubSpot', pattern: /\bhubspot\b/i },
    { name: 'Salesforce', pattern: /\bsalesforce\b/i }
  ];
  
  const mentions = [];
  for (const comp of competitors) {
    if (comp.pattern.test(text)) {
      mentions.push(comp.name);
    }
  }
  
  return mentions;
}

/**
 * AI-powered intent analysis (when OpenAI available)
 */
async function analyzeWithAI(lead) {
  if (!openai) {
    return null;
  }
  
  const text = `${lead.title || ''}\n${lead.text || ''}\n${lead.description || ''}`.slice(0, 2000);
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `Analyze this lead for buyer intent. Return ONLY a JSON object with:
            - intentScore: 0-100
            - buyingStage: "awareness" | "consideration" | "decision" | "not interested"
            - servicesNeeded: array of services
            - budgetIndication: "high" | "medium" | "low" | "unknown"
            - urgency: "critical" | "high" | "medium" | "low"
            - keyInsights: array of 2-3 insights`
        },
        {
          role: 'user',
          content: text
        }
      ]
    });
    
    const content = response.choices[0].message.content;
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return null;
  } catch (error) {
    console.error('AI analysis error:', error.message);
    return null;
  }
}

/**
 * Main scoring function
 */
async function scoreLead(lead, options = {}) {
  const { useAI = true, includeCompetition = true } = options;
  
  // Pattern-based scoring (always run)
  const patternResult = calculateIntentScore(lead);
  
  // Extract budget
  const text = `${lead.title || ''} ${lead.text || ''} ${lead.description || ''}`;
  const budget = extractBudget(text);
  
  // Detect competition
  const competition = includeCompetition ? detectCompetition(text) : [];
  
  // AI analysis (optional)
  let aiAnalysis = null;
  if (useAI && openai) {
    aiAnalysis = await analyzeWithAI(lead);
  }
  
  // Combine scores
  let finalScore = patternResult.score;
  if (aiAnalysis?.intentScore) {
    // Weighted average: 70% pattern, 30% AI
    finalScore = Math.round(finalScore * 0.7 + aiAnalysis.intentScore * 0.3);
  }
  
  // Determine category
  let category = 'COLD';
  if (finalScore >= 75) category = 'HOT';
  else if (finalScore >= 55) category = 'WARM';
  
  return {
    score: finalScore,
    category,
    signals: patternResult.signals,
    matchedServices: patternResult.matchedServices,
    budget: budget || { amount: null, currency: 'USD', period: 'unknown' },
    urgency: patternResult.urgencyLevel || aiAnalysis?.urgency || 'unknown',
    buyingStage: aiAnalysis?.buyingStage || 'unknown',
    competition: competition.length > 0 ? competition : null,
    aiInsights: aiAnalysis?.keyInsights || null,
    scoredAt: new Date().toISOString()
  };
}

/**
 * Batch score multiple leads
 */
async function scoreLeads(leads, options = {}) {
  const results = [];
  
  for (const lead of leads) {
    const scored = await scoreLead(lead, options);
    results.push({ ...lead, ...scored });
  }
  
  return results;
}

/**
 * Get scoring explanation for a lead
 */
function getScoringExplanation(lead) {
  const scored = calculateIntentScore(lead);
  
  return {
    totalScore: scored.score,
    breakdown: {
      base: 50,
      budget: scored.budgetLevel === 'high' ? 25 : scored.budgetLevel === 'medium' ? 15 : scored.budgetLevel === 'low' ? 5 : 0,
      urgency: scored.urgencyLevel === 'critical' ? 20 : scored.urgencyLevel === 'high' ? 15 : scored.urgencyLevel === 'medium' ? 5 : 0,
      signals: scored.signals.length * 3
    },
    signals: scored.signals,
    recommendations: [
      scored.score >= 75 ? '🔥 HOT LEAD: Contact immediately' : null,
      scored.score >= 55 ? '⚡ WARM LEAD: Follow up within 24h' : null,
      scored.budgetLevel === 'high' ? '💰 High budget - prioritize' : null,
      scored.urgencyLevel === 'critical' ? '🚨 Urgent need - call now' : null,
      scored.matchedServices.length > 0 ? `✅ Matches: ${scored.matchedServices.join(', ')}` : null
    ].filter(Boolean)
  };
}

module.exports = {
  scoreLead,
  scoreLeads,
  calculateIntentScore,
  extractBudget,
  detectCompetition,
  getScoringExplanation,
  INTENT_PATTERNS
};