/** CIK map and curated SEC filing fallbacks for major public AI-infra names */

export const COMPANY_CIKS: Record<string, string> = {
  nvidia: '0001045810',
  amd: '0000002488',
  intel: '0000050863',
  broadcom: '0001730168',
  qualcomm: '0000804328',
  arm: '0001973239',
  softbank: '', // JP listing — no US CIK primary
  tsmc: '0001046179',
  samsung: '', // KR listing
  globalfoundries: '0001709048',
  smic: '', // HK listing
  asml: '0000937966',
  amat: '0000006951',
  lam: '0000707549',
  kla: '0000319201',
  synopsys: '0000883241',
  cadence: '0000813672',
  microsoft: '0000789019',
  amazon: '0001018724',
  google: '0001652044',
  meta: '0001326801',
  oracle: '0001341439',
  marvell: '0001835632',
  micron: '0000723125',
  skhynix: '', // KR
  apple: '0000320193',
  tesla: '0001318605',
  spacex: '0001181412', // Space Exploration Technologies Corp — public since Jun 2026 IPO (Nasdaq: SPCX)
};

export interface CuratedFiling {
  form: string;
  filedAt: string;
  description: string;
  url: string;
}

/** Fallback filing links when live SEC API is unavailable */
export const CURATED_FILINGS: Record<string, CuratedFiling[]> = {
  nvidia: [
    {
      form: '10-K',
      filedAt: '2026-02-26',
      description: 'Annual report — data center / AI GPU revenue concentration',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810&type=10-K&dateb=&owner=include&count=10',
    },
    {
      form: '10-Q',
      filedAt: '2026-08-27',
      description: 'Quarterly report — Blackwell ramp commentary',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810&type=10-Q&dateb=&owner=include&count=10',
    },
  ],
  microsoft: [
    {
      form: '10-K',
      filedAt: '2025-07-30',
      description: 'Annual report — Azure AI / OpenAI capacity commitments',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000789019&type=10-K&dateb=&owner=include&count=10',
    },
  ],
  amd: [
    {
      form: '10-K',
      filedAt: '2026-02-04',
      description: 'Annual report — Instinct MI accelerators & data center',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000002488&type=10-K&dateb=&owner=include&count=10',
    },
  ],
  tsmc: [
    {
      form: '20-F',
      filedAt: '2026-04-15',
      description: 'Foreign annual — advanced node / AI wafer demand',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001046179&type=20-F&dateb=&owner=include&count=10',
    },
  ],
  asml: [
    {
      form: '20-F',
      filedAt: '2026-03-05',
      description: 'Foreign annual — EUV / High-NA backlog',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000937966&type=20-F&dateb=&owner=include&count=10',
    },
  ],
  broadcom: [
    {
      form: '10-K',
      filedAt: '2025-12-18',
      description: 'Annual — custom AI ASICs & networking',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001730168&type=10-K&dateb=&owner=include&count=10',
    },
  ],
  meta: [
    {
      form: '10-K',
      filedAt: '2026-01-30',
      description: 'Annual — Reality Labs / AI infra capex',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001326801&type=10-K&dateb=&owner=include&count=10',
    },
  ],
  amazon: [
    {
      form: '10-K',
      filedAt: '2026-02-06',
      description: 'Annual — AWS / Trainium capacity',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001018724&type=10-K&dateb=&owner=include&count=10',
    },
  ],
  google: [
    {
      form: '10-K',
      filedAt: '2026-02-04',
      description: 'Annual — GCP / TPU & AI infra',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001652044&type=10-K&dateb=&owner=include&count=10',
    },
  ],
  oracle: [
    {
      form: '10-K',
      filedAt: '2025-06-18',
      description: 'Annual — OCI AI cloud capacity',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001341439&type=10-K&dateb=&owner=include&count=10',
    },
  ],
  micron: [
    {
      form: '10-K',
      filedAt: '2025-10-03',
      description: 'Annual — HBM / DRAM AI demand',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000723125&type=10-K&dateb=&owner=include&count=10',
    },
  ],
  intel: [
    {
      form: '10-K',
      filedAt: '2026-01-30',
      description: 'Annual — Foundry / Gaudi / CHIPS Act',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000050863&type=10-K&dateb=&owner=include&count=10',
    },
  ],
  apple: [
    {
      form: '10-K',
      filedAt: '2025-11-01',
      description: 'Annual — custom silicon / on-device AI',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=10-K&dateb=&owner=include&count=10',
    },
  ],
  tesla: [
    {
      form: '10-K',
      filedAt: '2026-01-29',
      description: 'Annual — Dojo / AI inference',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001318605&type=10-K&dateb=&owner=include&count=10',
    },
  ],
  spacex: [
    {
      form: '10-Q',
      filedAt: '2026-08-04',
      description: 'First quarterly report (Q2 2026) — Space / Connectivity / AI segments',
      url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026052535/0001628280-26-052535-index.htm',
    },
    {
      form: '8-K',
      filedAt: '2026-08-14',
      description: 'Item 2.01 — completed Cursor (Anysphere) merger, ~389.3M Class A shares',
      url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026056945/0001628280-26-056945-index.htm',
    },
    {
      form: '8-K',
      filedAt: '2026-08-04',
      description: 'Item 2.02 — Q2 2026 earnings release',
      url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026052515/0001628280-26-052515-index.htm',
    },
    {
      form: '424B4',
      filedAt: '2026-06-12',
      description: 'Final IPO prospectus — FY2024/FY2025 audited statements (not XBRL-tagged)',
      url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026042639/0001628280-26-042639-index.htm',
    },
    {
      form: 'S-1',
      filedAt: '2026-05-20',
      description: 'IPO registration statement (amended Jun 1 & Jun 3, 2026)',
      url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026036936/0001628280-26-036936-index.htm',
    },
    {
      form: 'D',
      filedAt: '2022-08-05',
      description: 'Last Form D (private Reg D offering notice) before IPO',
      url: 'https://www.sec.gov/Archives/edgar/data/1181412/000118141222000003/0001181412-22-000003-index.htm',
    },
  ],
};

