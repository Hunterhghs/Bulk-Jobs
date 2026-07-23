// Keyword scoring engine for Hunter Hughes' profile
// Scores each job for relevance to: Business, Research, Economics, Writing, Data, Climate, Finance

export interface JobInput {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  applyUrl?: string;
  postedDate?: string;
  source: string;
}

export interface ScoredJob extends JobInput {
  category: string;
  jobType: string;
  level: string;
  region: string;
  relevanceScore: number;
  matchReasons: string[];
}

// Category keyword maps — weighted by relevance
const CATEGORY_KEYWORDS: Record<string, { keywords: string[]; weight: number }> = {
  business: {
    keywords: [
      'business', 'strategy', 'strategic', 'operations', 'operational', 'consulting',
      'management consultant', 'business development', 'bizdev', 'business analyst',
      'business operations', 'chief of staff', 'business intelligence',
      'go-to-market', 'gtm', 'revenue operations', 'revops', 'sales operations',
      'corporate development', 'corp dev', 'venture', 'partnerships', 'alliances',
    ],
    weight: 1.0,
  },
  research: {
    keywords: [
      'research', 'researcher', 'research analyst', 'research associate',
      'policy research', 'policy analyst', 'policy', 'think tank',
      'market research', 'market intelligence', 'competitive intelligence',
      'survey', 'qualitative', 'quantitative', 'methodology', 'evaluation',
      'monitoring and evaluation', 'm&e', 'impact evaluation',
      'social science', 'behavioral science', 'behavioral economics',
      'foresight', 'futures', 'horizon scanning', 'scenario planning',
      'geopolitical', 'geopolitics', 'political risk', 'country risk',
      'due diligence', 'investigative', 'open source intelligence', 'osint',
    ],
    weight: 1.0,
  },
  economics: {
    keywords: [
      'economics', 'economist', 'economic', 'economy', 'macroeconomic',
      'microeconomic', 'econometrics', 'statistical', 'statistics',
      'development economics', 'development', 'international development',
      'emerging markets', 'frontier markets', 'global development',
      'trade', 'trade policy', 'industrial policy', 'fiscal policy',
      'monetary policy', 'central bank', 'public finance',
      'infrastructure', 'urban planning', 'regional development',
      'economic development', 'economic growth', 'convergence',
      'supply chain', 'logistics', 'procurement', 'commodities',
    ],
    weight: 1.0,
  },
  writing: {
    keywords: [
      'writer', 'writing', 'editor', 'editorial', 'content', 'copywriter',
      'copywriting', 'journalist', 'journalism', 'reporter', 'correspondent',
      'communications', 'communications specialist', 'communications manager',
      'public relations', 'pr', 'media relations', 'press',
      'storyteller', 'storytelling', 'narrative', 'ghostwriter',
      'newsletter', 'blog', 'blogger', 'substack', 'publishing',
      'technical writer', 'technical writing', 'documentation',
      'proposal writer', 'grant writer', 'grant writing', 'fundraising',
      'speech writer', 'speechwriting', 'script', 'scriptwriter',
    ],
    weight: 1.0,
  },
  data: {
    keywords: [
      'data analyst', 'data analysis', 'data analytics', 'data science',
      'data scientist', 'data engineer', 'data visualization', 'data viz',
      'business intelligence', 'bi analyst', 'bi developer',
      'analytics', 'dashboard', 'reporting', 'metrics', 'kpi',
      'sql', 'excel', 'tableau', 'power bi', 'looker', 'python',
      'statistics', 'statistical', 'modeling', 'forecasting',
      'database', 'data management', 'data governance', 'data quality',
    ],
    weight: 0.8,
  },
  climate: {
    keywords: [
      'climate', 'climate change', 'climate tech', 'climate policy',
      'sustainability', 'sustainable', 'esg', 'environmental',
      'renewable energy', 'clean energy', 'green energy', 'solar', 'wind',
      'energy transition', 'decarbonization', 'carbon', 'net zero',
      'electric vehicle', 'ev', 'battery', 'energy storage',
      'circular economy', 'green', 'conservation', 'biodiversity',
      'environment', 'ecology', 'ecological',
      'resilience', 'adaptation', 'mitigation',
    ],
    weight: 0.9,
  },
  finance: {
    keywords: [
      'finance', 'financial', 'fintech', 'banking', 'investment',
      'investor', 'asset management', 'wealth management', 'portfolio',
      'trading', 'capital markets', 'private equity', 'venture capital',
      'hedge fund', 'fund', 'fundraising',
      'risk', 'risk management', 'compliance', 'regulatory',
      'accounting', 'accountant', 'audit', 'tax', 'treasury',
      'insurance', 'insurtech', 'underwriting', 'actuarial',
      'crypto', 'cryptocurrency', 'blockchain', 'defi', 'web3',
      'payments', 'lending', 'credit',
    ],
    weight: 0.7,
  },
};

