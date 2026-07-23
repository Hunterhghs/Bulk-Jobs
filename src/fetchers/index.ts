// Fetcher router — dispatches to the correct ATS fetcher based on company config

import { fetchGreenhouse } from './greenhouse';
import { fetchLever } from './lever';
import { fetchAshby } from './ashby';
import { fetchWorkable } from './workable';
import { fetchBreezy } from './breezy';
import { fetchRecruitee } from './recruitee';
import { fetchSmartRecruiters } from './smartrecruiters';
import { fetchPersonio } from './personio';
import type { FetcherResult } from './types';

export type AtsType = 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'breezy' | 'recruitee' | 'smartrecruiters' | 'personio';

interface CompanyConfig {
  id: string;
  name: string;
  ats: AtsType;
  boardToken: string;
  category: string;
  region: string;
}

type FetcherFn = (company: CompanyConfig, timeout: number) => Promise<FetcherResult>;

const FETCHER_MAP: Record<AtsType, FetcherFn> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  workable: fetchWorkable,
  breezy: fetchBreezy,
  recruitee: fetchRecruitee,
  smartrecruiters: fetchSmartRecruiters,
  personio: fetchPersonio,
};

export function getFetcher(ats: AtsType): FetcherFn | undefined {
  return FETCHER_MAP[ats];
}

export async function fetchCompany(
  company: CompanyConfig,
  timeout: number = 8000,
): Promise<FetcherResult> {
  const fetcher = getFetcher(company.ats);
  if (!fetcher) {
    return { jobs: [], errors: [`Unknown ATS: ${company.ats}`], companyId: company.id };
  }
  return fetcher(company, timeout);
}

export { FETCHER_MAP };
