const cheerio = require('cheerio');

async function googleDork(niche) {
    console.log(`🕵️‍♂️ Dorking Google for Reddit Leads: "${niche}"...`);
    
    // We use a public search aggregator to avoid direct Google blocking
    // Or we use a simple fetch with headers (Google blocks this often, but let's try DuckDuckGo HTML)
    
    const query = `site:reddit.com "${niche}" "hiring"`;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
        });
        const html = await res.text();
        const $ = cheerio.load(html);
        
        const leads = [];
        
        $('.result__title .result__a').each((i, el) => {
            const title = $(el).text();
            const link = $(el).attr('href');
            leads.push({ title, link });
        });
        
        return leads;

    } catch (e) {
        console.error("Scrape Error:", e.message);
        return [];
    }
}

async function run() {
    const leads = await googleDork("video editor");
    
    if (leads.length > 0) {
        console.log("\n🔥 FOUND LEADS (via DuckDuckGo):");
        leads.forEach((l, i) => {
            console.log(`${i+1}. ${l.title}`);
            console.log(`   🔗 ${l.link}\n`);
        });
    } else {
        console.log("No results. DDG might have blocked the bot.");
    }
}

run();
