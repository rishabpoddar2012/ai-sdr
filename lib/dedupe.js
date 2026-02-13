/**
 * Deduplication logic for leads
 */
const crypto = require('crypto');

class Deduplicator {
  constructor(options = {}) {
    this.similarityThreshold = options.similarityThreshold || 0.85;
    this.titleThreshold = options.titleThreshold || 0.9;
  }

  /**
   * Generate a unique ID for a lead based on its content
   */
  generateId(lead) {
    const content = `${lead.source}:${lead.url || ''}:${lead.title || lead.text || ''}`;
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Calculate Jaccard similarity between two strings
   */
  jaccardSimilarity(str1, str2) {
    const set1 = new Set(this.tokenize(str1));
    const set2 = new Set(this.tokenize(str2));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
  }

  /**
   * Simple tokenization
   */
  tokenize(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  /**
   * Check if two leads are duplicates
   */
  isDuplicate(lead1, lead2) {
    // Same URL = definitely duplicate
    if (lead1.url && lead2.url && lead1.url === lead2.url) {
      return true;
    }

    // Same source + similar title
    if (lead1.source === lead2.source) {
      const titleSim = this.jaccardSimilarity(lead1.title, lead2.title);
      if (titleSim >= this.titleThreshold) {
        return true;
      }
    }

    // Similar content overall
    const content1 = `${lead1.title || ''} ${lead1.text || ''}`;
    const content2 = `${lead2.title || ''} ${lead2.text || ''}`;
    const similarity = this.jaccardSimilarity(content1, content2);
    
    return similarity >= this.similarityThreshold;
  }

  /**
   * Deduplicate a list of leads
   * Returns { unique: [], duplicates: [] }
   */
  dedupe(leads) {
    const unique = [];
    const duplicates = [];

    for (const lead of leads) {
      // Generate ID if not present
      if (!lead.id) {
        lead.id = this.generateId(lead);
      }

      // Check against existing unique leads
      let isDup = false;
      for (const existing of unique) {
        if (this.isDuplicate(lead, existing)) {
          isDup = true;
          duplicates.push({ ...lead, duplicateOf: existing.id });
          break;
        }
      }

      if (!isDup) {
        unique.push(lead);
      }
    }

    return { unique, duplicates };
  }

  /**
   * Check if a lead already exists in the database
   */
  async checkExisting(lead, db) {
    const existing = db.getLeadById(lead.id);
    if (existing) {
      return { exists: true, lead: existing };
    }

    // Also check for similar leads
    const allLeads = db.getAllLeads();
    for (const existing of allLeads) {
      if (this.isDuplicate(lead, existing)) {
        return { exists: true, lead: existing, similar: true };
      }
    }

    return { exists: false };
  }
}

module.exports = { Deduplicator };
