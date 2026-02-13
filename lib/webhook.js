/**
 * Webhook integration for CRMs (HubSpot, Salesforce, etc.)
 */
const config = require('../config/env');

class WebhookSender {
  constructor() {
    this.webhooks = {
      hubspot: config.hubspotWebhookUrl,
      salesforce: config.salesforceWebhookUrl,
      custom: config.customCrmWebhookUrl
    };
  }

  /**
   * Check if any webhooks are configured
   */
  hasWebhooks() {
    return Object.values(this.webhooks).some(url => !!url);
  }

  /**
   * Check if a specific webhook is configured
   */
  isConfigured(target) {
    return !!this.webhooks[target.toLowerCase()];
  }

  /**
   * Send lead to webhook
   */
  async sendLead(lead, target = 'custom') {
    const url = this.webhooks[target.toLowerCase()];
    
    if (!url) {
      throw new Error(`Webhook not configured for target: ${target}`);
    }

    const payload = this.formatPayload(lead, target);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AI-SDR/1.0'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      return { 
        success: true, 
        target,
        status: response.status 
      };
    } catch (error) {
      console.error(`Webhook send error (${target}):`, error.message);
      return { 
        success: false, 
        target,
        error: error.message 
      };
    }
  }

  /**
   * Send multiple leads to webhook
   */
  async sendLeads(leads, target = 'custom') {
    const results = [];
    
    for (const lead of leads) {
      const result = await this.sendLead(lead, target);
      results.push(result);
      
      // Small delay to avoid rate limiting
      if (leads.length > 1) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    return results;
  }

  /**
   * Format lead payload for different CRMs
   */
  formatPayload(lead, target) {
    const basePayload = {
      id: lead.id,
      source: lead.source,
      score: lead.score,
      title: lead.title,
      description: lead.text || lead.summary,
      url: lead.url,
      author: lead.author,
      geo: lead.geo,
      intent: lead.intent,
      signals: lead.signals || [],
      recommended_message: lead.recommended_message || lead.first_message,
      budget_hint: lead.budget_hint || (lead.extracted && lead.extracted.budget_hint),
      timeline_hint: lead.timeline_hint || (lead.extracted && lead.extracted.timeline_hint),
      niche: lead.niche || (lead.extracted && lead.extracted.niche),
      captured_at: lead.capturedAt,
      raw_data: lead.raw || {}
    };

    // Format for specific CRMs
    switch (target.toLowerCase()) {
      case 'hubspot':
        return this.formatHubSpotPayload(basePayload);
      case 'salesforce':
        return this.formatSalesforcePayload(basePayload);
      default:
        return basePayload;
    }
  }

  /**
   * Format for HubSpot
   */
  formatHubSpotPayload(payload) {
    return {
      properties: {
        company: payload.title,
        website: payload.url,
        description: payload.description,
        source: payload.source,
        hs_lead_status: this.mapScoreToStatus(payload.score),
        country: payload.geo,
        message: payload.recommended_message
      },
      context: {
        source: 'AI_SDR',
        sourceId: payload.id
      }
    };
  }

  /**
   * Format for Salesforce
   */
  formatSalesforcePayload(payload) {
    return {
      Name: payload.title,
        Description: payload.description,
        LeadSource: payload.source,
        Status: this.mapScoreToStatus(payload.score),
        Country: payload.geo,
        Website: payload.url
    };
  }

  /**
   * Map score to CRM status
   */
  mapScoreToStatus(score) {
    const mapping = {
      'HOT': 'New',
      'WARM': 'Working',
      'COLD': 'Nurturing',
      'SKIP': 'Unqualified'
    };
    return mapping[score] || 'New';
  }

  /**
   * Broadcast to all configured webhooks
   */
  async broadcast(lead) {
    const results = {};
    
    for (const [target, url] of Object.entries(this.webhooks)) {
      if (url) {
        results[target] = await this.sendLead(lead, target);
      }
    }

    return results;
  }
}

module.exports = { WebhookSender };
