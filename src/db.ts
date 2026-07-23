// D1 database operations for job storage and retrieval

import type { ScoredJob } from './filter';

export interface D1Result<T> {
  results: T[];
  success: boolean;
  meta?: { duration: number; rows_read: number; rows_written: number };
}

export interface JobRow {
  id: string;
  title: string;
  company: string;
  company_id: string;
  location: string;
  description: string;
  description_html: string;
  url: string;
  apply_url: string;
  posted_date: string;
  fetched_at: string;
  source: string;
  category: string;
  job_type: string;
  level: string;
  region: string;
  relevance_score: number;
  is_new: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CompanyRow {
  id: string;
  name: string;
  ats: string;
  board_token: string;
  category: string;
  region: string;
  is_active: number;
  last_fetched_at: string | null;
  job_count: number;
}

export interface FetchLogRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  source: string;
  companies_fetched: number;
  jobs_found: number;
  jobs_new: number;
  jobs_updated: number;
  errors: string | null;
  status: string;
}

export interface StatsResult {
  totalJobs: number;
  newToday: number;
  byCategory: Record<string, number>;
  byLevel: Record<string, number>;
  bySource: Record<string, number>;
  byType: Record<string, number>;
  lastFetch: string | null;
}

// Upsert a single scored job into the database
export function upsertJobStmt(job: ScoredJob): { sql: string; params: any[] } {
  return {
    sql: `
      INSERT INTO jobs (id, title, company, company_id, location, description, description_html, url, apply_url, posted_date, source, category, job_type, level, region, relevance_score, is_new, is_active, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, 1, 1, datetime('now'))
      ON CONFLICT(url) DO UPDATE SET
        title = ?2,
        company = ?3,
        location = ?5,
        description = ?6,
        description_html = ?7,
        apply_url = ?9,
        posted_date = ?10,
        source = ?11,
        category = ?12,
        job_type = ?13,
        level = ?14,
        region = ?15,
        relevance_score = ?16,
        updated_at = datetime('now'),
        is_active = 1
    `,
    params: [
      job.id, job.title, job.company, job.source + '-' + job.company.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      job.location, job.description, '', job.url, job.applyUrl || '', job.postedDate || '',
      job.source, job.category, job.jobType, job.level, job.region, job.relevanceScore,
    ],
  };
}

// Build a batched upsert for many jobs
export function batchUpsertJobs(jobs: ScoredJob[]): { sql: string; params: any[] }[] {
  return jobs.map(upsertJobStmt);
}

// Mark all existing jobs as not-new (call before a fresh fetch)
export const MARK_ALL_NOT_NEW = `UPDATE jobs SET is_new = 0 WHERE is_new = 1`;

// Deactivate stale jobs (not updated in 7 days)
export const DEACTIVATE_STALE = `
  UPDATE jobs SET is_active = 0
  WHERE is_active = 1 AND updated_at < datetime('now', '-7 days')
`;

