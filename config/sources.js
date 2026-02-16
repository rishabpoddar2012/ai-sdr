/**
 * Source configurations for AI SDR
 */

module.exports = {
  // Hacker News configuration
  hackernews: {
    enabled: true,
    queries: [
      'looking for marketing agency',
      'need help with google ads',
      'need help with meta ads',
      'need help with facebook ads',
      'recommend performance marketing agency',
      'paid media freelancer',
      'looking for growth agency',
      'hire ppc specialist',
      'facebook ads manager needed',
      'google ads specialist',
      'shopify marketing help',
      'ecommerce marketing agency'
    ],
    maxResults: 25,
    buyerIntentPatterns: [
      /looking for/i,
      /need help/i,
      /recommend/i,
      /seeking/i,
      /searching for/i,
      /hire/i,
      /hiring/i
    ]
  },

  // Reddit configuration
  reddit: {
    enabled: true,
    subreddits: ['forhire', 'startups', 'marketing', 'smallbusiness', 'ecommerce', 'shopify', 'PPC'],
    keywords: [
      'hiring',
      'looking for',
      'need a',
      'need help',
      'searching for',
      'seeking',
      'facebook ads',
      'google ads',
      'meta ads',
      'ppc',
      'performance marketing',
      'marketing agency',
      'growth marketing'
    ],
    maxResultsPerSubreddit: 50,
    minScore: 1,
    timeWindow: 'day' // 'hour', 'day', 'week', 'month', 'year', 'all'
  },

  // Upwork configuration
  upwork: {
    enabled: true,
    keywords: [
      'facebook ads',
      'meta ads',
      'google ads',
      'ppc',
      'performance marketing',
      'shopify roas',
      'google adwords',
      'paid media',
      'media buyer'
    ],
    useRSS: true, // Use RSS feeds instead of scraping
    rssFeedUrl: 'https://www.upwork.com/ab/feed/jobs/rss',
    maxResults: 50
  },

  // LinkedIn configuration
  linkedin: {
    enabled: false, // Requires credentials
    searchQueries: [
      'looking for marketing agency',
      'need facebook ads help',
      'hiring ppc specialist'
    ],
    maxResults: 30,
    headless: true
  },

  // IndiaMART configuration
  indiamart: {
    enabled: true,
    queries: [
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
    ],
    maxPages: 2,
    minResults: 5
  },

  // GitHub Jobs configuration
  githubJobs: {
    enabled: true,
    maxIssues: 100,
    filterGrowthOnly: true,
    minScore: 40,
    growthKeywords: [
      'marketing', 'growth', 'sales', 'demand generation', 'lead generation',
      'performance marketing', 'digital marketing', 'seo', 'sem', 'ppc',
      'facebook ads', 'meta ads', 'google ads', 'linkedin ads'
    ]
  },

  // Twitter/X configuration
  twitter: {
    enabled: true,
    bearerToken: process.env.X_BEARER_TOKEN,
    queries: [
      'looking for agency',
      'hiring marketing',
      'need marketing help',
      'looking for freelancer',
      'need leads',
      'looking for growth',
      'hire ppc',
      'need facebook ads',
      'need google ads',
      'looking for seo'
    ],
    maxResultsPerQuery: 25,
    filterNegative: true,
    minScore: 35
  },

  // AngelList/Wellfound configuration
  angellist: {
    enabled: true,
    useMock: false,
    maxJobs: 50,
    minScore: 45,
    fundingStages: ['seed', 'series a', 'series b', 'series c', 'recently funded']
  },

  // TradeIndia configuration
  tradeindia: {
    enabled: true,
    useMock: false,
    categories: [
      'packaging-materials',
      'textile-machinery',
      'industrial-machinery',
      'chemicals',
      'automotive-parts'
    ],
    maxListings: 50,
    minScore: 40
  },

  // Scoring configuration
  scoring: {
    model: 'gpt-4o-mini',
    temperature: 0.2,
    categories: ['HOT', 'WARM', 'COLD'],
    minBudgetSignals: [
      'budget',
      'spend',
      'investment',
      '$',
      'k',
      'monthly',
      'ad spend',
      '50k', '100k', '10k',
      'lac', 'lakh', 'crore'
    ],
    urgencySignals: [
      'asap',
      'urgent',
      'immediately',
      'this week',
      'right now',
      'start soon',
      'quickly',
      'today'
    ],
    techStackKeywords: [
      'facebook ads',
      'meta ads',
      'google ads',
      'adwords',
      'ppc',
      'shopify',
      'woocommerce',
      'klaviyo',
      'google analytics',
      'ga4'
    ],
    intentPatterns: [
      /looking for/i,
      /need help/i,
      /recommend/i,
      /seeking/i,
      /searching for/i,
      /hire/i,
      /hiring/i,
      /want to/i
    ]
  }
};
