// Breezy HR job board fetcher
// API: https://{boardToken}.breezy.hr/json

import { scoreJob } from '../filter';
import type { FetcherResult } from './types';
import type { JobInput } from '../filter';

interface BreezyJob {
  id: string;
  name: string;
  friendly_id?: string;
  department?: string;
  location?: {
    name: string;
    country?: { name: string };
    city?: string;
  };
  type?: { name: string };
  description?: string;
  url?: string;
  published_date?: string;
  created_date?: string;
  remote?: boolean;
  education?: string;
  experience?: string;
}

export async function fetchBreezy(
  company: { id: string; name: string; boardToken: string; category: string; region: string },
  timeout: number,
): Promise<FetcherResult> {
  const errors: string[] = [];
  const jobs: JobInput[] = [];

  try {
    const url = `https://${company.boardToken}.breezy.hr/json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) {
      errors.push(`Breezy ${company.boardToken}: HTTP ${response.status}`);
      return { jobs: [], errors, companyId: company.id };
    }

    const data = await response.json() as BreezyJob[];

    for (const job of (Array.isArray(data) ? data : [])) {
      const description = (job.description || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const locationStr = job.location?.name ||
        [job.location?.city, job.location?.country?.name]
          .filter(Boolean).join(', ') || 'Remote';

      const finalLocation = job.remote ? `Remote - ${locationStr}` : locationStr;

      jobs.push({
        id: `breezy-${job.id}`,
        title: job.name,
        company: company.name,
        location: finalLocation,
        description: `${description} | Type: ${job.type?.name || 'N/A'}`.substring(0, 5000),
        url: job.url || `https://${company.boardToken}.breezy.hr/p/${job.friendly_id || job.id}`,
        applyUrl: job.url || `https://${company.boardToken}.breezy.hr/p/${job.friendly_id || job.id}`,
        postedDate: job.published_date || job.created_date || '',
        source: 'breezy',
      });
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      errors.push(`Breezy ${company.boardToken}: timeout`);
    } else {
      errors.push(`Breezy ${company.boardToken}: ${err.message}`);
    }
  }

  const scoredJobs = jobs.map(scoreJob);
  return { jobs: scoredJobs, errors, companyId: company.id };
}