// Level detection
const LEVEL_PATTERNS = {
  entry: [
    'entry level', 'entry-level', 'junior', 'jr.', 'associate',
    'trainee', 'intern', 'internship', 'apprentice', 'graduate',
    'new grad', 'new graduate', '0-1 year', '0-2 year',
    'early career', 'emerging talent', 'no experience',
  ],
  mid: [
    'mid level', 'mid-level', 'midweight', '2-4 year', '3-5 year',
    'specialist', 'coordinator', 'senior associate',
    'experienced', 'professional',
  ],
  senior: [
    'senior', 'sr.', 'lead', 'principal', 'staff',
    'manager', 'head of', 'director', 'vp', 'vice president',
    'chief', 'cxo', 'executive', '5+ year', '7+ year', '10+ year',
    'avp', 'assistant vice president',
  ],
};

// Region detection
const REGION_PATTERNS: Record<string, RegExp[]> = {
  US: [/united states/i, /\bus\b/i, /\busa\b/i, /america/i, /new york/i, /san francisco/i,
    /chicago/i, /austin/i, /boston/i, /seattle/i, /los angeles/i, /washington dc/i,
    /miami/i, /denver/i, /atlanta/i, /portland/i, /dallas/i, /philadelphia/i],
  UK: [/united kingdom/i, /\buk\b/i, /london/i, /manchester/i, /edinburgh/i,
    /birmingham/i, /bristol/i, /cambridge/i, /oxford/i, /glasgow/i],
  EU: [/europe/i, /germany/i, /france/i, /spain/i, /italy/i, /netherlands/i,
    /sweden/i, /denmark/i, /finland/i, /norway/i, /switzerland/i, /belgium/i,
    /austria/i, /ireland/i, /portugal/i, /poland/i, /czech/i, /romania/i,
    /berlin/i, /paris/i, /madrid/i, /barcelona/i, /amsterdam/i, /stockholm/i,
    /copenhagen/i, /helsinki/i, /dublin/i, /lisbon/i, /warsaw/i, /prague/i,
    /brussels/i, /vienna/i, /zurich/i, /milan/i, /rome/i, /munich/i],
  Global: [/remote/i, /anywhere/i, /global/i, /worldwide/i],
};

// Job type patterns
const JOB_TYPE_PATTERNS: Record<string, RegExp[]> = {
  'full-time': [/full.time/i, /fulltime/i, /permanent/i],
  'contract': [/contract/i, /temporary/i, /temp/i, /fixed term/i, /fixed-term/i],
  'freelance': [/freelance/i, /freelancer/i, /independent contractor/i, /self.employed/i],
  'part-time': [/part.time/i, /parttime/i],
  'internship': [/internship/i, /intern\b/i, /apprentice/i],
};

function textSearch(text: string, keywords: string[]): { matches: string[]; score: number } {
  const lower = text.toLowerCase();
  const matches: string[] = [];
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) {
      matches.push(kw);
      score += 1;
    }
  }
  return { matches, score };
}

function classifyCategory(title: string, description: string): { category: string; matches: string[]; score: number } {
  const combinedText = `${title} ${description}`;
  let bestCategory = 'other';
  let bestScore = 0;
  let allMatches: string[] = [];

  for (const [cat, { keywords, weight }] of Object.entries(CATEGORY_KEYWORDS)) {
    const { matches, score } = textSearch(combinedText, keywords);
    const weightedScore = score * weight;
    if (weightedScore > bestScore) {
      bestScore = weightedScore;
      bestCategory = cat;
      allMatches = matches;
    }
  }

  return { category: bestCategory, matches: allMatches, score: bestScore };
}

