/**
 * Google Sheets integration for lead export
 */
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const config = require('../config/env');

class GoogleSheetsExporter {
  constructor() {
    this.enabled = !!(config.googleServiceAccountJson || config.googleServiceAccountPath) && 
                   !!config.googleSheetId;
    this.doc = null;
  }

  /**
   * Initialize Google Sheets connection
   */
  async init() {
    if (!this.enabled) {
      throw new Error('Google Sheets not configured');
    }

    try {
      let credentials;
      
      if (config.googleServiceAccountJson) {
        credentials = JSON.parse(config.googleServiceAccountJson);
      } else if (config.googleServiceAccountPath) {
        const fs = require('fs');
        credentials = JSON.parse(fs.readFileSync(config.googleServiceAccountPath, 'utf8'));
      }

      const serviceAccountAuth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.doc = new GoogleSpreadsheet(config.googleSheetId, serviceAccountAuth);
      await this.doc.loadInfo();
      
      return true;
    } catch (error) {
      console.error('Google Sheets init error:', error.message);
      throw error;
    }
  }

  /**
   * Check if Google Sheets is configured
   */
  isConfigured() {
    return this.enabled;
  }

  /**
   * Ensure the sheet has the right headers
   */
  async ensureHeaders(sheet) {
    const headers = [
      'ID', 'Source', 'Score', 'Title', 'Summary', 'URL', 'Author', 'Geo',
      'Intent', 'Signals', 'Recommended Message', 'Budget Hint', 'Timeline Hint',
      'Niche', 'Why', 'Captured At', 'Exported At'
    ];

    await sheet.setHeaderRow(headers);
    return headers;
  }

  /**
   * Export leads to Google Sheets
   */
  async exportLeads(leads, sheetName = 'Leads') {
    if (!this.enabled) {
      throw new Error('Google Sheets not configured');
    }

    if (!this.doc) {
      await this.init();
    }

    try {
      // Get or create sheet
      let sheet = this.doc.sheetsByTitle[sheetName];
      if (!sheet) {
        sheet = await this.doc.addSheet({ title: sheetName });
        await this.ensureHeaders(sheet);
      }

      // Map leads to rows
      const rows = leads.map(lead => ({
        'ID': lead.id,
        'Source': lead.source,
        'Score': lead.score,
        'Title': lead.title,
        'Summary': lead.summary,
        'URL': lead.url,
        'Author': lead.author,
        'Geo': lead.geo || 'Unknown',
        'Intent': lead.intent || 'unknown',
        'Signals': (lead.signals || []).join(', '),
        'Recommended Message': lead.recommended_message || lead.first_message,
        'Budget Hint': lead.budget_hint || (lead.extracted && lead.extracted.budget_hint),
        'Timeline Hint': lead.timeline_hint || (lead.extracted && lead.extracted.timeline_hint),
        'Niche': lead.niche || (lead.extracted && lead.extracted.niche),
        'Why': lead.why,
        'Captured At': lead.capturedAt,
        'Exported At': new Date().toISOString()
      }));

      // Add rows in batches
      const batchSize = 100;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        await sheet.addRows(batch);
      }

      return { success: true, count: rows.length };
    } catch (error) {
      console.error('Google Sheets export error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Export a single lead
   */
  async exportLead(lead, sheetName = 'Leads') {
    const result = await this.exportLeads([lead], sheetName);
    return result;
  }

  /**
   * Get existing lead IDs from sheet
   */
  async getExistingIds(sheetName = 'Leads') {
    if (!this.enabled || !this.doc) {
      return new Set();
    }

    try {
      const sheet = this.doc.sheetsByTitle[sheetName];
      if (!sheet) return new Set();

      const rows = await sheet.getRows();
      const ids = new Set(rows.map(r => r.get('ID')).filter(Boolean));
      return ids;
    } catch (error) {
      console.error('Google Sheets get IDs error:', error.message);
      return new Set();
    }
  }
}

module.exports = { GoogleSheetsExporter };
