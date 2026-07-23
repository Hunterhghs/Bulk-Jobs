// Recruitee job board fetcher
// API: https://{boardToken}.recruitee.com/api/offers

import { scoreJob } from '../filter';
import type { FetcherResult } from './types';
import type { JobInput } from '../filter';

interface RecruiteeJob {
  id: number;
  title: string;
  slug?: string;
  company_name?: string;
  department?: string;
  location?: string;
  remote?: boolean;
  description?: string;
  requirements?: string;
  offer_url?: string;
  careers_url?: string;
  created_at?: string;
  published_at?: string;
  employment_type?: string;
  options_shortcode?: string;
}

interface RecruiteeResponse {
  offers: RecruiteeJob[];
}

export async function fetchRecruitee(
  company: { id: string; name: string; boardToken: string; category: string; region: string },
  timeout: number,
): Promise<FetcherResult> {
  const errors: string[] = [];
  const jobs: JobInput[] = [];

  try {
    const url = `https://${company.boardToken}.recruitee.com/api/offers`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) {
      errors.push(`Recruitee ${company.boardToken}: HTTP ${response.status}`);
      return { jobs: [], errors, companyId: company.id };
    }

    const data = await response.json() as RecruiteeResponse;

    for (const job of (data.offers || [])) {
      const description = [
        job.description || '',
        job.requirements || '',
      ].join(' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

      const locationStr = job.location || 'Remote';
      const finalLocation = job.remote ? `Remote - ${locationStr}` : locationStr;

      const jobUrl = job.offer_url || job.careers_url ||
        `https://${company.boardToken}.recruitee.com/o/${job.slug || job.id}`;

      jobs.push({
        id: `recruitee-${job.id}`,
        title: job.title,
        company: job.company_name || company.name,
        location: finalLocation,
        description: description.substring(0, 5000),
        url: jobUrl,
        applyUrl: jobUrl,
        postedDate: job.published_at || job.created_at || '',
        source: 'recruitee',
      });
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      errors.push(`Recruitee ${company.boardToken}: timeout`);
    } else {
      errors.push(`Recruitee ${company.boardToken}: ${err.message}`);
    }
  }

  const scoredJobs = jobs.map(scoreJob);
  return { jobs: scoredJobs, errors, companyId: company.id };
}
