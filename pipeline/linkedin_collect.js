const fs = require('fs');
const path = require('path');

/**
 * This file is a placeholder for the programmatic collector.
 * In practice, collection happens via the Clawdbot browser tool (node proxy) using evaluate().
 * We persist the collected items to disk so other steps can run without needing the browser.
 */

const OUT_DIR = path.resolve(__dirname, '../leads');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function saveCollected(items, meta = {}) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(OUT_DIR, `linkedin_collected_${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ meta: { collectedAt: new Date().toISOString(), ...meta }, items }, null, 2));
  return outPath;
}

module.exports = { saveCollected };
