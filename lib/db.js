/**
 * JSON Database wrapper for lead storage
 */
const fs = require('fs');
const path = require('path');

const DB_DIR = path.resolve(__dirname, '..', 'leads');
const DB_FILE = path.join(DB_DIR, 'leads_db.json');

// Ensure directories exist
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

class Database {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      }
    } catch (e) {
      console.error('Error loading database:', e.message);
    }
    return { leads: [], lastUpdated: new Date().toISOString() };
  }

  save() {
    this.data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2));
  }

  getAllLeads() {
    return this.data.leads;
  }

  getLeadById(id) {
    return this.data.leads.find(l => l.id === id);
  }

  getLeadsBySource(source) {
    return this.data.leads.filter(l => l.source === source);
  }

  getLeadsByScore(score) {
    return this.data.leads.filter(l => l.score === score);
  }

  getRecentLeads(hours = 24) {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.data.leads.filter(l => new Date(l.capturedAt) > cutoff);
  }

  addLead(lead) {
    // Check if lead already exists
    const existing = this.getLeadById(lead.id);
    if (existing) {
      // Merge/update existing
      Object.assign(existing, lead, { updatedAt: new Date().toISOString() });
      this.save();
      return { added: false, lead: existing };
    }

    // Add new lead
    this.data.leads.push({
      ...lead,
      capturedAt: lead.capturedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    this.save();
    return { added: true, lead };
  }

  updateLead(id, updates) {
    const lead = this.getLeadById(id);
    if (lead) {
      Object.assign(lead, updates, { updatedAt: new Date().toISOString() });
      this.save();
      return lead;
    }
    return null;
  }

  deleteLead(id) {
    const index = this.data.leads.findIndex(l => l.id === id);
    if (index > -1) {
      this.data.leads.splice(index, 1);
      this.save();
      return true;
    }
    return false;
  }

  cleanupOldLeads(days) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const before = this.data.leads.length;
    this.data.leads = this.data.leads.filter(l => new Date(l.capturedAt) > cutoff);
    const removed = before - this.data.leads.length;
    if (removed > 0) {
      this.save();
    }
    return removed;
  }

  getStats() {
    const leads = this.data.leads;
    return {
      total: leads.length,
      bySource: leads.reduce((acc, l) => {
        acc[l.source] = (acc[l.source] || 0) + 1;
        return acc;
      }, {}),
      byScore: leads.reduce((acc, l) => {
        acc[l.score] = (acc[l.score] || 0) + 1;
        return acc;
      }, {}),
      last24h: this.getRecentLeads(24).length,
      last7d: this.getRecentLeads(24 * 7).length
    };
  }

  searchLeads(query) {
    const q = query.toLowerCase();
    return this.data.leads.filter(l => 
      (l.title && l.title.toLowerCase().includes(q)) ||
      (l.text && l.text.toLowerCase().includes(q)) ||
      (l.summary && l.summary.toLowerCase().includes(q))
    );
  }

  exportToJSON() {
    return JSON.stringify(this.data, null, 2);
  }
}

// Singleton instance
let instance = null;
module.exports = {
  Database,
  getInstance: () => {
    if (!instance) {
      instance = new Database();
    }
    return instance;
  }
};
