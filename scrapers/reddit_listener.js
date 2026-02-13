const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- CONFIG ---
const SUBREDDITS = ['forhire', 'freelance_forhire', 'marketing', 'startups', 'smallbusiness'];
const KEYWORDS = ['hiring', 'looking for', 'need a', 'searching for'];
const NICHE = process.argv[2] || "video editor"; // Default Niche

// --- MODULE: REDDIT SCRAPER (JSON Endpoint) ---
async function scrapeReddit(niche) {
    console.log(`🕵️‍♂️ Scanning Reddit for: "${niche}"...`);
    
    const leads = [];
    
    for (const sub of SUBREDDITS) {
        try {
            // Using Reddit's public JSON endpoint (No API Key needed for read-only)
            const url = `https://www.reddit.com/r/${sub}/new.json?limit=50`;
            const res = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
            });

            const posts = res.data.data.children;
            
            posts.forEach(post => {
                const p = post.data;
                const title = p.title.toLowerCase();
                const body = p.selftext.toLowerCase();
                
                // 1. Keyword Match
                const hasIntent = KEYWORDS.some(k => title.includes(k) || body.includes(k));
                
                // 2. Niche Match
                const hasNiche = title.includes(niche) || body.includes(niche);

                if (hasIntent && hasNiche) {
                    leads.push({
                        source: `r/${sub}`,
                        title: p.title,
                        url: `https://reddit.com${p.permalink}`,
                        text: p.selftext.substring(0, 200) + "...",
                        score: p.score,
                        date: new Date(p.created_utc * 1000).toISOString()
                    });
                }
            });
            console.log(`   ✅ Scanned r/${sub}: Found ${leads.length} matches so far.`);
            
        } catch (e) {
            console.error(`   ❌ Error scanning r/${sub}: ${e.message}`);
        }
    }
    
    return leads;
}

// --- MAIN RUNNER ---
async function run() {
    const leads = await scrapeReddit(NICHE);
    
    if (leads.length > 0) {
        const outFile = path.join(__dirname, 'leads', `leads_${NICHE.replace(/\s/g, '_')}.json`);
        fs.writeFileSync(outFile, JSON.stringify(leads, null, 2));
        
        console.log("\n🔥 HOT LEADS FOUND:");
        leads.forEach((l, i) => {
            console.log(`${i+1}. [${l.source}] ${l.title}`);
            console.log(`   🔗 ${l.url}\n`);
        });
        console.log(`💾 Saved to: ${outFile}`);
    } else {
        console.log(`\n❄️ No leads found for "${NICHE}". Try a broader keyword.`);
    }
}

run();
