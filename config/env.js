/**
 * Environment configuration loader
 */
const fs = require('fs');
const path = require('path');

// Load .env file if it exists
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      if (!process.env[key]) {
        process.env[key] = value.trim();
      }
    }
  });
}

module.exports = {
  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY,
  
  // Airtable
  airtableApiKey: process.env.AIRTABLE_API_KEY,
  airtableBaseId: process.env.AIRTABLE_BASE_ID,
  airtableTableName: process.env.AIRTABLE_TABLE_NAME || 'Leads',
  
  // Google Sheets
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  googleServiceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
  googleSheetId: process.env.GOOGLE_SHEET_ID,
  
  // Webhooks
  hubspotWebhookUrl: process.env.HUBSPOT_WEBHOOK_URL,
  salesforceWebhookUrl: process.env.SALESFORCE_WEBHOOK_URL,
  customCrmWebhookUrl: process.env.CUSTOM_CRM_WEBHOOK_URL,
  
  // Email
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: parseInt(process.env.SMTP_PORT) || 587,
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  emailFrom: process.env.EMAIL_FROM || 'AI SDR <ai-sdr@example.com>',
  emailTo: process.env.EMAIL_TO,
  
  // Dashboard
  dashboardPassword: process.env.DASHBOARD_PASSWORD || 'admin',
  dashboardPort: parseInt(process.env.DASHBOARD_PORT) || 4010,
  dashboardSessionSecret: process.env.DASHBOARD_SESSION_SECRET || 'change-me-in-production',
  
  // LinkedIn
  linkedinEmail: process.env.LINKEDIN_EMAIL,
  linkedinPassword: process.env.LINKEDIN_PASSWORD,
  
  // Reddit
  redditClientId: process.env.REDDIT_CLIENT_ID,
  redditClientSecret: process.env.REDDIT_CLIENT_SECRET,
  redditUserAgent: process.env.REDDIT_USER_AGENT || 'AI_SDR_Bot/1.0',
  
  // Pipeline
  minScore: process.env.MIN_SCORE || 'WARM',
  maxLeadsPerSource: parseInt(process.env.MAX_LEADS_PER_SOURCE) || 50,
  dedupeEnabled: process.env.DEDUPE_ENABLED !== 'false',
  leadRetentionDays: parseInt(process.env.LEAD_RETENTION_DAYS) || 90,
  
  // Proxy
  httpProxy: process.env.HTTP_PROXY,
  httpsProxy: process.env.HTTPS_PROXY
};
