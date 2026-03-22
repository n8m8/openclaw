# Webapp Scaffolding Lessons Learned

Patterns and preferences from building Altsearch (small business finder).

## Tech Stack Choices

### Cloudflare Workers + Pages (Preferred Architecture)

**Backend: Cloudflare Workers (API-only)**

- ✅ Serverless, zero config
- ✅ Global edge network (fast everywhere)
- ✅ Free tier generous (100k req/day)
- ✅ Secrets management built-in
- ✅ No cold starts
- ✅ Pure API, no HTML serving

**Frontend: Standalone HTML (Cloudflare Pages / static hosting)**

- ✅ Decouple from backend
- ✅ Deploy frontend independently
- ✅ Host anywhere (Pages, Vercel, GitHub Pages, your blog)
- ✅ No build step needed for simple apps
- ✅ Easy to iterate on styling/UX without touching backend

**Why separate?**

- Frontend can be deployed to your blog, embedded in docs, distributed
- Backend stays stable (API contract doesn't change with UI tweaks)
- Different update cadences (frontend changes more often)
- Can A/B test frontends with same backend

**Template:**

```javascript
// worker.js - API-only backend
async function handleRequest(request, env) {
  const url = new URL(request.url);

  // No HTML serving - just APIs
  if (url.pathname === "/api/config") {
    /* ... */
  }
  if (url.pathname === "/api/search-stream") {
    /* ... */
  }

  return new Response("API only - use standalone frontend", { status: 404 });
}

export default { fetch: handleRequest };
```

```html
<!-- index.html - standalone frontend -->
<script>
  const API_BASE = "https://your-worker.workers.dev";

  fetch(`${API_BASE}/api/config`)
    .then((r) => r.json())
    .then((config) => {
      /* ... */
    });
</script>
```

**Dev workflow:**

```bash
# Terminal 1: Backend
wrangler dev  # Runs on localhost:8787

# Terminal 2: Frontend
python3 -m http.server 8000  # Or: npx serve
# Update index.html to point to localhost:8787 for dev
```

### Next.js (When You Need More)

- Use for: auth, database, complex routing
- Vercel deployment (but more config than Workers)
- Better for multi-page apps

## Architecture Patterns

### Server-Sent Events (SSE) for AI Streaming

**Why:** Users want to see progress, not stare at spinners for 60+ seconds

**Pattern:**

```javascript
// Backend: Stream progress events
const stream = new ReadableStream({
  async start(controller) {
    const send = (event, data) => {
      controller.enqueue(
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      );
    };

    send('progress', { step: 1, message: 'Searching...' });
    const results = await search();
    send('progress', { step: 2, message: `Found ${results.length} items` });

    // Stream AI response
    const aiStream = await openrouter.chat(..., stream: true);
    for await (const chunk of aiStream) {
      send('progress', { partialContent: chunk });
    }

    send('result', finalData);
    controller.close();
  }
});

return new Response(stream, {
  headers: { 'Content-Type': 'text/event-stream' }
});
```

```javascript
// Frontend: EventSource or fetch with reader
const response = await fetch('/api/search-stream', { method: 'POST', ... });
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  // Parse SSE format: "event: ...\ndata: {...}\n\n"
  // Update UI in real-time
}
```

**Lessons:**

- Fake progress bars feel deceptive → show real work
- Users tolerate waiting if they see what's happening
- Stream AI tokens as they generate (not just final response)

### Progress UX

**Multi-stage with time-based transitions:**

```javascript
// 0-20s: "Reasoning..."
// 20-25s: "This usually takes 60-90 seconds..."
// 25-50s: "Analyzing..."
// 50-75s: "Compiling results..."
// 75s+: Stuck at 98% (avoids looking broken)
```

**Why:** Manages expectations, reduces anxiety during long waits

### Rate Limiting Strategy

**Problem:** Brave Search API returns 429 with parallel requests

**Solution:**

```javascript
// Bad: Promise.all (hits rate limits)
const results = await Promise.all(searches.map((q) => braveSearch(q)));

// Good: Sequential with delays
for (const query of searches) {
  const results = await braveSearch(query);
  allResults.push(...results);
  if (i < searches.length - 1) {
    await new Promise((r) => setTimeout(r, 1000)); // 1s delay
  }
}
```

**Or:** Just do 1 comprehensive search instead of 4 narrow ones

## Security Patterns

### API Keys

```javascript
// ✅ Good: Environment variables
env.OPENROUTER_API_KEY;
env.BRAVE_API_KEY;

// ❌ Never: Hardcoded or in deploy scripts
// deploy.sh with actual keys → leaked on commit
```

### CORS

```javascript
// Permissive for development:
"Access-Control-Allow-Origin": origin || "*"

// Locked down for production (optional):
const allowed = ["https://yourdomain.com"];
return allowed.includes(origin) ? origin : null;
```

### Input Validation

```javascript
const query = (data.query || "").trim();
if (!query || query.length > 200) {
  return new Response(JSON.stringify({ error: "Invalid query" }), { status: 400 });
}

const maxResults = Math.min(data.max_results || 5, 10); // Cap at 10
```

## Design Patterns

### Brutalist Aesthetic (When Appropriate)

**Altsearch style:**

- Eggshell background (#F5F5DC) → trust, honesty
- Black-brown text/borders (#2b1f0f)
- Courier New monospace
- Thick borders (4px), no rounded corners
- Heavy uppercase labels
- High contrast

**When to use:**

- Tools for power users
- Anti-corporate vibe
- Direct, no-bullshit UX

**When not to use:**

- Consumer apps (too harsh)
- Need broad appeal
- Accessibility concerns (high contrast can be polarizing)

### Deployment Options

**Option 1: Cloudflare Pages (Recommended)**

```bash
# Push to git, then:
wrangler pages deploy ./frontend
# Or connect repo to Pages dashboard (auto-deploy on push)
```

**Option 2: Embed in your blog/docs**

```html
<!-- Copy index.html into your blog's static folder -->
<link rel="stylesheet" href="/altsearch.css" />
<div id="altsearch-container"></div>
<script src="/altsearch.js"></script>
```

**Option 3: GitHub Pages**

```bash
# gh-pages branch
git subtree push --prefix frontend origin gh-pages
```

**Option 4: Simple static host**

```bash
# Dev only
python3 -m http.server 8000
# Production: Vercel, Netlify, etc.
```

### Settings Accordion

```javascript
<div class="accordion">
  <div class="accordion-header" onclick="toggle()">⚙️ Settings</div>
  <div class="accordion-content">
    <!-- Blocklist editor, preferences, etc. -->
  </div>
</div>
```

**Why:** Advanced options hidden by default, clean first impression

## AI Integration Patterns

### Prompt Structure

**Template variables:**

```javascript
const prompt = `I found ${results.length} web search results for "${query}".

Your task: Select the BEST options and provide a quality summary.

RESULT COUNT GUIDANCE:
- If many excellent options (10+), return up to 15 results
- If limited/poor quality, aim for ~5 results
- Quality over quantity - don't pad the list

EXCLUDE: ${blocklist.join(", ")}
${location ? `PREFER options that ship to: ${location}` : ""}

Return JSON:
{
  "summary": "Brief honest assessment...",
  "quality": "excellent|good|fair|limited",
  "results": [...]
}
`;
```

**Key lessons:**

- Give fuzzy guidelines, not hard limits
- Ask AI to self-assess quality
- Let AI explain result count in summary
- Demand JSON format explicitly
- Separate system requirements from user data

### Streaming AI Responses

```javascript
// Enable streaming
{
  stream: true;
}

// Parse SSE from OpenRouter
for (const line of lines) {
  if (line.startsWith("data: ")) {
    const json = JSON.parse(line.slice(6));
    const delta = json.choices?.[0]?.delta?.content;
    if (delta) {
      content += delta;
      // Show partial content to user
      sendProgress({ partialContent: content.substring(0, 150) + "..." });
    }
  }
}
```

## Deployment Checklist

### Pre-Deploy

- [ ] No hardcoded secrets (check worker.js, deploy.sh, README)
- [ ] API keys in .env (excluded from git)
- [ ] .wrangler/ and node_modules/ in .gitignore
- [ ] SECURITY.md documents risks
- [ ] LICENSE file added
- [ ] README has setup instructions (no secrets)

### Deploy

```bash
wrangler deploy
wrangler secret put OPENROUTER_API_KEY  # Prompts for value
wrangler secret put BRAVE_API_KEY
```

### Post-Deploy

- [ ] Test from production URL
- [ ] Set up monitoring/alerts
- [ ] Configure rate limiting (Cloudflare dashboard)
- [ ] Add custom domain (optional)

## Git Hygiene

```bash
# Before first commit
git init
echo ".env" >> .gitignore
echo ".wrangler/" >> .gitignore
echo "node_modules/" >> .gitignore

# If you committed secrets by accident:
# 1. Rotate the keys immediately
# 2. Remove from history (or just rotate and move on)
# 3. Add to .gitignore
# 4. Force push (if private repo)
```

## Cost Optimization

### Free Tier Stacking

- Cloudflare Workers: 100k req/day free
- OpenRouter: Use free models (nvidia/nemotron-3-super-120b-a12b:free)
- Brave Search: 2,000 queries/month free

**Strategy:** Minimize API calls

- Cache popular queries (30min TTL)
- Single comprehensive search vs multiple narrow ones
- Rate limit users (30 req/min)

### Monitoring

```bash
# Watch usage
wrangler tail

# Check Cloudflare analytics dashboard
# Check OpenRouter usage page
# Check Brave API dashboard
```

## UI/UX Patterns

### Disclosure & Trust

**Altsearch example:**

```html
<div class="disclosure">
  <strong>AI Data Collection Notice:</strong>
  This tool uses <a href="...">NVIDIA Nemotron 3 Super (free)</a> via OpenRouter and
  <a href="...">Brave Search API</a>. Your queries may be processed by these services. This is how
  we can offer the tool for free.
</div>
```

**Lesson:** Be transparent about data flow → builds trust

### Results Summary Card

```javascript
{
  "summary": "Found 12 excellent independent options",
  "quality": "excellent" // excellent|good|fair|limited
}
```

**Display:**

```html
<div class="summary-card excellent">
  <div class="summary-title">✨ Results Overview</div>
  <div class="summary-text">${summary}</div>
</div>
```

**Color code by quality:**

- Excellent: green border
- Good: blue border
- Fair: orange border
- Limited: red border

**Why:** Sets user expectations before they see results

## Common Pitfalls

### ❌ Fake Progress

**Bad:** `setInterval(() => progress++)`  
**Good:** Send real events as work happens

### ❌ Secrets in Git

**Bad:** Hardcoded keys in deploy.sh, README examples  
**Good:** .env.example templates, wrangler secrets

### ❌ Rate Limit Ignorance

**Bad:** Parallel API calls without delays  
**Good:** Sequential or rate-limited

### ❌ No Error Handling

**Bad:** UI freezes when API fails  
**Good:** Show error, suggest retry, log to console

### ❌ Overpromising Results

**Bad:** "Found 10 perfect matches!" (when they're mediocre)  
**Good:** "Limited options available - try broader search"

## Lessons Specific to Altsearch

### Search Strategy Evolution

1. **V1:** 4 searches, parallel → Rate limited (429 errors)
2. **V2:** 4 searches, sequential with 1s delays → Slow (6-8s)
3. **V3:** 1 comprehensive search, 20 results → Fast, good coverage

**Lesson:** Start simple, optimize based on real failures

### AI Flexibility

- Give AI fuzzy result counts (5-15 based on quality)
- Let AI admit when results are poor
- AI explains its reasoning in summary

**Lesson:** Rigid constraints = bad results. Flexible guidelines = honest output.

### Brutalist Design Win

- Users commented on "refreshing" aesthetic
- High contrast = easy to read
- No-nonsense vibe fits "anti-corporate" mission

**Lesson:** Design should match purpose

## Template Starter

Quick scaffold for next Cloudflare Worker + Pages webapp:

```bash
mkdir my-webapp && cd my-webapp
mkdir frontend

# Backend
touch worker.js wrangler.toml .gitignore .env.example
touch LICENSE README.md SECURITY.md

# Frontend
touch frontend/index.html frontend/dev-server.sh

# .gitignore
cat > .gitignore << 'EOF'
.env
.wrangler/
node_modules/
EOF

# wrangler.toml
cat > wrangler.toml << 'EOF'
name = "my-webapp"
main = "worker.js"
compatibility_date = "2024-01-01"
EOF

# Dev server script
cat > frontend/dev-server.sh << 'EOF'
#!/bin/bash
echo "Frontend dev server: http://localhost:8000"
python3 -m http.server 8000
EOF
chmod +x frontend/dev-server.sh

# Deploy backend
wrangler deploy

# Deploy frontend (option 1: Pages)
# wrangler pages deploy frontend

# Deploy frontend (option 2: your blog)
# cp frontend/index.html ~/my-blog/static/altsearch.html
```

**File structure:**

```
my-webapp/
├── worker.js           # Backend API only
├── wrangler.toml
├── .env.example
├── README.md
├── SECURITY.md
├── LICENSE
└── frontend/
    ├── index.html      # Standalone frontend
    └── dev-server.sh   # Quick dev server
```

---

**Bottom line:** Ship fast, but secure. SSE for long tasks. Be honest about limitations. Free tiers go far.
