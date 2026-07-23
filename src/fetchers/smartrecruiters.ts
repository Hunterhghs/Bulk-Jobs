// SmartRecruiters job board fetcher
// API: https://api.smartrecruiters.com/v1/companies/{boardToken}/postings

import { scoreJob } from '../filter';
import type { FetcherResult } from './types';
import type { JobInput } from '../filter';

interface SmartRecruitersJob {
  id: string;
  name: string;
  company?: { name: string };
  location?: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
  };
  department?: { label: string };
  typeOfEmployment?: { label: string };
  jobAd: {
    sections: {
      description?: { text: string };
      qualifications?: { text: string };
    };
  };
  applyUrl?: string;
  releasedDate?: string;
  customField?: { fieldName: string; value: string }[];
}

interface SmartRecruitersResponse {
  content: SmartRecruitersJob[];
  totalFound: number;
}

export async function fetchSmartRecruiters(
  company: { id: string; name: string; boardToken: string; category: string; region: string },
  timeout: number,
): Promise<FetcherResult> {
  const errors: string[] = [];
  const jobs: JobInput[] = [];

  try {
    const url = `https://api.smartrecruiters.com/v1/companies/${company.boardToken}/postings`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) {
      errors.push(`SmartRecruiters ${company.boardToken}: HTTP ${response.status}`);
      return { jobs: [], errors, companyId: company.id };
    }

    const data = await response.json() as SmartRecruitersResponse;

    for (const job of (data.content || [])) {
      const description = [
        job.jobAd?.sections?.description?.text || '',
        job.jobAd?.sections?.qualifications?.text || '',
      ].join(' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

      const locationStr = [
        job.location?.city,
        job.location?.region,
        job.location?.country,
      ].filter(Boolean).join(', ') || 'Remote';

      const finalLocation = job.location?.remote ? `Remote - ${locationStr}` : locationStr;

      jobs.push({
        id: `sr-${job.id}`,
        title: job.name,
        company: job.company?.name || company.name,
        location: finalLocation,
        description: description.substring(0, 5000),
        url: job.applyUrl || `https://jobs.smartrecruiters.com/${company.boardToken}/${job.id}`,
        applyUrl: job.applyUrl || `https://jobs.smartrecruiters.com/${company.boardToken}/${job.id}`,
        postedDate: job.releasedDate || '',
        source: 'smartrecruiters',
      });
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      errors.push(`SmartRecruiters ${company.boardToken}: timeout`);
    } else {
      errors.push(`SmartRecruiters ${company.boardToken}: ${err.message}`);
    }
  }

  const scoredJobs = jobs.map(scoreJob);
  return { jobs: scoredJobs, errors, companyId: company.id };
}
