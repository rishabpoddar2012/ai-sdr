const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT_DIR = path.resolve(__dirname, '../leads');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// NOTE: Upwork is anti-bot. This collector is built to be resilient:
// - tries a simple fetch to public search pages
// - if blocked, returns 0 results but keeps pipeline intact

const KEYWORDS = [
  'facebook ads',
  'meta ads',
  'google ads',
  'ppc',
  'performance marketing',
  'shopify roas',
];

function sha(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

async function fetchUpworkSearch(keyword) {
  // Public search URL patterns change. This is best-effort.
  const url = `https://www.upwork.com/nx/search/jobs/?q=${encodeURIComponent(keyword)}&sort=recency`;

  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });

  const text = await res.text();

  // crude bot-detection heuristics
  const blocked = res.status === 403 || /captcha|access denied|bot detection/i.test(text);
  return { url, status: res.status, blocked, html: text };
}

async function run() {
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  const rawOut = [];

  for (const kw of KEYWORDS) {
    try {
      const { url, status, blocked, html } = await fetchUpworkSearch(kw);
      rawOut.push({
        source: 'upwork',
        keyword: kw,
        fetchedAt: new Date().toISOString(),
        url,
        status,
        blocked,
        // store only a snippet to avoid huge files
        htmlSnippet: html.slice(0, 5000),
      });
      console.log(`[upwork] kw="${kw}" status=${status} blocked=${blocked}`);
    } catch (e) {
      console.log(`[upwork] kw="${kw}" error=${e.message}`);
      rawOut.push({ source: 'upwork', keyword: kw, fetchedAt: new Date().toISOString(), error: e.message });
    }
  }

  const file = path.join(OUT_DIR, `raw_upwork_${now}.json`);
  fs.writeFileSync(file, JSON.stringify(rawOut, null, 2));
  console.log(`Saved: ${file}`);
}

run();