// Query jobs with filters
export function buildJobsQuery(params: {
  search?: string;
  category?: string;
  level?: string;
  source?: string;
  jobType?: string;
  region?: string;
  minScore?: number;
  sort?: string;
  limit?: number;
  offset?: number;
}): { sql: string; params: any[] } {
  const conditions: string[] = ['is_active = 1'];
  const sqlParams: any[] = [];

  if (params.search) {
    conditions.push(`(title LIKE ?${sqlParams.length + 1} OR description LIKE ?${sqlParams.length + 2} OR company LIKE ?${sqlParams.length + 3})`);
    const searchTerm = `%${params.search}%`;
    sqlParams.push(searchTerm, searchTerm, searchTerm);
  }

  if (params.category && params.category !== 'all') {
    conditions.push(`category = ?${sqlParams.length + 1}`);
    sqlParams.push(params.category);
  }

  if (params.level && params.level !== 'all') {
    conditions.push(`level = ?${sqlParams.length + 1}`);
    sqlParams.push(params.level);
  }

  if (params.source && params.source !== 'all') {
    conditions.push(`source = ?${sqlParams.length + 1}`);
    sqlParams.push(params.source);
  }

  if (params.jobType && params.jobType !== 'all') {
    conditions.push(`job_type = ?${sqlParams.length + 1}`);
    sqlParams.push(params.jobType);
  }

  if (params.region && params.region !== 'all') {
    conditions.push(`region = ?${sqlParams.length + 1}`);
    sqlParams.push(params.region);
  }

  if (params.minScore && params.minScore > 0) {
    conditions.push(`relevance_score >= ?${sqlParams.length + 1}`);
    sqlParams.push(params.minScore);
  }

  // Only include entry/mid/unknown level jobs by default (not senior)
  // unless explicitly filtered
  if (!params.level || params.level === 'all') {
    conditions.push(`level != 'senior'`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  let orderBy = 'ORDER BY relevance_score DESC, posted_date DESC';
  if (params.sort === 'date') orderBy = 'ORDER BY posted_date DESC';
  else if (params.sort === 'company') orderBy = 'ORDER BY company ASC, relevance_score DESC';
  else if (params.sort === 'title') orderBy = 'ORDER BY title ASC';

  const limit = Math.min(params.limit || 100, 200);
  const offset = params.offset || 0;

  const sql = `SELECT * FROM jobs ${where} ${orderBy} LIMIT ?${sqlParams.length + 1} OFFSET ?${sqlParams.length + 2}`;
  sqlParams.push(limit, offset);

  return { sql, params: sqlParams };
}

// Build count query matching the same filters
export function buildCountQuery(params: {
  search?: string;
  category?: string;
  level?: string;
  source?: string;
  jobType?: string;
  region?: string;
}): { sql: string; params: any[] } {
  const conditions: string[] = ['is_active = 1'];
  const sqlParams: any[] = [];

  if (params.search) {
    conditions.push(`(title LIKE ?${sqlParams.length + 1} OR description LIKE ?${sqlParams.length + 2})`);
    const searchTerm = `%${params.search}%`;
    sqlParams.push(searchTerm, searchTerm);
  }
  if (params.category && params.category !== 'all') {
    conditions.push(`category = ?${sqlParams.length + 1}`);
    sqlParams.push(params.category);
  }
  if (params.level && params.level !== 'all') {
    conditions.push(`level = ?${sqlParams.length + 1}`);
    sqlParams.push(params.level);
  } else {
    conditions.push(`level != 'senior'`);
  }
  if (params.source && params.source !== 'all') {
    conditions.push(`source = ?${sqlParams.length + 1}`);
    sqlParams.push(params.source);
  }
  if (params.jobType && params.jobType !== 'all') {
    conditions.push(`job_type = ?${sqlParams.length + 1}`);
    sqlParams.push(params.jobType);
  }
  if (params.region && params.region !== 'all') {
    conditions.push(`region = ?${sqlParams.length + 1}`);
    sqlParams.push(params.region);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { sql: `SELECT COUNT(*) as total FROM jobs ${where}`, params: sqlParams };
}

// Stats queries
export const STATS_TOTAL = `SELECT COUNT(*) as count FROM jobs WHERE is_active = 1 AND level != 'senior'`;
export const STATS_NEW_TODAY = `SELECT COUNT(*) as count FROM jobs WHERE is_new = 1 AND is_active = 1 AND level != 'senior'`;
export const STATS_BY_CATEGORY = `SELECT category, COUNT(*) as count FROM jobs WHERE is_active = 1 AND level != 'senior' GROUP BY category ORDER BY count DESC`;
export const STATS_BY_LEVEL = `SELECT level, COUNT(*) as count FROM jobs WHERE is_active = 1 GROUP BY level ORDER BY count DESC`;
export const STATS_BY_SOURCE = `SELECT source, COUNT(*) as count FROM jobs WHERE is_active = 1 AND level != 'senior' GROUP BY source ORDER BY count DESC`;
export const STATS_BY_TYPE = `SELECT job_type, COUNT(*) as count FROM jobs WHERE is_active = 1 AND level != 'senior' GROUP BY job_type ORDER BY count DESC`;
export const STATS_LAST_FETCH = `SELECT finished_at FROM fetch_logs WHERE status = 'completed' AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`;

// Upsert company
export function upsertCompanyStmt(company: { id: string; name: string; ats: string; boardToken: string; category: string; region: string }): { sql: string; params: any[] } {
  return {
    sql: `
      INSERT INTO companies (id, name, ats, board_token, category, region, is_active)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
      ON CONFLICT(id) DO UPDATE SET
        name = ?2, ats = ?3, board_token = ?4, category = ?5, region = ?6,
        last_fetched_at = datetime('now'), is_active = 1
    `,
    params: [company.id, company.name, company.ats, company.boardToken, company.category, company.region],
  };
}

// Update company job count
export function updateCompanyJobCount(id: string, count: number): { sql: string; params: any[] } {
  return {
    sql: `UPDATE companies SET job_count = ?2, last_fetched_at = datetime('now') WHERE id = ?1`,
    params: [id, count],
  };
}

// Create fetch log
export const CREATE_FETCH_LOG = `
  INSERT INTO fetch_logs (source, status, started_at) VALUES (?1, 'running', datetime('now'))
`;

// Complete fetch log
export function completeFetchLog(id: number, companiesFetched: number, jobsFound: number, jobsNew: number, jobsUpdated: number, errors: string | null): { sql: string; params: any[] } {
  return {
    sql: `UPDATE fetch_logs SET finished_at = datetime('now'), companies_fetched = ?2, jobs_found = ?3, jobs_new = ?4, jobs_updated = ?5, errors = ?6, status = 'completed' WHERE id = ?1`,
    params: [id, companiesFetched, jobsFound, jobsNew, jobsUpdated, errors],
  };
}

// Get active companies by ATS
export function getCompaniesByAts(ats: string): string {
  return `SELECT * FROM companies WHERE ats = '${ats}' AND is_active = 1`;
}

// Get all active companies
export const GET_ALL_ACTIVE_COMPANIES = `SELECT * FROM companies WHERE is_active = 1`;
