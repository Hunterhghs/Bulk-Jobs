// Ashby job board fetcher
// API: https://api.ashbyhq.com/posting-api/job-board/{boardToken}

import { scoreJob } from '../filter';
import type { FetcherResult } from './types';
import type { JobInput } from '../filter';

interface AshbyJob {
  id: string;
  title: string;
  location: string;
  department: string;
  employmentType?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  applyUrl: string;
  publishedAt?: string;
  updatedAt?: string;
  isRemote?: boolean;
}

interface AshbyResponse {
  jobs: AshbyJob[];
}

export async function fetchAshby(
  company: { id: string; name: string; boardToken: string; category: string; region: string },
  timeout: number,
): Promise<FetcherResult> {
  const errors: string[] = [];
  const jobs: JobInput[] = [];

  try {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${company.boardToken}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
    clearTimeout(timer);

    if (!response.ok) {
      errors.push(`Ashby ${company.boardToken}: HTTP ${response.status}`);
      return { jobs: [], errors, companyId: company.id };
    }

    const data = await response.json() as AshbyResponse;

    for (const job of (data.jobs || [])) {
      const description = (job.descriptionPlain || job.descriptionHtml || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const locationStr = job.isRemote ? `Remote - ${job.location || 'Anywhere'}` : (job.location || 'Remote');

      jobs.push({
        id: `ashby-${job.id}`,
        title: job.title,
        company: company.name,
        location: locationStr,
        description: description.substring(0, 5000),
        url: job.applyUrl,
        applyUrl: job.applyUrl,
        postedDate: job.publishedAt || job.updatedAt || '',
        source: 'ashby',
      });
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      errors.push(`Ashby ${company.boardToken}: timeout`);
    } else {
      errors.push(`Ashby ${company.boardToken}: ${err.message}`);
    }
  }

  const scoredJobs = jobs.map(scoreJob);
  return { jobs: scoredJobs, errors, companyId: company.id };
}
