/**
 * CEO Pulse roster — current chief executives of the AI-infrastructure companies already in the terminal.
 *
 * Every name was checked against a current source (company leadership page, SEC filing / press release,
 * or reputable news) on `verifiedAt`. CEOs change: re-verify before relying on this list.
 *
 * Fields
 *   companyId  id in src/data/companies.ts or src/data/energyCompanies.ts (headlines are tied to this id)
 *   alsoIds    other terminal companies the same person runs (headline may relate to either)
 *   aliases    case-sensitive short forms accepted in a headline ONLY when the company is also named
 *              (e.g. "Nvidia's Huang"). Omitted for surnames that are common words / shared by other CEOs.
 *   queryHint  extra term added to the Google News query for common names, to cut namesakes
 *
 * Left out on purpose: Samsung Foundry (a Samsung division — covered by its DS co-CEO), Huawei (rotating
 * chairmen, no single CEO), Apple and Tesla as separate cards (Apple is a device maker; Tesla is covered by the
 * SpaceX card's CEO), and smaller energy names without data-center deals in the terminal (NuScale, Centrus,
 * Ormat, First Solar, Vestas, Neste).
 */
export interface CeoEntry {
  name: string;
  companyId: string;
  ticker: string | null;
  title: string;
  sourceUrl: string;
  verifiedAt: string;
  alsoIds?: string[];
  aliases?: string[];
  queryHint?: string;
  /** Spotlight card at the top of the panel */
  spotlight?: boolean;
}

const V = '2026-11-10';

