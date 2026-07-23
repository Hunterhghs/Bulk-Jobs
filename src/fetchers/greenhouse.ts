// Greenhouse job board fetcher
// API: https://boards-api.greenhouse.io/v1/boards/{boardToken}/jobs?content=true

import { scoreJob } from '../filter';
import type { FetcherResult } from './types';
import type { JobInput } from '../filter';

interface GreenhouseJob {
  id: number;
  title: string;
  location: { name: string };
  company_name: string;
  absolute_url: string;
  updated_at: string;
  departments: { name: string }[];
  offices: { name: string; location: string }[];
  content?: string;
  metadata?: { description?: string }[];
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
  meta: { total_count: number };
}

export async function fetchGreenhouse(
  company: { id: string; name: string; boardToken: string; category: string; region: string },
  timeout: number,
): Promise<FetcherResult> {
  const errors: string[] = [];
  const jobs: JobInput[] = [];

  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${company.boardToken}/jobs?content=true`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) {
      errors.push(`Greenhouse ${company.boardToken}: HTTP ${response.status}`);
      return { jobs: [], errors, companyId: company.id };
    }

    const data = await response.json() as GreenhouseResponse;

    for (const job of (data.jobs || [])) {
      // Extract description from content field or metadata
      let description = '';
      if (job.content) {
        description = job.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      } else if (job.metadata) {
        const descMeta = job.metadata.find(m => m.description);
        if (descMeta?.description) description = descMeta.description;
      }

      jobs.push({
        id: `gh-${job.id}`,
        title: job.title,
        company: job.company_name || company.name,
        location: job.location?.name || 'Remote',
        description: description.substring(0, 5000),
        url: job.absolute_url,
        applyUrl: job.absolute_url,
        postedDate: job.updated_at || '',
        source: 'greenhouse',
      });
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      errors.push(`Greenhouse ${company.boardToken}: timeout`);
    } else {
      errors.push(`Greenhouse ${company.boardToken}: ${err.message}`);
    }
  }

  const scoredJobs = jobs.map(scoreJob);
  return { jobs: scoredJobs, errors, companyId: company.id };
}
