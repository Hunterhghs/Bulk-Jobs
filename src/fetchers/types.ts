// Common types for all ATS fetchers

import type { ScoredJob } from '../filter';

export interface FetcherResult {
  jobs: ScoredJob[];
  errors: string[];
  companyId: string;
}

export interface AtsFetcher {
  fetch(company: { id: string; name: string; boardToken: string; category: string; region: string }, timeout: number): Promise<FetcherResult>;
}