function classifyLevel(title: string): string {
  const lower = title.toLowerCase();

  // Check senior first (most specific patterns)
  for (const pattern of LEVEL_PATTERNS.senior) {
    if (lower.includes(pattern)) return 'senior';
  }

  // Check mid
  for (const pattern of LEVEL_PATTERNS.mid) {
    if (lower.includes(pattern)) return 'mid';
  }

  // Check entry
  for (const pattern of LEVEL_PATTERNS.entry) {
    if (lower.includes(pattern)) return 'entry';
  }

  return 'unknown';
}

function classifyRegion(location: string, description: string): string {
  const combinedText = `${location} ${description}`;

  for (const [region, patterns] of Object.entries(REGION_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(combinedText)) return region;
    }
  }

  return 'Global'; // Default to Global (remote-friendly)
}

function classifyJobType(title: string, description: string): string {
  const combinedText = `${title} ${description}`;

  for (const [type, patterns] of Object.entries(JOB_TYPE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(combinedText)) return type;
    }
  }

  return 'full-time'; // Default
}

function computeRelevanceScore(
  title: string,
  description: string,
  category: string,
  level: string,
  jobType: string,
): number {
  let score = 0;
  const lowerTitle = title.toLowerCase();
  const lowerDesc = description.toLowerCase();

  // Category match bonus
  if (category !== 'other') score += 10;

  // Level bonus: prefer entry/junior, penalize senior
  if (level === 'entry') score += 15;
  else if (level === 'mid') score += 8;
  else if (level === 'senior') score -= 10;

  // Job type bonus: favor contract/freelance
  if (jobType === 'freelance') score += 10;
  else if (jobType === 'contract') score += 8;
  else if (jobType === 'part-time') score += 4;
  else if (jobType === 'internship') score += 6;

  // Remote keyword bonus
  if (lowerTitle.includes('remote') || lowerDesc.includes('remote')) score += 5;

  // Analyst/researcher keyword bonus (Hunter's core profile)
  const corePatterns = [
    'analyst', 'researcher', 'research', 'writer', 'editor',
    'economics', 'policy', 'strategy', 'intelligence',
    'consultant', 'associate', 'specialist', 'coordinator',
  ];
  for (const p of corePatterns) {
    if (lowerTitle.includes(p)) score += 3;
  }

  // Penalize highly technical roles not matching Hunter's profile
  const excludePatterns = [
    'software engineer', 'full stack', 'devops', 'sre', 'site reliability',
    'backend', 'frontend', 'mobile developer', 'ux designer', 'product designer',
    'graphic designer', 'video editor', 'photographer',
    'customer support', 'customer success', 'account executive', 'sales development',
    'nurse', 'physician', 'doctor', 'therapist',
  ];
  for (const p of excludePatterns) {
    if (lowerTitle.includes(p)) score -= 20;
  }

  // Description length: prefer jobs with meaningful descriptions
  if (description.length > 200) score += 3;
  if (description.length < 20) score -= 5;

  return Math.max(0, score);
}

export function scoreJob(job: JobInput): ScoredJob {
  const { category, matches: catMatches, score: catScore } = classifyCategory(job.title, job.description);
  const level = classifyLevel(job.title);
  const region = classifyRegion(job.location, job.description);
  const jobType = classifyJobType(job.title, job.description);
  const relevanceScore = computeRelevanceScore(job.title, job.description, category, level, jobType);

  return {
    ...job,
    category,
    jobType,
    level,
    region,
    relevanceScore,
    matchReasons: catMatches.slice(0, 8),
  };
}

// Determine if a job is worth keeping for Hunter
export function shouldKeep(job: ScoredJob): boolean {
  // Always keep jobs with good relevance
  if (job.relevanceScore >= 10) return true;

  // Drop senior-level jobs unless they're highly relevant
  if (job.level === 'senior' && job.relevanceScore < 20) return false;

  // Always keep business/research/economics/writing
  if (['business', 'research', 'economics', 'writing'].includes(job.category) && job.relevanceScore >= 5) return true;

  // Keep climate/data/finance only if scored decently
  if (['climate', 'data', 'finance'].includes(job.category) && job.relevanceScore >= 12) return true;

  return false;
}
