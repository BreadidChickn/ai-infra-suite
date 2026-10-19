export type Segment =
  | 'chip_designer'
  | 'foundry'
  | 'equipment'
  | 'ip'
  | 'eda'
  | 'cloud'
  | 'ai_lab'
  | 'memory'
  | 'hyperscaler'
  | 'oem'
  | 'investor'
  | 'startup'
  | 'space'
  // Energy layer — public power / fuel / grid companies with documented AI-infrastructure exposure
  | 'energy_gas'
  | 'energy_turbines'
  | 'energy_renewables'
  | 'energy_wind'
  | 'energy_nuclear'
  | 'energy_geothermal'
  | 'energy_biofuel'
  | 'energy_utility'
  | 'energy_grid';

export type RelationType =
  | 'investment'
  | 'partnership'
  | 'supplier'
  | 'customer'
  | 'ownership'
  | 'cloud_capacity'
  | 'foundry'
  | 'licensing'
  | 'competitor'
  | 'power_supply';

export interface Company {
  id: string;
  name: string;
  ticker?: string;
  /** Short display code for graph (ticker or private e.g. OPENAI) */
  shortCode?: string;
  segment: Segment;
  marketCapB: number;
  isPrivate?: boolean;
  country: string;
  summary: string;
  cik?: string;
  change1D?: number;
  change1M?: number;
  change1Q?: number;
  change6M?: number;
  changeYTD?: number;
  /** First trading day for recent IPOs — horizons that start before this have no price history. */
  ipoDate?: string;
  /** IPO offer price (USD) for since-IPO context */
  ipoPrice?: number;
  /** Source + date for the market cap / valuation used for node sizing */
  capSource?: string;
  /** Added by the user from SEC search — pending full integration into the curated data. */
  userAdded?: boolean;
  /** Energy layer: the documented AI / data-center link that justifies inclusion. */
  aiLink?: AiLink;
}

export type LinkStrength = 'strong' | 'moderate' | 'weak';

export interface AiLink {
  /** One-line description of the AI / data-center exposure */
  summary: string;
  strength: LinkStrength;
  /** Publication / filing that documents it */
  source: string;
  url: string;
  /** ISO date of the source */
  date: string;
}

export interface Relationship {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  label: string;
  detail: string;
  strength?: number;
}

export interface Headline {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  tags: string[];
  sentiment?: number;
  political?: boolean;
  theme?: string;
  spotlight?: boolean;
  /** Market ids from src/data/markets.ts (tagged by the news refresher or curated) */
  markets?: string[];
  /** Company ids mentioned */
  companies?: string[];
  category?: NewsCategory;
  /** True when fetched live from Google News on this open */
  live?: boolean;
}

export type NewsCategory = 'political' | 'investment' | 'operations' | 'other';

export interface SentimentTheme {
  id: string;
  name: string;
  score: number;
  description: string;
  headlineIds: string[];
  political: boolean;
}

export interface MarketData {
  companies: Company[];
  relationships: Relationship[];
  headlines: Headline[];
  themes: SentimentTheme[];
  asOf: string;
}

export type DataMode = 'live' | 'illustrative' | 'mixed';

export type InvestorPurpose = 'product' | 'saas' | 'capacity' | 'strategic' | 'foundry' | 'cloud_spend';

export interface OutsideInvestor {
  id: string;
  investor: string;
  investorTicker?: string;
  targetInfra: string;
  targetCompanyId?: string;
  amountUsdM: number;
  amountNote?: string;
  purpose: InvestorPurpose;
  year: number;
  sourceNote: string;
  sourceUrl?: string;
}

export interface SecFilingMeta {
  form: string;
  filedAt: string;
  description: string;
  accession?: string;
  url?: string;
}
