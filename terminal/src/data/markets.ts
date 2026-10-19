import type { Company, NewsCategory, Segment } from '../types';

/**
 * Markets used by the news refresher (tagging) and the Market drill-down (Markets + Sentiment tabs).
 * `keywords` tag a headline to a market even when no tracked company is named.
 * `impact` = curated "how this category of news reaches AI infrastructure" notes (no numbers).
 */
export interface MarketDef {
  id: string;
  label: string;
  short: string;
  color: string;
  energy: boolean;
  segments: Segment[];
  keywords: RegExp;
  /** What this market is, in one line */
  blurb: string;
  /** Noun phrase used by the rule-based templates: "...timelines for <aiChannel>" */
  aiChannel: string;
  impact: Record<Exclude<NewsCategory, 'other'>, string>;
}

export const MARKETS: MarketDef[] = [
  {
    id: 'chips',
    label: 'AI Chips & Semis',
    short: 'Chips',
    color: '#F5A623',
    energy: false,
    segments: ['chip_designer'],
    keywords: /\b(gpus?|ai chips?|accelerators?|semiconductors?|chipmakers?|chip stocks?|blackwell|rubin|tpus?|trainium|asics?|custom silicon|sox index)\b/i,
    blurb: 'GPU / accelerator / networking silicon designers (NVIDIA, AMD, Broadcom, Marvell, Intel, Qualcomm).',
    aiChannel: 'accelerator supply and pricing',
    impact: {
      political: 'Export controls, China licences and tariffs decide which customers can buy top-end accelerators and at what margin; Trump–Xi trade talks move this market more than any other policy item.',
      investment: 'Hyperscaler and AI-lab capex guidance is the demand signal; chip-maker earnings, buybacks and strategic stakes show whether that demand is converting into profit.',
      operations: 'New-architecture ramps (e.g. Blackwell → Rubin), CoWoS / HBM supply and yield issues set how many accelerators actually ship each quarter.',
    },
  },
  {
    id: 'foundry',
    label: 'Foundry & Packaging',
    short: 'Foundry',
    color: '#4FC3F7',
    energy: false,
    segments: ['foundry'],
    keywords: /\b(foundr(y|ies)|wafers?|2nm|3nm|1\.4nm|18a|fabs?|cowos|advanced packaging|chip plants?)\b/i,
    blurb: 'Contract chip manufacturing and advanced packaging (TSMC, Samsung Foundry, Intel Foundry, GlobalFoundries, SMIC).',
    aiChannel: 'leading-edge wafer and packaging capacity',
    impact: {
      political: 'Taiwan-strait risk, CHIPS Act grants, tariffs on imported chips and China equipment curbs shape where capacity is built and its cost.',
      investment: 'Foundry capex plans and customer prepayments indicate how much leading-edge capacity will exist 2–3 years out.',
      operations: 'Node ramps, yields and CoWoS packaging bottlenecks are the hard cap on accelerator output.',
    },
  },
  {
    id: 'equipment',
    label: 'Chip Equipment',
    short: 'Equip.',
    color: '#AB47BC',
    energy: false,
    segments: ['equipment'],
    keywords: /\b(asml|euv|lithography|applied materials|lam research|kla|chip ?equipment|chipmaking (tools|equipment)|wafer fab equipment|wfe)\b/i,
    blurb: 'Lithography, deposition, etch and inspection tools (ASML, Applied Materials, Lam Research, KLA).',
    aiChannel: 'new fab capacity',
    impact: {
      political: 'Dutch / US / Japanese export rules on tools sold to China directly change equipment revenue and the pace of Chinese capacity.',
      investment: 'Order backlogs and foundry/memory capex budgets lead tool demand by several quarters.',
      operations: 'Tool lead times and High-NA EUV adoption gate when new fabs can start producing AI chips.',
    },
  },
  {
    id: 'eda_ip',
    label: 'EDA & Chip IP',
    short: 'EDA/IP',
    color: '#26A69A',
    energy: false,
    segments: ['eda', 'ip'],
    keywords: /\b(synopsys|cadence|arm holdings|eda|chip design software|risc-v|chip ip)\b/i,
    blurb: 'Design software and licensable CPU / interface IP (Synopsys, Cadence, Arm).',
    aiChannel: 'custom-silicon design cycles',
    impact: {
      political: 'EDA and IP export restrictions to China (and their reversal) have swung revenue for these firms directly.',
      investment: 'M&A (e.g. Synopsys–Ansys) and royalty-rate changes drive valuation; custom-ASIC design starts are the demand signal.',
      operations: 'Tape-out activity and new design wins show how many custom AI chips are coming.',
    },
  },
  {
    id: 'cloud',
    label: 'Cloud & Hyperscalers',
    short: 'Cloud',
    color: '#00E676',
    energy: false,
    segments: ['cloud', 'hyperscaler'],
    keywords: /\b(hyperscalers?|cloud|azure|aws|google cloud|oci|data cent(er|re)s?|ai capex|capex|coreweave|stargate|ai factor(y|ies)|supercluster)\b/i,
    blurb: 'Microsoft, Amazon, Google, Meta, Oracle — the buyers of chips and power.',
    aiChannel: 'data-center build-outs',
    impact: {
      political: 'Antitrust, data-sovereignty rules, local data-center moratoria and who pays for grid upgrades change where and how fast campuses are built.',
      investment: 'Capex guidance is the single largest demand driver for the whole AI-infra chain, including power.',
      operations: 'Campus energization dates, GPU deliveries and outages decide when capacity becomes revenue.',
    },
  },
  {
    id: 'ai_labs',
    label: 'AI Labs & Startups',
    short: 'AI Labs',
    color: '#FF7043',
    energy: false,
    segments: ['ai_lab', 'startup'],
    keywords: /\b(openai|anthropic|chatgpt|claude|gemini|xai|grok|llms?|frontier models?|cerebras|groq|sambanova|mistral|ai startups?)\b/i,
    blurb: 'Model developers and AI-chip startups (OpenAI, Anthropic, Cerebras, Groq, SambaNova).',
    aiChannel: 'compute demand from model training and inference',
    impact: {
      political: 'AI safety / copyright regulation and US–China AI guardrail talks set the operating envelope for frontier labs.',
      investment: 'Mega funding rounds and compute contracts (cloud, chips, power) are what underwrite multi-GW build-outs.',
      operations: 'Model launches, usage growth and outages show whether compute spending is being monetised.',
    },
  },
  {
    id: 'memory',
    label: 'Memory (HBM / DRAM)',
    short: 'Memory',
    color: '#42A5F5',
    energy: false,
    segments: ['memory'],
    keywords: /\b(hbm\d?e?|dram|nand|memory chips?|micron|sk ?hynix|hynix)\b/i,
    blurb: 'High-bandwidth memory and DRAM (SK hynix, Samsung, Micron).',
    aiChannel: 'HBM supply for accelerators',
    impact: {
      political: 'Korea / US / China export rules and tariffs affect HBM shipments and Chinese memory competition.',
      investment: 'Memory capex and pricing cycles decide HBM supply 12–24 months ahead.',
      operations: 'HBM qualification, yields and sold-out capacity are a direct bottleneck on GPU shipments.',
    },
  },
  {
    id: 'space',
    label: 'Space & Orbital Compute',
    short: 'Space',
    color: '#E0E0FF',
    energy: false,
    segments: ['space'],
    keywords: /\b(spacex|starlink|spcx|starship|satellites?|orbital data cent(er|re)s?|colossus)\b/i,
    blurb: 'SpaceX (launch, Starlink and the xAI / Colossus AI segment).',
    aiChannel: 'Colossus GPU capacity and satellite connectivity',
    impact: {
      political: 'FAA launch licensing, FCC spectrum and government-contract dependence are the policy levers.',
      investment: 'Debt-funded GPU purchases and compute-rental contracts (Anthropic, Google) drive the AI segment.',
      operations: 'Launch cadence, Starship milestones and Colossus utilisation determine delivery against contracts.',
    },
  },
  {
    id: 'devices',
    label: 'Devices, OEMs & Investors',
    short: 'OEM/Inv.',
    color: '#FFEE58',
    energy: false,
    segments: ['oem', 'investor'],
    keywords: /\b(iphone|apple intelligence|softbank|vision fund|huawei|ascend|on-device ai|ai pcs?)\b/i,
    blurb: 'Apple, Tesla, Huawei and SoftBank — edge AI demand and strategic capital.',
    aiChannel: 'edge-AI demand and strategic capital',
    impact: {
      political: 'Tariffs, China market access and sanctions (Huawei) shape device demand and alternative chip ecosystems.',
      investment: 'SoftBank / sovereign capital commitments fund labs and data centers.',
      operations: 'Device launches and in-house silicon ramps drive foundry demand.',
    },
  },
  /* ------------------------------ Energy layer ------------------------------ */
  {
    id: 'utilities',
    label: 'Utilities & IPPs',
    short: 'Utilities',
    color: '#4DD0E1',
    energy: true,
    segments: ['energy_utility'],
    keywords: /\b(utilit(y|ies)|independent power producers?|ipps?|ratepayers?|rate case|large[- ]load|load growth|pjm|ercot|capacity auction|power prices|electricity (prices|demand|bills)|public service commission|psc|puc)\b/i,
    blurb: 'Regulated utilities and merchant generators that serve data-center load (NextEra, Duke, Southern, Dominion, Vistra, NRG).',
    aiChannel: 'grid power for new data-center campuses',
    impact: {
      political: 'State commissions and FERC decide who pays for grid upgrades, large-load tariffs and co-location rules; local data-center pauses (e.g. Texas) can stall interconnections.',
      investment: 'Utility capex plans and signed electric-service agreements are the clearest evidence of contracted AI load.',
      operations: 'Interconnection queues, new-build timelines and reliability events set when promised megawatts actually arrive.',
    },
  },
  {
    id: 'nuclear',
    label: 'Nuclear (Operators, SMRs, Fuel)',
    short: 'Nuclear',
    color: '#B388FF',
    energy: true,
    segments: ['energy_nuclear'],
    keywords: /\b(nuclear|reactors?|smrs?|small modular|uranium|haleu|enrichment|uprates?|three mile island|crane clean energy|westinghouse|nrc)\b/i,
    blurb: 'Nuclear fleet operators, SMR developers and fuel suppliers (Constellation, Talen, Oklo, NuScale, Cameco, Centrus).',
    aiChannel: 'firm 24/7 carbon-free power for hyperscalers (restarts by ~2027–29, uprates by ~2032, SMRs in the 2030s)',
    impact: {
      political: 'NRC licensing speed, DOE fuel programs, federal financing (e.g. the $80B Westinghouse framework) and FERC co-location rulings decide nuclear timelines.',
      investment: 'Hyperscaler PPAs and prepayments are what finance restarts, uprates and SMRs — they show which AI campuses get firm clean power.',
      operations: 'Restart milestones, uprate execution and HALEU fuel availability are the gating items for new nuclear megawatts.',
    },
  },
  {
    id: 'gas',
    label: 'Natural Gas & Midstream',
    short: 'Gas',
    color: '#FF9E40',
    energy: true,
    segments: ['energy_gas'],
    keywords: /\b(natural gas|lng|pipelines?|midstream|shale|permian|appalachia|haynesville|mmcf|bcf|henry hub|waha)\b/i,
    blurb: 'Gas producers and pipelines feeding gas-fired data-center power (EQT, Williams, Kinder Morgan, Energy Transfer).',
    aiChannel: 'the fastest-to-build bulk power for AI campuses (gas-fired plants and behind-the-meter generation)',
    impact: {
      political: 'Pipeline permitting, LNG-export policy and state siting boards determine how fast gas can reach data-center power plants.',
      investment: 'Pipeline expansion backlogs and long-term supply contracts with data centers show contracted AI gas demand.',
      operations: 'Lateral construction, production levels and gas prices (e.g. negative Waha) affect power cost and reliability.',
    },
  },
  {
    id: 'turbines',
    label: 'Gas Turbines & On-site Power',
    short: 'Turbines',
    color: '#D4E157',
    energy: true,
    segments: ['energy_turbines'],
    keywords: /\b(gas turbines?|turbine (backlog|orders|slots?)|fuel cells?|on-?site power|behind-the-meter|aeroderivative|gensets?|generators?)\b/i,
    blurb: 'Turbine OEMs and on-site power (GE Vernova, Siemens Energy, Bloom Energy).',
    aiChannel: 'data-center power timelines (turbine slots now booked into 2030–31)',
    impact: {
      political: 'Air permits, tariffs on imported components and state siting approvals affect when turbines and fuel cells can be installed.',
      investment: 'Order backlogs, slot reservations and financing frameworks (e.g. Brookfield–Bloom) show how much on-site power AI builders have locked in.',
      operations: 'Manufacturing capacity and delivery slips translate directly into later energization of AI campuses — a long turbine backlog means power, not chips, is the constraint.',
    },
  },
  {
    id: 'renewables',
    label: 'Solar & Renewables',
    short: 'Solar/Renew.',
    color: '#FFE57F',
    energy: true,
    segments: ['energy_renewables'],
    keywords: /\b(solar|renewables?|hydro(power|electric)?|battery storage|clean energy|power purchase agreements?|ppas?)\b/i,
    blurb: 'Solar module makers and renewable developers/owners (First Solar, Brookfield Renewable).',
    aiChannel: 'low-cost energy and hyperscaler clean-energy goals',
    impact: {
      political: 'Tax-credit rules, tariffs on modules and permitting reform drive renewable economics and build rates.',
      investment: 'Corporate PPAs and frameworks with hyperscalers (Microsoft, Google, Meta) are the main demand signal.',
      operations: 'Module supply, interconnection and curtailment determine how much contracted clean energy actually reaches data centers.',
    },
  },
  {
    id: 'wind',
    label: 'Wind / Turbines',
    short: 'Wind',
    color: '#80DEEA',
    energy: true,
    segments: ['energy_wind'],
    keywords: /\b(wind (farms?|power|turbines?|energy|projects?)|offshore wind|onshore wind|vestas)\b/i,
    blurb: 'Wind-turbine OEMs behind hyperscaler wind PPAs (Vestas).',
    aiChannel: 'renewable energy volumes behind hyperscaler PPAs',
    impact: {
      political: 'Offshore-wind permitting (and stop-work orders), tariffs and tax-credit changes swing order books.',
      investment: 'Hyperscaler wind PPAs signed by developers translate into turbine orders a year or two later.',
      operations: 'Turbine quality, installation vessels and grid hook-ups affect delivery of contracted wind energy.',
    },
  },
  {
    id: 'geothermal',
    label: 'Geothermal',
    short: 'Geothermal',
    color: '#FF6E6E',
    energy: true,
    segments: ['energy_geothermal'],
    keywords: /\b(geotherm\w*|enhanced geothermal|fervo)\b/i,
    blurb: 'Firm, clean geothermal power (Ormat; private peers such as Fervo are excluded).',
    aiChannel: 'firm clean power in the US West',
    impact: {
      political: 'Federal land leasing, permitting and state utility-commission approvals of PPAs gate new geothermal.',
      investment: 'Hyperscaler PPAs (Google, Switch) show willingness to pay a premium for 24/7 clean power.',
      operations: 'Drilling success and plant construction set delivery dates (most new capacity 2028–2030).',
    },
  },
  {
    id: 'biofuel',
    label: 'Biofuels / RNG',
    short: 'Biofuel',
    color: '#9CCC65',
    energy: true,
    segments: ['energy_biofuel'],
    keywords: /\b(biofuels?|renewable diesel|hvo|rng|renewable natural gas|biogas|biomethane|ethanol|sustainable aviation fuel)\b/i,
    blurb: 'Renewable diesel / RNG (Neste). THIN LINK: mostly backup-generator fuel, not bulk data-center power.',
    aiChannel: 'lower-carbon backup generation at data centers',
    impact: {
      political: 'Fuel-credit regimes (45Z, LCFS, EU RED) drive biofuel economics far more than data-center demand.',
      investment: 'Few direct AI deals exist; watch for hyperscaler HVO / RNG supply contracts as a sign the link is strengthening.',
      operations: 'Refinery output and feedstock costs set availability of renewable diesel for backup generators.',
    },
  },
  {
    id: 'grid',
    label: 'Grid & Electrical Equipment',
    short: 'Grid',
    color: '#90A4AE',
    energy: true,
    segments: ['energy_grid'],
    keywords: /\b(power grid|grid|transformers?|switchgear|transmission|interconnection|substations?|800 ?vdc|electrical equipment|power equipment|liquid cooling|ups systems?)\b/i,
    blurb: 'Data-center electrical and cooling equipment (Vertiv, Eaton).',
    aiChannel: 'getting power from the grid to the rack (transformers, switchgear, 800 VDC, cooling)',
    impact: {
      political: 'Transmission permitting, tariffs on electrical components and grid-reliability rules affect equipment lead times and costs.',
      investment: 'Equipment backlogs and acquisitions show how much data-center electrical capacity is pre-ordered.',
      operations: 'Transformer / switchgear lead times and 800 VDC adoption determine how fast new AI halls can be energized.',
    },
  },
];

export const ENERGY_MARKET_IDS: string[] = MARKETS.filter((m) => m.energy).map((m) => m.id);

export const MARKET_BY_ID: Record<string, MarketDef> = Object.fromEntries(MARKETS.map((m) => [m.id, m]));

const SEG_TO_MARKET: Partial<Record<Segment, string>> = {};
for (const m of MARKETS) for (const s of m.segments) SEG_TO_MARKET[s] = m.id;

export function marketOfSegment(s: Segment): string | undefined {
  return SEG_TO_MARKET[s];
}

export function companiesInMarket(companies: Company[], marketId: string): Company[] {
  const m = MARKET_BY_ID[marketId];
  if (!m) return [];
  return companies.filter((c) => !c.userAdded && m.segments.includes(c.segment));
}

export const CATEGORY_LABELS: Record<NewsCategory, string> = {
  political: 'Political',
  investment: 'Investment',
  operations: 'Operations / Production',
  other: 'Other',
};

export const CATEGORY_COLORS: Record<NewsCategory, string> = {
  political: '#FFB74D',
  investment: '#64B5F6',
  operations: '#81C784',
  other: '#90A4AE',
};
