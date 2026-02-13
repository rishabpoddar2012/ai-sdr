const fs = require('fs');
const path = require('path');
const { openaiChatJSON } = require('../lib/openai_client');

const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, './score_schema.json'), 'utf8'));

function latestCollected() {
  const dir = path.resolve(__dirname, '../leads');
  const files = fs.readdirSync(dir).filter(f => f.startsWith('linkedin_collected_')).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

function inferGeoHeuristic(text) {
  const t = (text || '').toLowerCase();
  if (/(\buk\b|london|manchester|birmingham|britain|england|scotland)/.test(t)) return 'UK';
  if (/(\bus\b|usa|united states|new york|nyc|san francisco|sf|austin|chicago|los angeles|la )/.test(t)) return 'US';
  return 'Other';
}

async function scoreOne(item) {
  const baseGeo = inferGeoHeuristic(item.text);

  const prompt = `You are scoring LinkedIn posts as opportunities for performance marketing agency owners.\n\nWe only want BUYER INTENT.\n- buyer_request: someone/company is asking for an agency/freelancer to run Meta/Google ads\n- hiring_employee: hiring a full-time role\n- self_promo: marketing person promoting themselves\n- other\n\nScoring:\n- HOT: buyer_request + urgency/budget/clarity\n- WARM: buyer_request but missing details\n- SKIP: everything else\n\nGeo: classify as US/UK/Other. If unclear, use the heuristic suggestion.\nReturn JSON only.`;

  const messages = [
    { role: 'system', content: prompt },
    { role: 'user', content: JSON.stringify({ author: item.author, time: item.time, url: item.url, text: item.text, geo_hint: baseGeo }) }
  ];

  return openaiChatJSON({ model: 'gpt-5.2', messages, jsonSchema: schema, temperature: 0.2 });
}

async function run() {
  const f = latestCollected();
  if (!f) {
    console.error('No collected file found.');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const items = raw.items || [];

  const scored = [];
  for (const item of items) {
    if (!item.text || item.text.length < 40) continue;
    const s = await scoreOne(item);
    scored.push({ ...item, ...s });
  }

  // publish to web JSON
  const webOut = path.resolve(__dirname, '../web/data/leads.json');
  const freeLeadCount = 5;

  const leads = scored
    .filter(x => x.score !== 'SKIP')
    .sort((a,b) => (a.score === b.score ? 0 : (a.score === 'HOT' ? -1 : 1)))
    .map((x, i) => ({
      id: `li-${Date.now()}-${i}`,
      source: 'linkedin_posts',
      geo: x.geo,
      score: x.score,
      title: (x.text || '').slice(0, 72) + ((x.text || '').length > 72 ? '…' : ''),
      summary: (x.why || '').slice(0, 180),
      url: x.url || '',
      recommended_message: x.first_message || '',
      signals: x.signals || [],
      capturedAt: new Date().toISOString(),
    }));

  fs.writeFileSync(webOut, JSON.stringify({ generatedAt: new Date().toISOString(), plan: 'freemium', freeLeadCount, leads }, null, 2));
  console.log(`Published: ${webOut} (leads=${leads.length})`);
}

run();
