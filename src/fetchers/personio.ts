// Personio job board fetcher
// API: https://{boardToken}.jobs.personio.com/search.json

import { scoreJob } from '../filter';
import type { FetcherResult } from './types';
import type { JobInput } from '../filter';

interface PersonioJob {
  id: number;
  name: string;
  company?: string;
  office?: string;
  department?: string;
  employment_type?: string;
  short_description?: string;
  description?: string;
  slug?: string;
  location?: string;
  remote?: boolean;
  created_at?: string;
  published_at?: string;
}

interface PersonioResponse {
  jobs: PersonioJob[];
}

export async function fetchPersonio(
  company: { id: string; name: string; boardToken: string; category: string; region: string },
  timeout: number,
): Promise<FetcherResult> {
  const errors: string[] = [];
  const jobs: JobInput[] = [];

  try {
    // Personio job board: https://{company}.jobs.personio.com/
    const url = `https://${company.boardToken}.jobs.personio.com/search.json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) {
      errors.push(`Personio ${company.boardToken}: HTTP ${response.status}`);
      return { jobs: [], errors, companyId: company.id };
    }

    const data = await response.json() as PersonioJob[] | PersonioResponse;
    const jobList = Array.isArray(data) ? data : (data.jobs || []);

    for (const job of jobList) {
      const description = (job.description || job.short_description || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const locationStr = job.office || job.location || 'Remote';
      const finalLocation = job.remote ? `Remote - ${locationStr}` : locationStr;

      jobs.push({
        id: `personio-${job.id}`,
        title: job.name,
        company: job.company || company.name,
        location: finalLocation,
        description: description.substring(0, 5000),
        url: `https://${company.boardToken}.jobs.personio.com/job/${job.id}`,
        applyUrl: `https://${company.boardToken}.jobs.personio.com/job/${job.id}`,
        postedDate: job.published_at || job.created_at || '',
        source: 'personio',
      });
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      errors.push(`Personio ${company.boardToken}: timeout`);
    } else {
      errors.push(`Personio ${company.boardToken}: ${err.message}`);
    }
  }

  const scoredJobs = jobs.map(scoreJob);
  return { jobs: scoredJobs, errors, companyId: company.id };
}
