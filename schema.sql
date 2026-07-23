-- Jobs table: stores all fetched & filtered job listings
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  company_id TEXT NOT NULL,
  location TEXT DEFAULT 'Remote',
  description TEXT,
  description_html TEXT,
  url TEXT NOT NULL UNIQUE,
  apply_url TEXT,
  posted_date TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,
  category TEXT,
  job_type TEXT,
  level TEXT,
  region TEXT,
  relevance_score REAL DEFAULT 0.0,
  is_new INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category);
CREATE INDEX IF NOT EXISTS idx_jobs_level ON jobs(level);
CREATE INDEX IF NOT EXISTS idx_jobs_region ON jobs(region);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_date ON jobs(posted_date);
CREATE INDEX IF NOT EXISTS idx_jobs_relevance ON jobs(relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_fetched_at ON jobs(fetched_at);
CREATE INDEX IF NOT EXISTS idx_jobs_url ON jobs(url);
CREATE INDEX IF NOT EXISTS idx_jobs_active_new ON jobs(is_active, is_new);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ats TEXT NOT NULL,
  board_token TEXT NOT NULL,
  category TEXT,
  region TEXT,
  is_active INTEGER DEFAULT 1,
  last_fetched_at TEXT,
  job_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_companies_ats ON companies(ats);
CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(is_active);

CREATE TABLE IF NOT EXISTS fetch_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  source TEXT,
  companies_fetched INTEGER DEFAULT 0,
  jobs_found INTEGER DEFAULT 0,
  jobs_new INTEGER DEFAULT 0,
  jobs_updated INTEGER DEFAULT 0,
  errors TEXT,
  status TEXT DEFAULT 'running'
);

CREATE INDEX IF NOT EXISTS idx_fetch_logs_started ON fetch_logs(started_at);