export interface FilingMilestone extends CuratedFiling {
  /** Category for colour-coding in the timeline */
  kind: 'private' | 'ipo' | 'periodic' | 'event';
}

export interface FilingProfile {
  status: string;
  asOf: string;
  /** Form-type counts from data.sec.gov submissions (recent list) */
  formCounts: Record<string, number>;
  edgarUrl: string;
  milestones: FilingMilestone[];
}

/**
 * Verified EDGAR filing history (data.sec.gov/submissions/CIK0001181412.json, checked Oct 8, 2026).
 * Used by the Financials tab when the live/snapshot submissions feed is unavailable.
 */
export const FILING_PROFILES: Record<string, FilingProfile> = {
  spacex: {
    status:
      'Public since Jun 12, 2026 (Nasdaq: SPCX; dual-listed on Nasdaq Texas). Before the IPO SpaceX filed only private-placement notices (paper Regulation D "REGDEX" 2002–2008, then Form D / D/A 2009–2022) — no periodic financial reports.',
    asOf: '2026-10-08',
    formCounts: { D: 15, 'D/A': 6, REGDEX: 4, 'REGDEX/A': 1, DRS: 1, 'DRS/A': 1, 'S-1': 1, 'S-1/A': 2, FWP: 7, '424B4': 1, '8-A12B': 2, 'S-8': 3, '8-K': 8, '10-Q': 1, '3': 10, '4': 3, '4/A': 1, '144': 1, 'SCHEDULE 13G': 4 },
    edgarUrl: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001181412&type=&dateb=&owner=include&count=40',
    milestones: [
      { kind: 'private', form: 'REGDEX', filedAt: '2002-08-19', description: 'First Regulation D notice (paper filing) — early private funding', url: 'https://www.sec.gov/Archives/edgar/data/1181412/999999999702047442/9999999997-02-047442-index.htm' },
      { kind: 'private', form: 'D', filedAt: '2009-03-31', description: 'First electronic Form D — private placement notice', url: 'https://www.sec.gov/Archives/edgar/data/1181412/000118141209000003/0001181412-09-000003-index.htm' },
      { kind: 'private', form: 'D', filedAt: '2015-01-26', description: 'Form D filed the same month Google & Fidelity’s ~$1B investment was announced (Jan 2015)', url: 'https://www.sec.gov/Archives/edgar/data/1181412/000118141215000001/0001181412-15-000001-index.htm' },
      { kind: 'private', form: 'D', filedAt: '2022-08-05', description: 'Last Form D before the IPO process', url: 'https://www.sec.gov/Archives/edgar/data/1181412/000118141222000003/0001181412-22-000003-index.htm' },
      { kind: 'ipo', form: 'DRS', filedAt: '2026-03-30', description: 'Confidential draft registration statement (made public later)', url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026021860/0001628280-26-021860-index.htm' },
      { kind: 'ipo', form: 'S-1', filedAt: '2026-05-20', description: 'Public IPO registration statement; S-1/A on Jun 1 & Jun 3', url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026036936/0001628280-26-036936-index.htm' },
      { kind: 'event', form: 'FWP', filedAt: '2026-06-05', description: 'Google Cloud Service Agreement: $920M/month Oct 2026–Jun 2029, ~110,000 NVIDIA GPUs', url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026041150/0001628280-26-041150-index.htm' },
      { kind: 'ipo', form: '424B4', filedAt: '2026-06-12', description: 'Final prospectus — 638.9M shares at $135 (net proceeds $85.7B per 10-Q)', url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026042639/0001628280-26-042639-index.htm' },
      { kind: 'event', form: '8-K', filedAt: '2026-06-23', description: 'Senior notes pricing (debt financing after IPO)', url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026044955/0001628280-26-044955-index.htm' },
      { kind: 'periodic', form: '8-K', filedAt: '2026-08-04', description: 'Q2 2026 earnings release (Item 2.02)', url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026052515/0001628280-26-052515-index.htm' },
      { kind: 'periodic', form: '10-Q', filedAt: '2026-08-04', description: 'First 10-Q (quarter ended Jun 30, 2026) — XBRL financials', url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026052535/0001628280-26-052535-index.htm' },
      { kind: 'event', form: '8-K', filedAt: '2026-08-14', description: 'Cursor (Anysphere) merger completed — $60.0B implied equity value, paid in stock', url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026056945/0001628280-26-056945-index.htm' },
    ],
  },
};
