# AI Sales Development Rep (AI SDR)

An automated lead generation and qualification system for performance marketing agencies. Collects high-intent opportunities from multiple sources, scores them with OpenAI, and delivers actionable leads.

## Features

- **Multi-Source Lead Collection**: Hacker News, Reddit (r/forhire, r/startups), Upwork, LinkedIn
- **AI-Powered Lead Scoring**: OpenAI GPT-based qualification (Hot/Warm/Cold)
- **Data Pipeline**: Collect → Score → Enrich → Publish with deduplication
- **Integrations**: Airtable, Google Sheets, HubSpot/Salesforce webhooks
- **Web Dashboard**: Filterable lead viewer with export capabilities
- **Daily Email Summaries**: Automated digest of new qualified leads

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your API keys:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# OpenAI (Required)
OPENAI_API_KEY=sk-...

# Airtable (Optional)
AIRTABLE_API_KEY=key...
AIRTABLE_BASE_ID=app...
AIRTABLE_TABLE_NAME=Leads

# Google Sheets (Optional)
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_SHEET_ID=...

# CRM Webhooks (Optional)
HUBSPOT_WEBHOOK_URL=https://...
SALESFORCE_WEBHOOK_URL=https://...

# Email (Optional - for daily summaries)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_TO=recipient@example.com

# Dashboard Auth
DASHBOARD_PASSWORD=your-secure-password
DASHBOARD_PORT=4010

# LinkedIn (Optional - for LinkedIn scraping)
LINKEDIN_EMAIL=your-linkedin-email
LINKEDIN_PASSWORD=your-linkedin-password
```

### 3. Run the Pipeline

**Collect leads from all sources:**
```bash
npm run collect:all
```

**Or run individual collectors:**
```bash
npm run collect:hn       # Hacker News
npm run collect:reddit   # Reddit r/forhire, r/startups
npm run collect:upwork   # Upwork (uses RSS fallback)
npm run collect:linkedin # LinkedIn (requires credentials)
```

**Score and process leads:**
```bash
npm run score
```

**Export to integrations:**
```bash
npm run export:airtable
npm run export:sheets
npm run export:webhook
```

**Send daily email summary:**
```bash
npm run email
```

**Run full pipeline (collect + score + export):**
```bash
npm run pipeline
```

### 4. Start the Web Dashboard

```bash
npm run dashboard
```

Then open http://localhost:4010

Default password: `admin` (change in .env)

## Project Structure

```
ai_sdr/
├── config/
│   └── sources.js          # Source configurations
├── lib/
│   ├── openai_client.js    # OpenAI API wrapper
│   ├── airtable.js         # Airtable integration
│   ├── google_sheets.js    # Google Sheets integration
│   ├── webhook.js          # CRM webhook sender
│   ├── email.js            # Email digest sender
│   ├── dedupe.js           # Deduplication logic
│   └── db.js               # JSON database wrapper
├── pipeline/
│   ├── collector.js        # Main collection orchestrator
│   ├── scorer.js           # OpenAI lead scoring
│   ├── enricher.js         # Lead enrichment
│   └── exporter.js         # Export orchestrator
├── sources/
│   ├── hn_intent.js        # Hacker News scraper
│   ├── reddit_jobs.js      # Reddit job boards
│   ├── upwork_rss.js       # Upwork RSS feeds
│   └── linkedin_scraper.js # LinkedIn scraper
├── web/
│   ├── server.js           # Express server
│   ├── auth.js             # Authentication middleware
│   ├── public/
│   │   └── index.html      # Dashboard UI
│   └── data/
│       └── leads.json      # Processed leads
├── leads/                  # Raw and processed lead storage
├── tests/
│   └── pipeline.test.js    # Pipeline tests
├── .env.example            # Environment template
├── docker-compose.yml      # Docker setup
├── Dockerfile              # Container definition
├── cron.sh                 # Cron job script
└── package.json
```

## Deployment

### Docker Deployment

```bash
docker-compose up -d
```

### Cron Job (Daily at 9 AM)

Add to crontab:
```bash
0 9 * * * /home/ubuntu/clawd/ai_sdr/cron.sh >> /var/log/ai_sdr.log 2>&1
```

Or use the provided script:
```bash
./scripts/setup-cron.sh
```

### PM2 Deployment

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## Lead Scoring Criteria

Leads are scored based on:

- **Budget Signals**: Mentions of budget, spend, investment
- **Urgency**: Timeline words (ASAP, urgent, immediate)
- **Tech Stack Fit**: Meta Ads, Google Ads, Shopify mentions
- **Company Size**: Startup, SMB, Enterprise indicators
- **Intent Clarity**: Clear ask vs vague inquiry

**Score Classifications:**
- **HOT**: Clear buying intent + reasonable budget/urgency/clarity
- **WARM**: Some intent but missing key details
- **COLD**: Low quality, vague, or not relevant

## API Endpoints

The dashboard server exposes these endpoints:

- `GET /api/leads` - List all leads (supports filtering)
- `GET /api/leads/:id` - Get specific lead
- `POST /api/leads/:id/export` - Trigger export for a lead
- `GET /health` - Health check

## Development

### Running Tests

```bash
npm test
```

### Adding a New Source

1. Create a new file in `sources/`
2. Export a function that returns standardized lead objects
3. Add the source to `config/sources.js`
4. Register in `pipeline/collector.js`

Example lead object:
```javascript
{
  id: "unique-id",
  source: "source_name",
  title: "Lead title",
  text: "Full description",
  url: "https://...",
  author: "username",
  createdAt: "2024-01-01T00:00:00Z",
  signals: ["keyword1", "keyword2"],
  raw: { /* original data */ }
}
```

## Troubleshooting

**OpenAI API errors**: Check your API key and rate limits
**LinkedIn blocked**: Use residential proxies or reduce frequency
**Upwork 403**: Normal - use RSS feeds instead
**Dashboard not loading**: Check if port 4010 is available

## License

MIT
