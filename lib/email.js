/**
 * Email integration for daily lead digests
 */
const nodemailer = require('nodemailer');
const config = require('../config/env');

class EmailSender {
  constructor() {
    this.enabled = !!(config.smtpUser && config.smtpPass);
    
    if (this.enabled) {
      this.transporter = nodemailer.createTransporter({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpPort === 465,
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass
        }
      });
    }
  }

  /**
   * Check if email is configured
   */
  isConfigured() {
    return this.enabled;
  }

  /**
   * Send daily digest email
   */
  async sendDigest(leads, stats = {}) {
    if (!this.enabled) {
      throw new Error('Email not configured');
    }

    const hotLeads = leads.filter(l => l.score === 'HOT');
    const warmLeads = leads.filter(l => l.score === 'WARM');
    const coldLeads = leads.filter(l => l.score === 'COLD');

    const subject = `AI SDR Daily Digest: ${hotLeads.length} HOT, ${warmLeads.length} WARM leads`;
    
    const html = this.generateDigestHTML({
      hot: hotLeads,
      warm: warmLeads,
      cold: coldLeads,
      stats,
      generatedAt: new Date().toLocaleString()
    });

    try {
      const result = await this.transporter.sendMail({
        from: config.emailFrom,
        to: config.emailTo,
        subject,
        html,
        text: this.generateDigestText({ hot: hotLeads, warm: warmLeads, cold: coldLeads })
      });

      console.log(`Email sent: ${result.messageId}`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('Email send error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate HTML email content
   */
  generateDigestHTML({ hot, warm, cold, stats, generatedAt }) {
    const total = hot.length + warm.length + cold.length;
    
    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px; margin-bottom: 30px; }
    .header h1 { margin: 0; font-size: 28px; }
    .stats { display: flex; gap: 20px; margin-bottom: 30px; }
    .stat-box { flex: 1; background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
    .stat-number { font-size: 36px; font-weight: bold; }
    .stat-label { color: #666; font-size: 14px; }
    .hot { color: #dc3545; }
    .warm { color: #ffc107; }
    .cold { color: #6c757d; }
    .lead-section { margin-bottom: 30px; }
    .lead-section h2 { border-bottom: 2px solid #e9ecef; padding-bottom: 10px; }
    .lead-card { background: white; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; margin-bottom: 15px; }
    .lead-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
    .lead-meta { color: #666; font-size: 14px; margin-bottom: 10px; }
    .lead-text { color: #333; margin-bottom: 10px; }
    .lead-signals { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
    .signal { background: #e9ecef; padding: 3px 10px; border-radius: 12px; font-size: 12px; }
    .lead-link { color: #667eea; text-decoration: none; }
    .lead-link:hover { text-decoration: underline; }
    .message-box { background: #f8f9fa; padding: 15px; border-radius: 4px; font-style: italic; margin-top: 10px; }
    .footer { text-align: center; color: #666; font-size: 14px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e9ecef; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔥 AI SDR Daily Digest</h1>
      <p>Your automated lead generation report for ${generatedAt}</p>
    </div>

    <div class="stats">
      <div class="stat-box">
        <div class="stat-number hot">${hot.length}</div>
        <div class="stat-label">HOT Leads</div>
      </div>
      <div class="stat-box">
        <div class="stat-number warm">${warm.length}</div>
        <div class="stat-label">WARM Leads</div>
      </div>
      <div class="stat-box">
        <div class="stat-number cold">${cold.length}</div>
        <div class="stat-label">COLD Leads</div>
      </div>
      <div class="stat-box">
        <div class="stat-number">${total}</div>
        <div class="stat-label">Total</div>
      </div>
    </div>

    ${hot.length > 0 ? `
    <div class="lead-section">
      <h2>🚨 HOT Leads (${hot.length})</h2>
      ${hot.map(lead => this.renderLeadCard(lead)).join('')}
    </div>
    ` : ''}

    ${warm.length > 0 ? `
    <div class="lead-section">
      <h2>⭐ WARM Leads (${warm.length})</h2>
      ${warm.map(lead => this.renderLeadCard(lead)).join('')}
    </div>
    ` : ''}

    ${cold.length > 0 ? `
    <div class="lead-section">
      <h2>❄️ COLD Leads (${cold.length})</h2>
      ${cold.slice(0, 3).map(lead => this.renderLeadCard(lead)).join('')}
      ${cold.length > 3 ? `<p style="color: #666;">...and ${cold.length - 3} more cold leads</p>` : ''}
    </div>
    ` : ''}

    <div class="footer">
      <p>Generated by AI SDR | <a href="http://localhost:4010">View Dashboard</a></p>
      <p style="font-size: 12px; color: #999;">To unsubscribe, reply to this email with "UNSUBSCRIBE"</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Render a single lead card
   */
  renderLeadCard(lead) {
    const signals = lead.signals || [];
    const message = lead.recommended_message || lead.first_message;
    
    return `
      <div class="lead-card">
        <div class="lead-title">${this.escapeHtml(lead.title)}</div>
        <div class="lead-meta">
          Source: ${lead.source} | 
          ${lead.geo ? `Geo: ${lead.geo} | ` : ''}
          ${lead.author ? `Author: ${lead.author} | ` : ''}
          <a href="${lead.url}" class="lead-link" target="_blank">View Source →</a>
        </div>
        <div class="lead-text">${this.escapeHtml(lead.summary || lead.text || '').slice(0, 200)}...</div>
        ${signals.length > 0 ? `
        <div class="lead-signals">
          ${signals.map(s => `<span class="signal">${this.escapeHtml(s)}</span>`).join('')}
        </div>
        ` : ''}
        ${message ? `
        <div class="message-box">
          <strong>💬 Suggested message:</strong><br>
          ${this.escapeHtml(message)}
        </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Generate plain text email content
   */
  generateDigestText({ hot, warm, cold }) {
    let text = `AI SDR Daily Digest\n`;
    text += `Generated: ${new Date().toLocaleString()}\n\n`;
    
    text += `SUMMARY\n`;
    text += `HOT: ${hot.length}\n`;
    text += `WARM: ${warm.length}\n`;
    text += `COLD: ${cold.length}\n\n`;

    if (hot.length > 0) {
      text += `=== HOT LEADS ===\n\n`;
      hot.forEach((lead, i) => {
        text += `${i + 1}. ${lead.title}\n`;
        text += `   Source: ${lead.source}\n`;
        text += `   URL: ${lead.url}\n\n`;
      });
    }

    if (warm.length > 0) {
      text += `=== WARM LEADS ===\n\n`;
      warm.forEach((lead, i) => {
        text += `${i + 1}. ${lead.title}\n`;
        text += `   Source: ${lead.source}\n`;
        text += `   URL: ${lead.url}\n\n`;
      });
    }

    return text;
  }

  /**
   * Escape HTML special characters
   */
  escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Send test email
   */
  async sendTest() {
    if (!this.enabled) {
      throw new Error('Email not configured');
    }

    try {
      const result = await this.transporter.sendMail({
        from: config.emailFrom,
        to: config.emailTo,
        subject: 'AI SDR - Test Email',
        text: 'This is a test email from your AI SDR system. If you received this, email is configured correctly!',
        html: '<h1>AI SDR Test</h1><p>Email is working correctly! 🎉</p>'
      });

      return { success: true, messageId: result.messageId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// CLI usage
if (require.main === module) {
  const { getInstance } = require('./db');
  
  async function main() {
    const db = getInstance();
    const sender = new EmailSender();
    
    if (!sender.isConfigured()) {
      console.error('Email not configured. Check your .env file.');
      process.exit(1);
    }

    // Get leads from last 24 hours
    const recentLeads = db.getRecentLeads(24);
    
    if (recentLeads.length === 0) {
      console.log('No new leads in the last 24 hours. Sending test email instead.');
      const result = await sender.sendTest();
      console.log(result.success ? 'Test email sent!' : `Error: ${result.error}`);
      return;
    }

    const stats = db.getStats();
    const result = await sender.sendDigest(recentLeads, stats);
    
    if (result.success) {
      console.log(`Digest sent! Message ID: ${result.messageId}`);
    } else {
      console.error(`Failed to send: ${result.error}`);
    }
  }

  main().catch(console.error);
}

module.exports = { EmailSender };
