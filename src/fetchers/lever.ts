// Lever job board fetcher
// API: https://api.lever.co/v0/postings/{boardToken}?mode=json

import { scoreJob } from '../filter';
import type { FetcherResult } from './types';
import type { JobInput } from '../filter';

interface LeverJob {
  id: string;
  text: string;
  categories: {
    team: string;
    location: string;
    commitment?: string;
  };
  hostedUrl: string;
  applyUrl: string;
  createdAt: number;
  descriptionPlain?: string;
  description?: string;
  lists?: { text: string; content: string }[];
}

export async function fetchLever(
  company: { id: string; name: string; boardToken: string; category: string; region: string },
  timeout: number,
): Promise<FetcherResult> {
  const errors: string[] = [];
  const jobs: JobInput[] = [];

  try {
    const url = `https://api.lever.co/v0/postings/${company.boardToken}?mode=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) {
      errors.push(`Lever ${company.boardToken}: HTTP ${response.status}`);
      return { jobs: [], errors, companyId: company.id };
    }

    const data = await response.json() as LeverJob[];

    for (const job of (data || [])) {
      const description = (job.descriptionPlain || job.description || job.text || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const location = job.categories?.location || 'Remote';
      const commitment = job.categories?.commitment || '';

      jobs.push({
        id: `lever-${job.id}`,
        title: job.text,
        company: company.name,
        location: location,
        description: description.substring(0, 5000) + (commitment ? ` | Type: ${commitment}` : ''),
        url: job.hostedUrl || job.applyUrl,
        applyUrl: job.applyUrl || job.hostedUrl,
        postedDate: job.createdAt ? new Date(job.createdAt).toISOString() : '',
        source: 'lever',
      });
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      errors.push(`Lever ${company.boardToken}: timeout`);
    } else {
      errors.push(`Lever ${company.boardToken}: ${err.message}`);
    }
  }

  const scoredJobs = jobs.map(scoreJob);
  return { jobs: scoredJobs, errors, companyId: company.id };
}
