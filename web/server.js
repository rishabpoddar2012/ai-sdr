/**
 * Web Dashboard Server
 * Express server with authentication and API endpoints
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const config = require('../config/env');
const { getInstance: getDb } = require('../lib/db');
const { AirtableExporter } = require('../lib/airtable');
const { GoogleSheetsExporter } = require('../lib/google_sheets');

const app = express();
const db = getDb();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: config.dashboardSessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session.authenticated) {
    return next();
  }
  res.redirect('/login');
}

// Static files (only for authenticated users)
app.use('/static', requireAuth, express.static(path.join(__dirname, 'public')));

// Routes

// Login page
app.get('/login', (req, res) => {
  if (req.session.authenticated) {
    return res.redirect('/');
  }
  
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>AI SDR - Login</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  </style>
</head>
<body>
  <div class="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md">
    <div class="text-center mb-8">
      <div class="h-16 w-16 bg-gradient-to-br from-emerald-400 to-sky-400 rounded-2xl mx-auto mb-4 flex items-center justify-center">
        <span class="text-2xl font-bold text-white">AI</span>
      </div>
      <h1 class="text-2xl font-bold text-gray-800">AI SDR Dashboard</h1>
      <p class="text-gray-500">Sign in to view your leads</p>
    </div>
    
    <form method="POST" action="/login">
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
        <input 
          type="password" 
          name="password" 
          required
          class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          placeholder="Enter password"
        >
      </div>
      
      ${req.query.error ? `
        <div class="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
          Invalid password. Please try again.
        </div>
      ` : ''}
      
      <button 
        type="submit"
        class="w-full bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 transition font-medium"
      >
        Sign In
      </button>
    </form>
  </div>
</body>
</html>
  `);
});

// Login POST
app.post('/login', (req, res) => {
  const { password } = req.body;
  
  if (password === config.dashboardPassword) {
    req.session.authenticated = true;
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Main dashboard (serve the HTML file)
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes

// Get all leads with optional filtering
app.get('/api/leads', requireAuth, (req, res) => {
  try {
    const { 
      source, 
      score, 
      geo, 
      search,
      limit = 100,
      offset = 0
    } = req.query;

    let leads = db.getAllLeads();

    // Apply filters
    if (source) {
      leads = leads.filter(l => l.source === source);
    }
    if (score) {
      leads = leads.filter(l => l.score === score);
    }
    if (geo) {
      leads = leads.filter(l => l.geo === geo);
    }
    if (search) {
      const q = search.toLowerCase();
      leads = leads.filter(l => 
        (l.title && l.title.toLowerCase().includes(q)) ||
        (l.text && l.text.toLowerCase().includes(q)) ||
        (l.author && l.author.toLowerCase().includes(q))
      );
    }

    // Sort by score priority and date
    const scoreOrder = { HOT: 0, WARM: 1, COLD: 2, SKIP: 3, PENDING: 4 };
    leads.sort((a, b) => {
      if (scoreOrder[a.score] !== scoreOrder[b.score]) {
        return scoreOrder[a.score] - scoreOrder[b.score];
      }
      return new Date(b.capturedAt) - new Date(a.capturedAt);
    });

    // Get total count before pagination
    const total = leads.length;

    // Apply pagination
    leads = leads.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    // Transform for API response
    const transformed = leads.map(lead => ({
      id: lead.id,
      source: lead.source,
      score: lead.score,
      geo: lead.geo || 'Unknown',
      title: lead.title,
      summary: lead.why || lead.summary || lead.text?.slice(0, 200),
      text: lead.text,
      url: lead.url,
      author: lead.author,
      signals: lead.signals || [],
      recommended_message: lead.recommended_message || lead.first_message,
      intent: lead.intent,
      capturedAt: lead.capturedAt,
      scoredAt: lead.scoredAt,
      enrichedAt: lead.enrichedAt,
      exportedAt: lead.exportedAt,
      tags: lead.tags || [],
      engagementScore: lead.engagementScore,
      priorityScore: lead.priorityScore
    }));

    res.json({
      success: true,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      leads: transformed,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single lead
app.get('/api/leads/:id', requireAuth, (req, res) => {
  try {
    const lead = db.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    res.json({ success: true, lead });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get dashboard stats
app.get('/api/stats', requireAuth, (req, res) => {
  try {
    const stats = db.getStats();
    res.json({ 
      success: true, 
      stats,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export lead to specific target
app.post('/api/leads/:id/export', requireAuth, async (req, res) => {
  try {
    const { target } = req.body;
    const lead = db.getLeadById(req.params.id);
    
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    let result;

    switch (target) {
      case 'airtable':
        const airtable = new AirtableExporter();
        result = await airtable.exportLead(lead);
        break;
      case 'sheets':
        const sheets = new GoogleSheetsExporter();
        result = await sheets.exportLead(lead);
        break;
      default:
        return res.status(400).json({ success: false, error: 'Unknown target' });
    }

    if (result.success) {
      db.updateLead(lead.id, {
        exportedAt: new Date().toISOString(),
        exportTargets: [...(lead.exportTargets || []), target]
      });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk export
app.post('/api/export', requireAuth, async (req, res) => {
  try {
    const { target, leadIds } = req.body;
    
    const leads = leadIds 
      ? leadIds.map(id => db.getLeadById(id)).filter(Boolean)
      : db.getAllLeads().filter(l => l.score === 'HOT' || l.score === 'WARM');

    let results;
    const { exportToAirtable, exportToSheets, exportToWebhooks } = require('../pipeline/exporter');

    switch (target) {
      case 'airtable':
        results = await exportToAirtable(leads);
        break;
      case 'sheets':
        results = await exportToSheets(leads);
        break;
      case 'webhook':
        results = await exportToWebhooks(leads);
        break;
      default:
        return res.status(400).json({ success: false, error: 'Unknown target' });
    }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get available sources and filters
app.get('/api/filters', requireAuth, (req, res) => {
  const leads = db.getAllLeads();
  
  const sources = [...new Set(leads.map(l => l.source))];
  const scores = [...new Set(leads.map(l => l.score))].filter(Boolean);
  const geos = [...new Set(leads.map(l => l.geo))].filter(Boolean);

  res.json({
    success: true,
    filters: {
      sources,
      scores,
      geos
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    stats: db.getStats()
  });
});

// Start server
const PORT = config.dashboardPort;
app.listen(PORT, () => {
  console.log(`╔════════════════════════════════════════╗`);
  console.log(`║     AI SDR Dashboard Running           ║`);
  console.log(`╚════════════════════════════════════════╝`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`Press Ctrl+C to stop`);
});

module.exports = app;