export const CEOS: CeoEntry[] = [
  { name: 'Jensen Huang', companyId: 'nvidia', ticker: 'NVDA', title: 'Founder, President & CEO', spotlight: true, aliases: ['Huang'],
    sourceUrl: 'https://investor.nvidia.com/news/press-release-details/2026/Statement-from-NVIDIA-Board-of-Directors/', verifiedAt: V },
  // Chips & design
  { name: 'Lisa Su', companyId: 'amd', ticker: 'AMD', title: 'Chair & CEO', sourceUrl: 'https://www.amd.com/en/corporate/leadership/lisa-su.html', verifiedAt: V },
  { name: 'Lip-Bu Tan', companyId: 'intel', ticker: 'INTC', title: 'CEO', sourceUrl: 'https://www.intel.com/content/www/us/en/corporate/executive-leadership.html', verifiedAt: V },
  { name: 'Hock Tan', companyId: 'broadcom', ticker: 'AVGO', title: 'President & CEO', sourceUrl: 'https://www.broadcom.com/company/about-us/executives/hock-e-tan', verifiedAt: V },
  { name: 'Cristiano Amon', companyId: 'qualcomm', ticker: 'QCOM', title: 'President & CEO', aliases: ['Amon'],
    sourceUrl: 'https://thenextweb.com/news/qualcomm-cristiano-amon-ai-companies-phones-2028', verifiedAt: V },
  { name: 'Matt Murphy', companyId: 'marvell', ticker: 'MRVL', title: 'Chairman & CEO', queryHint: 'Marvell',
    sourceUrl: 'https://www.marvell.com/company/leadership/matt-murphy.html', verifiedAt: V },
  { name: 'Rene Haas', companyId: 'arm', ticker: 'ARM', title: 'CEO', aliases: ['Haas'], queryHint: 'Arm', sourceUrl: 'https://www.arm.com/company/leadership', verifiedAt: V },
  { name: 'Masayoshi Son', companyId: 'softbank', ticker: '9984.T', title: 'Chairman & CEO', sourceUrl: 'https://group.softbank/en/about/officer/son', verifiedAt: V },
  // Foundry & equipment
  { name: 'C.C. Wei', companyId: 'tsmc', ticker: 'TSM', title: 'Chairman & CEO', aliases: ['Wei'], queryHint: 'TSMC',
    sourceUrl: 'https://www.morningstar.com/news/marketwatch/2026101589/tsmc-ceo-sees-no-sign-of-a-slowdown-as-chip-foundry-reports-record-profit', verifiedAt: V },
  { name: 'Tim Breen', companyId: 'globalfoundries', ticker: 'GFS', title: 'CEO', queryHint: 'GlobalFoundries', sourceUrl: 'https://gf.com/about-gf/leadership/tim-breen/', verifiedAt: V },
  { name: 'Zhao Haijun', companyId: 'smic', ticker: '0981.HK', title: 'Co-CEO', sourceUrl: 'https://www.smics.com/en/site/about_team', verifiedAt: V },
  { name: 'Liang Mong Song', companyId: 'smic', ticker: '0981.HK', title: 'Co-CEO', sourceUrl: 'https://www.smics.com/en/site/about_team', verifiedAt: V },
  { name: 'Christophe Fouquet', companyId: 'asml', ticker: 'ASML', title: 'President & CEO', aliases: ['Fouquet'],
    sourceUrl: 'https://www.investor.asml.com/news-releases/news-release-details/asml-reports-eu11.7-billion-total-net-sales-and-eu5.0-billion-net-income-q3-2026', verifiedAt: V },
  { name: 'Gary Dickerson', companyId: 'amat', ticker: 'AMAT', title: 'President & CEO', aliases: ['Dickerson'],
    sourceUrl: 'https://www.appliedmaterials.com/us/en/about/leadership/executive-team/gary-dickerson.html', verifiedAt: V },
  { name: 'Tim Archer', companyId: 'lam', ticker: 'LRCX', title: 'President & CEO', queryHint: 'Lam Research',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/707549/000070754926000037/lrcx-20260628.htm', verifiedAt: V },
  { name: 'Rick Wallace', companyId: 'kla', ticker: 'KLAC', title: 'President & CEO', queryHint: 'KLA', sourceUrl: 'https://ir.kla.com/company-information/management-team', verifiedAt: V },
  { name: 'Sassine Ghazi', companyId: 'synopsys', ticker: 'SNPS', title: 'President & CEO', aliases: ['Ghazi'],
    sourceUrl: 'https://www.synopsys.com/company/management-team/sassine-ghazi-bio.html', verifiedAt: V },
  { name: 'Anirudh Devgan', companyId: 'cadence', ticker: 'CDNS', title: 'President & CEO', aliases: ['Devgan'],
    sourceUrl: 'https://www.cadence.com/en_US/home/company/leadership-team.html', verifiedAt: V },
  // Memory
  { name: 'Jun Young-hyun', companyId: 'samsung', ticker: '005930.KS', title: 'Vice Chairman & Co-CEO (Device Solutions / chips)',
    sourceUrl: 'https://www.reuters.com/world/asia-pacific/samsung-elec-names-mobile-chief-new-co-ceo-2025-11-21/', verifiedAt: V },
  { name: 'Sanjay Mehrotra', companyId: 'micron', ticker: 'MU', title: 'Chairman, President & CEO', aliases: ['Mehrotra'],
    sourceUrl: 'https://www.micron.com/about/company/leadership/sanjay-mehrotra', verifiedAt: V },
  { name: 'Kwak Noh-jung', companyId: 'skhynix', ticker: '000660.KS', title: 'President & CEO', sourceUrl: 'https://en.yna.co.kr/view/AEN20261030011900320', verifiedAt: V },
  // Cloud & hyperscalers
  { name: 'Satya Nadella', companyId: 'microsoft', ticker: 'MSFT', title: 'Chairman & CEO', aliases: ['Nadella'], sourceUrl: 'https://news.microsoft.com/source/exec/satya-nadella/', verifiedAt: V },
  { name: 'Andy Jassy', companyId: 'amazon', ticker: 'AMZN', title: 'President & CEO, Amazon', aliases: ['Jassy'],
    sourceUrl: 'https://observer.com/2026/04/amazon-andy-jassy-defends-ai-spend/', verifiedAt: V },
  { name: 'Matt Garman', companyId: 'amazon', ticker: 'AMZN', title: 'CEO, Amazon Web Services', aliases: ['Garman'], queryHint: 'AWS',
    sourceUrl: 'https://sources.news/p/aws-ceo-matt-garman-1-trillion', verifiedAt: V },
  { name: 'Sundar Pichai', companyId: 'google', ticker: 'GOOGL', title: 'CEO, Alphabet & Google', aliases: ['Pichai'],
    sourceUrl: 'https://blog.google/company-news/inside-google/message-ceo/alphabet-earnings-q3-2026/', verifiedAt: V },
  { name: 'Mark Zuckerberg', companyId: 'meta', ticker: 'META', title: 'Founder, Chairman & CEO', aliases: ['Zuckerberg'],
    sourceUrl: 'https://investor.atmeta.com/investor-news/press-release-details/2026/Meta-Reports-Third-Quarter-2026-Results/', verifiedAt: V },
  { name: 'Clay Magouyrk', companyId: 'oracle', ticker: 'ORCL', title: 'Co-CEO', aliases: ['Magouyrk'], sourceUrl: 'https://www.oracle.com/corporate/executives/', verifiedAt: V },
  { name: 'Mike Sicilia', companyId: 'oracle', ticker: 'ORCL', title: 'Co-CEO', aliases: ['Sicilia'], queryHint: 'Oracle', sourceUrl: 'https://www.oracle.com/corporate/executives/', verifiedAt: V },
  // AI labs & AI compute
  { name: 'Sam Altman', companyId: 'openai', ticker: null, title: 'CEO', aliases: ['Altman'], sourceUrl: 'https://www.cnbc.com/2026/11/02/openai-sam-altman-samsung-sk-south-korea.html', verifiedAt: V },
  { name: 'Dario Amodei', companyId: 'anthropic', ticker: null, title: 'CEO', aliases: ['Amodei'],
    sourceUrl: 'https://www.politico.com/news/2026/11/10/anthropic-seeks-1-3t-valuation-for-blockbuster-ipo-01158056', verifiedAt: V },
  { name: 'Andrew Feldman', companyId: 'cerebras', ticker: null, title: 'Co-founder & CEO', aliases: ['Feldman'],
    sourceUrl: 'https://www.cnbc.com/video/2026/05/14/cerebras-ceo-andrew-feldman-on-ipo-debut-this-is-the-right-way-to-fund-our-growth.html', verifiedAt: V },
  { name: 'Adam Winter', companyId: 'groq', ticker: null, title: 'CEO', queryHint: 'Groq',
    sourceUrl: 'https://www.businessinsider.com/groq-navigates-ai-cloud-market-shift-after-nvidia-deal-2026-9', verifiedAt: V },
  { name: 'Rodrigo Liang', companyId: 'sambanova', ticker: null, title: 'Co-founder & CEO', sourceUrl: 'https://sambanova.ai/company/about', verifiedAt: V },
  { name: 'Elon Musk', companyId: 'spacex', ticker: 'SPCX', title: 'CEO, SpaceX (also CEO of Tesla)', alsoIds: ['tesla'], aliases: ['Musk'],
    sourceUrl: 'https://www.cnbc.com/2026/11/06/spacex-is-down-big-on-dem-retribution-fears-against-musk-deutsche-bank-says-buy-the-dip.html', verifiedAt: V },
  // Power & energy for data centers
  { name: 'Joe Dominguez', companyId: 'constellation', ticker: 'CEG', title: 'Chairman, President & CEO', aliases: ['Dominguez'], queryHint: 'Constellation',
    sourceUrl: 'https://www.constellationenergy.com/about/leadership/joseph-dominguez.html', verifiedAt: V },
  { name: 'Jim Burke', companyId: 'vistra', ticker: 'VST', title: 'President & CEO', queryHint: 'Vistra', sourceUrl: 'https://vistracorp.com/about/leadership/', verifiedAt: V },
  { name: 'Mac McFarland', companyId: 'talen', ticker: 'TLN', title: 'President & CEO (successor named for Jan 1, 2027)', aliases: ['McFarland'],
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1622536/000162253626000074/a20260929pressreleasecapac.htm', verifiedAt: V },
  { name: 'Robert Gaudette', companyId: 'nrg', ticker: 'NRG', title: 'President & CEO', aliases: ['Gaudette'],
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1013871/000110465926052882/tm2612875d2_8ka.htm', verifiedAt: V },
  { name: 'John Ketchum', companyId: 'nextera', ticker: 'NEE', title: 'Chairman, President & CEO', aliases: ['Ketchum'],
    sourceUrl: 'https://www.investor.nexteraenergy.com/corporate-governance/board-of-directors/john-w-ketchum', verifiedAt: V },
  { name: 'Bob Blue', companyId: 'dominion', ticker: 'D', title: 'Chair, President & CEO', queryHint: 'Dominion Energy',
    sourceUrl: 'https://www.vpm.org/news/2026-11-05/dominion-nextera-scc-bob-blue-electric-utility-grid/', verifiedAt: V },
  { name: 'Harry Sideris', companyId: 'duke', ticker: 'DUK', title: 'President & CEO', aliases: ['Sideris'],
    sourceUrl: 'https://www.duke-energy.com/our-company/about-us/leadership/harry-sideris', verifiedAt: V },
  { name: 'Chris Womack', companyId: 'southern', ticker: 'SO', title: 'Chairman, President & CEO', queryHint: 'Southern Company',
    sourceUrl: 'https://www.southerncompany.com/about/leadership/chris-womack.html', verifiedAt: V },
  { name: 'Scott Strazik', companyId: 'gevernova', ticker: 'GEV', title: 'CEO', aliases: ['Strazik'], sourceUrl: 'https://www.gevernova.com/company/leadership/scott-strazik', verifiedAt: V },
  { name: 'Christian Bruch', companyId: 'siemensenergy', ticker: 'ENR.DE', title: 'President & CEO', aliases: ['Bruch'],
    sourceUrl: 'https://www.siemens-energy.com/global/en/home/company/executive-board.html', verifiedAt: V },
  { name: 'KR Sridhar', companyId: 'bloom', ticker: 'BE', title: 'Founder, Chairman & CEO', aliases: ['Sridhar'],
    sourceUrl: 'https://www.powermag.com/power-honors-bloom-energys-kr-sridhar-with-2026-executive-leadership-award/', verifiedAt: V },
  { name: 'Jacob DeWitte', companyId: 'oklo', ticker: 'OKLO', title: 'Co-founder, Chairman & CEO', aliases: ['DeWitte', 'Jake DeWitte'], sourceUrl: 'https://oklo.com/about/leadership', verifiedAt: V },
  { name: 'Tim Gitzel', companyId: 'cameco', ticker: 'CCJ', title: 'CEO', aliases: ['Gitzel'], sourceUrl: 'https://www.cameco.com/about/leadership', verifiedAt: V },
  { name: 'Toby Rice', companyId: 'eqt', ticker: 'EQT', title: 'President & CEO', queryHint: 'EQT', sourceUrl: 'https://www.eqt.com/about/management/toby-z-rice', verifiedAt: V },
  { name: 'Chad Zamarin', companyId: 'williams', ticker: 'WMB', title: 'President & CEO', aliases: ['Zamarin'], sourceUrl: 'https://www.williams.com/leadership/chad-j-zamarin/', verifiedAt: V },
  { name: 'Kim Dang', companyId: 'kindermorgan', ticker: 'KMI', title: 'CEO', queryHint: 'Kinder Morgan', sourceUrl: 'https://www.kindermorgan.com/About-Us/Management', verifiedAt: V },
  { name: 'Tom Long', companyId: 'energytransfer', ticker: 'ET', title: 'Co-CEO (sole CEO once co-CEO McCrea retires by Dec 31, 2026)', queryHint: 'Energy Transfer',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1276187/000127618726000030/et-20260601.htm', verifiedAt: V },
  { name: 'Connor Teskey', companyId: 'brookfieldrenewable', ticker: 'BEP', title: 'CEO, Brookfield Renewable (also CEO, Brookfield Asset Management)', aliases: ['Teskey'],
    sourceUrl: 'https://www.brookfield.com/about-us/leadership/connor-teskey', verifiedAt: V },
  { name: 'Giordano Albertazzi', companyId: 'vertiv', ticker: 'VRT', title: 'CEO', aliases: ['Albertazzi'],
    sourceUrl: 'https://www.vertiv.com/en-us/about/about-vertiv/executives/giordano-albertazzi/', verifiedAt: V },
  { name: 'Paulo Ruiz', companyId: 'eaton', ticker: 'ETN', title: 'CEO', queryHint: 'Eaton',
    sourceUrl: 'https://www.eaton.com/us/en-us/company/about-us/leadership-team/corporate-officers/paulo-ruiz.html', verifiedAt: V },
];
