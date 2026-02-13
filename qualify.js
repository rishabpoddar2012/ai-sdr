const fs = require('fs');
const path = require('path');
const { openaiChatJSON } = require('./lib/openai_client');

const IN_DIR = path.resolve(__dirname, './leads');

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'string', enum: ['HOT', 'WARM', 'SKIP'] },
    why: { type: 'string' },
    extracted: {
      type: 'object',
      additionalProperties: false,
      properties: {
        budget_hint: { type: ['string', 'null'] },
        timeline_hint: { type: ['string', 'null'] },
        niche: { type: ['string', 'null'] }
      },
      required: ['budget_hint', 'timeline_hint', 'niche']
    },
    first_message: { type: 'string' },
  },
  required: ['score', 'why', 'extracted', 'first_message'],
};

function latestRawFile(prefix) {
  const files = fs.readdirSync(IN_DIR).filter(f => f.startsWith(prefix));
  if (!files.length) return null;
  files.sort();
  return path.join(IN_DIR, files[files.length - 1]);
}

async function qualifyRecord(rec) {
  const content = rec.htmlSnippet || rec.text || '';
  const prompt = `You are an AI SDR qualifier for performance marketing agencies (Meta + Google ads).\n\nGiven the following opportunity text/snippet, classify if it is worth pursuing for an agency owner.\n\nRules:\n- HOT: clear buying intent + reasonable budget/urgency/clarity\n- WARM: some intent but missing key details\n- SKIP: low quality, vague, or not relevant\n\nReturn JSON only.`;

  const messages = [
    { role: 'system', content: prompt },
    { role: 'user', content: `SOURCE: ${rec.source}\nKEYWORD: ${rec.keyword}\nURL: ${rec.url}\nSTATUS: ${rec.status}\nBLOCKED: ${rec.blocked}\nSNIPPET:\n${content}` },
  ];

  return openaiChatJSON({
    model: 'gpt',
    messages,
    jsonSchema: schema,
    temperature: 0.2,
  });
}

async function run() {
  const f = latestRawFile('raw_upwork_');
  if (!f) {
    console.error('No raw_upwork_*.json found. Run sources/upwork_search.js first.');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const qualified = [];

  for (const rec of raw) {
    // If blocked, skip AI call (no value)
    if (rec.blocked || rec.error) {
      qualified.push({ ...rec, qualification: { score: 'SKIP', why: 'Source blocked or error; need alternate collection method.', extracted: { budget_hint: null, timeline_hint: null, niche: null }, first_message: '' } });
      continue;
    }

    const q = await qualifyRecord(rec);
    qualified.push({ ...rec, qualification: q });
    console.log(`Qualified ${rec.keyword}: ${q.score}`);
  }

  const out = path.join(IN_DIR, `qualified_${path.basename(f)}`);
  fs.writeFileSync(out, JSON.stringify(qualified, null, 2));
  console.log(`Saved: ${out}`);
}

run();
