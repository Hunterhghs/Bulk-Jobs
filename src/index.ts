// Bulk Jobs — Cloudflare Worker
// Handles: scheduled cron fetch, API endpoints, static frontend serving

import { COMPANIES, type Company } from './companies';
import { scoreJob, shouldKeep, type ScoredJob } from './filter';
import { fetchCompany, type AtsType } from './fetchers/index';
import {
  batchUpsertJobs, upsertCompanyStmt, updateCompanyJobCount,
  MARK_ALL_NOT_NEW, DEACTIVATE_STALE,
  buildJobsQuery, buildCountQuery,
  STATS_TOTAL, STATS_NEW_TODAY, STATS_BY_CATEGORY, STATS_BY_LEVEL,
  STATS_BY_SOURCE, STATS_BY_TYPE, STATS_LAST_FETCH,
  CREATE_FETCH_LOG, completeFetchLog,
  type JobRow,
} from './db';

export interface Env {
  DB: D1Database;
  MAX_COMPANIES_PER_RUN?: string;
  REQUEST_TIMEOUT_MS?: string;
}

// =============================================================================
// Scheduled handler — runs daily via cron trigger
// =============================================================================

async function handleScheduled(env: Env): Promise<void> {
  const startTime = Date.now();
  const timeout = parseInt(env.REQUEST_TIMEOUT_MS || '8000');
  const maxCompanies = parseInt(env.MAX_COMPANIES_PER_RUN || '250');

  console.log(`[Bulk Jobs] Starting daily fetch across ${COMPANIES.length} companies...`);

  // Mark existing jobs as not-new
  await env.DB.prepare(MARK_ALL_NOT_NEW).run();
  // Deactivate stale jobs
  await env.DB.prepare(DEACTIVATE_STALE).run();

  // Ensure companies are in the DB
  for (const c of COMPANIES) {
    const stmt = upsertCompanyStmt(c);
    await env.DB.prepare(stmt.sql).bind(...stmt.params).run();
  }

  // Create fetch log for this run
  const logResult = await env.DB.prepare(CREATE_FETCH_LOG).bind('all').run();
  const logId = logResult.meta?.last_row_id as number;

  // Group companies by ATS type, shuffle within each group
  const byAts: Record<string, Company[]> = {};
  for (const c of COMPANIES.slice(0, maxCompanies)) {
    if (!byAts[c.ats]) byAts[c.ats] = [];
    byAts[c.ats].push(c);
  }

  let totalFetched = 0;
  let totalFound = 0;
  let totalNew = 0;
  let totalUpdated = 0;
  const allErrors: string[] = [];

  // Process each ATS type — one company at a time with delays
  for (const [ats, companies] of Object.entries(byAts)) {
    console.log(`[Bulk Jobs] Processing ${companies.length} ${ats} companies...`);

    for (const company of companies) {
      try {
        const result = await fetchCompany(company as any, timeout);
        totalFetched++;

        // Filter jobs that match Hunter's profile
        const relevantJobs = result.jobs
          .filter(shouldKeep)
          .slice(0, 50); // Max 50 jobs per company

        if (relevantJobs.length > 0) {
          // Upsert all relevant jobs
          const statements = batchUpsertJobs(relevantJobs);
          for (const stmt of statements) {
            try {
              await env.DB.prepare(stmt.sql).bind(...stmt.params).run();
              totalFound++;
            } catch (e: any) {
              // Skip duplicates silently
              if (!e.message?.includes('UNIQUE constraint')) {
                allErrors.push(`DB error for ${company.id}: ${e.message}`);
              }
            }
          }

          // Update company job count
          const countStmt = updateCompanyJobCount(company.id, result.jobs.length);
          await env.DB.prepare(countStmt.sql).bind(...countStmt.params).run();
        }

        // Track new vs updated (rough estimate)
        totalNew += relevantJobs.filter(j => j.relevanceScore >= 10).length;
        totalUpdated += relevantJobs.filter(j => j.relevanceScore < 10).length;

        if (result.errors.length > 0) {
          allErrors.push(...result.errors);
        }

        // Rate limiting: 200ms delay between companies
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (err: any) {
        allErrors.push(`Fatal ${company.id}: ${err.message}`);
      }
    }

    // Longer delay between ATS types
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Count actual new jobs (is_new = 1)
  const newCount = await env.DB.prepare(`SELECT COUNT(*) as c FROM jobs WHERE is_new = 1`).first<{c: number}>();
  const actualNew = newCount?.c || 0;

  // Complete the fetch log
  const completeStmt = completeFetchLog(
    logId, totalFetched, totalFound, actualNew, totalUpdated,
    allErrors.length > 0 ? allErrors.join('; ').substring(0, 1000) : null,
  );
  await env.DB.prepare(completeStmt.sql).bind(...completeStmt.params).run();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Bulk Jobs] Done in ${elapsed}s — fetched ${totalFetched} companies, ${totalFound} jobs (${actualNew} new)`);
}

// =============================================================================
// API handlers
// =============================================================================

async function handleApiJobs(env: Env, url: URL): Promise<Response> {
  const search = url.searchParams.get('search') || undefined;
  const category = url.searchParams.get('category') || undefined;
  const level = url.searchParams.get('level') || undefined;
  const source = url.searchParams.get('source') || undefined;
  const jobType = url.searchParams.get('jobType') || undefined;
  const region = url.searchParams.get('region') || undefined;
  const sort = url.searchParams.get('sort') || undefined;
  const minScore = parseInt(url.searchParams.get('minScore') || '0');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const { sql, params } = buildJobsQuery({
    search, category, level, source, jobType, region, minScore, sort, limit, offset,
  });

  const countQuery = buildCountQuery({ search, category, level, source, jobType, region });

  try {
    const jobsResult = await env.DB.prepare(sql).bind(...params).all<JobRow>();
    const countResult = await env.DB.prepare(countQuery.sql).bind(...countQuery.params).first<{ total: number }>();

    return Response.json({
      jobs: jobsResult.results || [],
      total: countResult?.total || 0,
      limit,
      offset,
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

async function handleApiStats(env: Env): Promise<Response> {
  try {
    const [total, newToday, byCategory, byLevel, bySource, byType, lastFetch] = await Promise.all([
      env.DB.prepare(STATS_TOTAL).first<{ count: number }>(),
      env.DB.prepare(STATS_NEW_TODAY).first<{ count: number }>(),
      env.DB.prepare(STATS_BY_CATEGORY).all<{ category: string; count: number }>(),
      env.DB.prepare(STATS_BY_LEVEL).all<{ level: string; count: number }>(),
      env.DB.prepare(STATS_BY_SOURCE).all<{ source: string; count: number }>(),
      env.DB.prepare(STATS_BY_TYPE).all<{ job_type: string; count: number }>(),
      env.DB.prepare(STATS_LAST_FETCH).first<{ finished_at: string }>(),
    ]);

    return Response.json({
      totalJobs: total?.count || 0,
      newToday: newToday?.count || 0,
      byCategory: Object.fromEntries((byCategory?.results || []).map(r => [r.category, r.count])),
      byLevel: Object.fromEntries((byLevel?.results || []).map(r => [r.level, r.count])),
      bySource: Object.fromEntries((bySource?.results || []).map(r => [r.source, r.count])),
      byType: Object.fromEntries((byType?.results || []).map(r => [r.job_type, r.count])),
      lastFetch: lastFetch?.finished_at || null,
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

async function handleApiTrigger(env: Env): Promise<Response> {
  // Manual trigger for the daily fetch
  try {
    await handleScheduled(env);
    return Response.json({ status: 'completed', timestamp: new Date().toISOString() });
  } catch (err: any) {
    return Response.json({ status: 'error', error: err.message }, { status: 500 });
  }
}

// =============================================================================
// Static frontend serving
// =============================================================================

const FRONTEND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bulk Jobs — Remote Business, Research, Economics & Writing Jobs</title>
<meta name="description" content="Curated remote job board for entry-to-mid level roles in business, research, economics, writing, data, climate, and finance. Aggregated daily from 250+ companies.">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#fafaf9;--card:#fff;--text:#1a1a1a;--muted:#6b6b6b;
    --border:#e6e4e0;--accent:#1a56db;--accent-soft:#e8f0fe;
    --green:#0d7a3e;--green-soft:#e8f5ee;--amber:#b45309;
    --amber-soft:#fef7ed;--purple:#6d28d9;--purple-soft:#f5f0ff;
    --red:#c62828;--red-soft:#fdecea;--shadow:0 1px 2px rgba(0,0,0,.04);
    --radius:6px;--font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  }
  @media(prefers-color-scheme:dark){
    :root{--bg:#111110;--card:#1a1a19;--text:#e8e6e0;--muted:#9b9b90;--border:#33332e;
    --accent:#5b8def;--accent-soft:#1a2640;--green:#3db972;--green-soft:#1a2e20;
    --amber:#e0964a;--amber-soft:#2e2010;--purple:#9b6dff;--purple-soft:#2a1a40;
    --red:#ef5350;--red-soft:#3a1a18;--shadow:0 1px 2px rgba(0,0,0,.2)}
  }
  body{font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.5}
  .container{max-width:1200px;margin:0 auto;padding:12px 16px}
  header{padding:16px 0;border-bottom:1px solid var(--border);margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
  header h1{font-size:1.3rem;font-weight:700;letter-spacing:-.02em}
  header h1 span{color:var(--accent)}
  .stats-bar{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px}
  .stat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:8px 14px;font-size:.82rem}
  .stat strong{font-size:1.1rem;display:block}
  .stat span{color:var(--muted);font-size:.72rem}
  .filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
  .filters input[type=text]{padding:7px 12px;border:1px solid var(--border);border-radius:var(--radius);font-size:.82rem;background:var(--card);color:var(--text);min-width:220px}
  .filters input[type=text]::placeholder{color:var(--muted)}
  .filter-chip{padding:5px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:.75rem;cursor:pointer;background:var(--card);color:var(--muted);white-space:nowrap;transition:all .15s}
  .filter-chip:hover{border-color:var(--accent);color:var(--accent)}
  .filter-chip.active{background:var(--accent);color:#fff;border-color:var(--accent)}
  .filter-group{display:flex;gap:4px;flex-wrap:wrap}
  .filter-label{font-size:.72rem;color:var(--muted);margin-right:4px;align-self:center}
  .job-count{font-size:.75rem;color:var(--muted);margin-left:auto}
  .job-list{display:flex;flex-direction:column;gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
  .job-row{background:var(--card);padding:10px 14px;cursor:pointer;transition:background .1s;display:grid;grid-template-columns:1fr 140px 90px 80px 70px;gap:8px;align-items:center;font-size:.82rem}
  .job-row:hover{background:var(--accent-soft)}
  .job-row .title-col{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .job-row .company-col{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .job-row .location-col{color:var(--muted);font-size:.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .job-row .source-col{font-size:.7rem;text-transform:uppercase;text-align:center}
  .badge{padding:2px 7px;border-radius:10px;font-size:.68rem;font-weight:600;display:inline-block}
  .badge-entry{background:var(--green-soft);color:var(--green)}
  .badge-mid{background:var(--accent-soft);color:var(--accent)}
  .badge-senior{background:var(--red-soft);color:var(--red)}
  .badge-freelance{background:var(--amber-soft);color:var(--amber)}
  .badge-contract{background:var(--purple-soft);color:var(--purple)}
  .score-badge{font-size:.7rem;color:var(--muted);text-align:center}
  .job-detail{display:none;background:var(--card);border-top:1px solid var(--border);padding:14px 18px;font-size:.8rem;line-height:1.6}
  .job-detail.open{display:block}
  .job-detail h3{font-size:.95rem;margin-bottom:6px}
  .job-detail .meta{font-size:.75rem;color:var(--muted);margin-bottom:10px;display:flex;gap:16px;flex-wrap:wrap}
  .job-detail .desc{white-space:pre-wrap;max-height:300px;overflow-y:auto}
  .job-detail .apply-btn{display:inline-block;margin-top:10px;padding:7px 18px;background:var(--accent);color:#fff;border-radius:var(--radius);text-decoration:none;font-size:.8rem;font-weight:600}
  .job-detail .apply-btn:hover{opacity:.9}
  .empty-state{text-align:center;padding:60px 20px;color:var(--muted)}
  .empty-state p{font-size:.9rem}
  .loading{text-align:center;padding:40px;color:var(--muted)}
  .pagination{display:flex;justify-content:center;gap:8px;margin-top:16px}
  .pagination button{padding:6px 14px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);cursor:pointer;font-size:.78rem}
  .pagination button:disabled{opacity:.4;cursor:default}
  .pagination button.active{background:var(--accent);color:#fff;border-color:var(--accent)}
  .pagination span{font-size:.78rem;color:var(--muted);align-self:center}
  footer{text-align:center;padding:24px;color:var(--muted);font-size:.72rem;border-top:1px solid var(--border);margin-top:24px}
  @media(max-width:768px){
    .job-row{grid-template-columns:1fr 90px 60px;gap:4px;padding:8px 10px;font-size:.78rem}
    .job-row .location-col,.job-row .source-col{display:none}
    .filters{flex-direction:column;align-items:flex-start}
  }
</style>
</head>
<body>
<div class="container">
<header>
  <h1>Bulk <span>Jobs</span></h1>
  <div class="stats-bar" id="stats"></div>
</header>

<div class="filters">
  <input type="text" id="search" placeholder="Search jobs..." oninput="debounceSearch()">
  <div class="filter-group" id="categoryFilters"></div>
  <span class="filter-label">Level:</span>
  <div class="filter-group" id="levelFilters"></div>
  <span class="filter-label">Type:</span>
  <div class="filter-group" id="typeFilters"></div>
  <span class="job-count" id="jobCount"></span>
</div>

<div class="job-list" id="jobList"></div>
<div class="loading" id="loading" style="display:none">Loading jobs...</div>
<div class="empty-state" id="empty" style="display:none">
  <p>No jobs found. Try different filters or check back after the next daily sync.</p>
</div>

<div class="pagination" id="pagination"></div>

<footer>
  Bulk Jobs — aggregated daily from Greenhouse, Lever, Ashby, Workable, Breezy, Recruitee, SmartRecruiters & Personio.<br>
  Curated for business, research, economics & writing roles. Updated every 24 hours.
</footer>
</div>

<script>
const API = '/api/jobs';
let currentPage = 0, limit = 100, totalJobs = 0;
let activeFilters = { category:'all', level:'all', jobType:'all' };
let searchTimer;

const categories = [
  {key:'all',label:'All'},
  {key:'business',label:'Business'},
  {key:'research',label:'Research'},
  {key:'economics',label:'Economics'},
  {key:'writing',label:'Writing'},
  {key:'data',label:'Data'},
  {key:'climate',label:'Climate'},
  {key:'finance',label:'Finance'},
];
const levels = [
  {key:'all',label:'All Levels'},
  {key:'entry',label:'Entry'},
  {key:'mid',label:'Mid'},
];
const types = [
  {key:'all',label:'All Types'},
  {key:'full-time',label:'Full-Time'},
  {key:'contract',label:'Contract'},
  {key:'freelance',label:'Freelance'},
  {key:'part-time',label:'Part-Time'},
];

function renderFilterChips(containerId, items, key){
  const el = document.getElementById(containerId);
  el.innerHTML = items.map(i =>
    '<button class="filter-chip'+(activeFilters[key]===i.key?' active':'')+
    '" onclick="setFilter(\`'+key+'\`,\`'+i.key+'\`)">'+i.label+'</button>'
  ).join('');
}

renderFilterChips('categoryFilters', categories, 'category');
renderFilterChips('levelFilters', levels, 'level');
renderFilterChips('typeFilters', types, 'jobType');

function setFilter(key, val){
  activeFilters[key] = val;
  renderFilterChips(key==='category'?'categoryFilters':key==='level'?'levelFilters':'typeFilters',
    key==='category'?categories:key==='level'?levels:types, key);
  currentPage = 0;
  loadJobs();
}

function debounceSearch(){
  clearTimeout(searchTimer);
  searchTimer = setTimeout(()=>{ currentPage=0; loadJobs(); }, 300);
}

async function loadStats(){
  try{
    const r = await fetch('/api/stats');
    const s = await r.json();
    document.getElementById('stats').innerHTML =
      '<div class="stat"><strong>'+s.totalJobs+'</strong><span>total jobs</span></div>'+
      '<div class="stat"><strong>'+s.newToday+'</strong><span>new today</span></div>'+
      (s.lastFetch ? '<div class="stat"><span>last sync: '+new Date(s.lastFetch+'Z').toLocaleString()+'</span></div>' : '');
  }catch(e){}
}

async function loadJobs(){
  const search = document.getElementById('search').value;
  document.getElementById('loading').style.display = 'block';
  document.getElementById('jobList').innerHTML = '';
  document.getElementById('empty').style.display = 'none';

  const params = new URLSearchParams({limit:String(limit), offset:String(currentPage*limit)});
  if(search) params.set('search', search);
  for(const [k,v] of Object.entries(activeFilters)){ if(v!=='all') params.set(k,v); }

  try{
    const r = await fetch(API+'?'+params);
    const data = await r.json();
    totalJobs = data.total || 0;
    document.getElementById('loading').style.display = 'none';
    document.getElementById('jobCount').textContent = totalJobs+' jobs';

    if(!data.jobs || data.jobs.length===0){
      document.getElementById('empty').style.display = 'block';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    document.getElementById('jobList').innerHTML = data.jobs.map(j => {
      const levelBadge = j.level==='entry'?'badge-entry':j.level==='mid'?'badge-mid':'badge-senior';
      const typeBadge = j.job_type==='freelance'?'badge-freelance':j.job_type==='contract'?'badge-contract':'';
      return '<div class="job-row" onclick="toggleDetail(\`'+j.id+'\')">'+
        '<div class="title-col">'+esc(j.title)+'</div>'+
        '<div class="company-col">'+esc(j.company)+'</div>'+
        '<div class="location-col">'+esc(j.location)+'</div>'+
        '<div class="source-col">'+j.source+'</div>'+
        '<div class="score-badge">'+
          '<span class="badge '+levelBadge+'">'+j.level+'</span> '+
          (typeBadge?'<span class="badge '+typeBadge+'">'+j.job_type+'</span>':'')+
        '</div>'+
        '<div class="job-detail" id="detail-'+j.id+'">'+
          '<h3>'+esc(j.title)+' at '+esc(j.company)+'</h3>'+
          '<div class="meta">'+
            '<span>📍 '+esc(j.location)+'</span>'+
            '<span>🏷 '+j.category+'</span>'+
            '<span>📊 '+j.level+'</span>'+
            '<span>💼 '+j.job_type+'</span>'+
            '<span>📡 '+j.source+'</span>'+
            (j.posted_date?'<span>📅 '+new Date(j.posted_date).toLocaleDateString()+'</span>':'')+
          '</div>'+
          '<div class="desc">'+esc(j.description).substring(0,2000)+'</div>'+
          '<a href="'+esc(j.url)+'" target="_blank" class="apply-btn" onclick="event.stopPropagation()">Apply →</a>'+
        '</div>'+
      '</div>';
    }).join('');

    renderPagination();
  }catch(e){
    document.getElementById('loading').style.display = 'none';
    document.getElementById('jobList').innerHTML = '<div class="empty-state"><p>Error loading jobs.</p></div>';
  }
}

function esc(s){ if(!s) return ''; const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

function toggleDetail(id){
  const el = document.getElementById('detail-'+id);
  if(!el) return;
  const wasOpen = el.classList.contains('open');
  document.querySelectorAll('.job-detail.open').forEach(d=>d.classList.remove('open'));
  if(!wasOpen) el.classList.add('open');
}

function renderPagination(){
  const totalPages = Math.ceil(totalJobs/limit);
  if(totalPages<=1){ document.getElementById('pagination').innerHTML=''; return; }
  let html = '<button onclick="goPage(0)"'+(currentPage===0?' disabled':'')+'>First</button>';
  html += '<button onclick="goPage('+(currentPage-1)+')"'+(currentPage===0?' disabled':'')+'>Prev</button>';
  const start = Math.max(0, currentPage-2);
  const end = Math.min(totalPages, start+5);
  for(let i=start; i<end; i++){
    html += '<button onclick="goPage('+i+')" class="'+(i===currentPage?'active':'')+'">'+(i+1)+'</button>';
  }
  html += '<span>of '+totalPages+'</span>';
  html += '<button onclick="goPage('+(currentPage+1)+')"'+(currentPage>=totalPages-1?' disabled':'')+'>Next</button>';
  html += '<button onclick="goPage('+(totalPages-1)+')"'+(currentPage>=totalPages-1?' disabled':'')+'>Last</button>';
  document.getElementById('pagination').innerHTML = html;
}

function goPage(n){
  const totalPages = Math.ceil(totalJobs/limit);
  if(n<0||n>=totalPages) return;
  currentPage = n;
  loadJobs();
  window.scrollTo(0,0);
}

loadStats();
loadJobs();
</script>
</body>
</html>`;

// =============================================================================
// Main fetch handler
// =============================================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // API routes
    if (path === '/api/jobs') return handleApiJobs(env, url);
    if (path === '/api/stats') return handleApiStats(env);
    if (path === '/api/trigger') return handleApiTrigger(env);

    // Health check
    if (path === '/api/health') {
      return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // Serve frontend for all other routes
    return new Response(FRONTEND_HTML, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await handleScheduled(env);
  },
};
