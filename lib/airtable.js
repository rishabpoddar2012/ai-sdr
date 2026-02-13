/**
 * Airtable integration for lead export
 */
const Airtable = require('airtable');
const config = require('../config/env');

class AirtableExporter {
  constructor() {
    this.enabled = !!(config.airtableApiKey && config.airtableBaseId);
    
    if (this.enabled) {
      this.base = new Airtable({ apiKey: config.airtableApiKey }).base(config.airtableBaseId);
      this.tableName = config.airtableTableName;
    }
  }

  /**
   * Check if Airtable is configured
   */
  isConfigured() {
    return this.enabled;
  }

  /**
   * Export a single lead to Airtable
   */
  async exportLead(lead) {
    if (!this.enabled) {
      throw new Error('Airtable not configured');
    }

    const fields = this.mapLeadToFields(lead);

    try {
      const records = await this.base(this.tableName).create([{ fields }]);
      return { success: true, recordId: records[0].getId() };
    } catch (error) {
      console.error('Airtable export error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Export multiple leads to Airtable
   */
  async exportLeads(leads) {
    if (!this.enabled) {
      throw new Error('Airtable not configured');
    }

    const results = [];
    
    // Airtable has a limit of 10 records per batch
    const batchSize = 10;
    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);
      const records = batch.map(lead => ({ fields: this.mapLeadToFields(lead) }));

      try {
        const created = await this.base(this.tableName).create(records);
        results.push(...created.map(r => ({ success: true, recordId: r.getId() })));
      } catch (error) {
        console.error('Airtable batch export error:', error.message);
        results.push(...batch.map(() => ({ success: false, error: error.message })));
      }
    }

    return results;
  }

  /**
   * Map lead object to Airtable fields
   */
  mapLeadToFields(lead) {
    return {
      'ID': lead.id,
      'Source': lead.source,
      'Score': lead.score,
      'Title': lead.title,
      'Text': lead.text,
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
      'Exported At': new Date().toISOString(),
      'Raw Data': JSON.stringify(lead.raw || {})
    };
  }

  /**
   * Check if a lead already exists in Airtable
   */
  async leadExists(leadId) {
    if (!this.enabled) return false;

    try {
      const records = await this.base(this.tableName)
        .select({ filterByFormula: `{ID} = '${leadId}'`, maxRecords: 1 })
        .firstPage();
      return records.length > 0;
    } catch (error) {
      console.error('Airtable check error:', error.message);
      return false;
    }
  }
}

module.exports = { AirtableExporter };
