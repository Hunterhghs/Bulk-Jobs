// Workable job board fetcher
// API: https://{boardToken}.workable.com/spi/v3/jobs

import { scoreJob } from '../filter';
import type { FetcherResult } from './types';
import type { JobInput } from '../filter';

interface WorkableJob {
  id: string;
  title: string;
  full_title?: string;
  shortcode?: string;
  code?: string;
  state?: string;
  department?: string;
  department_hierarchy?: { name: string }[];
  location: {
    location_str?: string;
    country?: string;
    city?: string;
    region?: string;
  };
  description?: string;
  requirements?: string;
  benefits?: string;
  employment_type?: string;
  remote?: boolean;
  application_url?: string;
  shortlink?: string;
  created_at?: string;
  published?: string;
}

interface WorkableResponse {
  jobs: WorkableJob[];
}

export async function fetchWorkable(
  company: { id: string; name: string; boardToken: string; category: string; region: string },
  timeout: number,
): Promise<FetcherResult> {
  const errors: string[] = [];
  const jobs: JobInput[] = [];

  try {
    // Workable uses subdomain: {token}.workable.com
    const url = `https://${company.boardToken}.workable.com/spi/v3/jobs?state=published`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) {
      errors.push(`Workable ${company.boardToken}: HTTP ${response.status}`);
      return { jobs: [], errors, companyId: company.id };
    }

    const data = await response.json() as WorkableResponse;

    for (const job of (data.jobs || [])) {
      const description = [
        job.description || '',
        job.requirements || '',
        job.benefits || '',
      ].join(' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

      const locationStr = job.location?.location_str ||
        [job.location?.city, job.location?.region, job.location?.country]
          .filter(Boolean).join(', ') || 'Remote';

      const finalLocation = job.remote ? `Remote - ${locationStr}` : locationStr;

      const jobUrl = job.application_url || job.shortlink ||
        `https://${company.boardToken}.workable.com/j/${job.shortcode || job.id}`;

      jobs.push({
        id: `workable-${job.id}`,
        title: job.title || job.full_title || '',
        company: company.name,
        location: finalLocation,
        description: description.substring(0, 5000),
        url: jobUrl,
        applyUrl: job.application_url || jobUrl,
        postedDate: job.published || job.created_at || '',
        source: 'workable',
      });
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      errors.push(`Workable ${company.boardToken}: timeout`);
    } else {
      errors.push(`Workable ${company.boardToken}: ${err.message}`);
    }
  }

  const scoredJobs = jobs.map(scoreJob);
  return { jobs: scoredJobs, errors, companyId: company.id };
}
