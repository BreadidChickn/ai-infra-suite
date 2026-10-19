/**
 * Curated, qualitative context for the Financials tab. No figures here are used as data —
 * every number shown in the tab comes from SEC XBRL (live or snapshot) or is shown as N/A.
 * Notes summarise publicly reported business structure; badge: ILLUSTRATIVE (curated).
 */

import { ENERGY_FIN_NOTES } from './energyFinNotes';

export interface FinNote {
  revenueDrivers: string[];
  productService: string;
  costDrivers: string[];
  marginNote: string;
  investment: string[];
  positives: string[];
  risks: string[];
  watch: string[];
  /** Why SEC figures are N/A (non-SEC filers / private) */
  naReason?: string;
  /** Extra filing caveat, e.g. 20-F annual only */
  filingNote?: string;
}

export const FIN_NOTES: Record<string, FinNote> = {
  nvidia: {
    revenueDrivers: [
      'Data Center compute — Hopper / Blackwell GPUs and rack-scale systems sold to hyperscalers, AI labs, sovereign and enterprise buyers; the dominant revenue source.',
      'Data Center networking — NVLink, InfiniBand and Spectrum-X Ethernet attached to GPU clusters.',
      'Gaming (GeForce GPUs), Professional Visualization and Automotive/robotics are smaller, slower-growing lines.',
    ],
    productService:
      'Reports by market platform (Data Center, Gaming, ProViz, Automotive). Hardware (chips, boards, systems) is the vast majority; software & services (AI Enterprise, DGX Cloud, support) are small. No product/service split is tagged in SEC companyfacts.',
    costDrivers: [
      'Cost of revenue: TSMC wafers, CoWoS advanced packaging, HBM memory (SK hynix, Micron, Samsung), system components, plus inventory / purchase-obligation charges.',
      'R&D: GPU architectures, CUDA & AI software stack, networking silicon; heavy stock-based compensation.',
      'SG&A is a small share of revenue given concentrated customers.',
    ],
    marginNote:
      'Gross margin moves with data-center mix, new-architecture ramps (early ramps carry higher costs) and inventory charges such as China export-control write-downs.',
    investment: [
      'Fabless model keeps capex low relative to revenue (facilities, internal AI supercomputers).',
      'Ecosystem / strategic equity stakes in AI labs, GPU clouds and startups; large buybacks with a token dividend.',
    ],
    positives: ['Exceptional cash generation from a fabless, high-margin model.', 'CUDA software moat and full-stack systems lock-in.'],
    risks: [
      'Customer concentration — a handful of hyperscalers account for a large share of revenue.',
      'US export controls on China and dependence on TSMC in Taiwan.',
    ],
    watch: ['Data Center revenue guidance and hyperscaler capex plans', 'Gross margin through product transitions', 'China export-licence changes', 'CoWoS / HBM supply'],
  },
  amd: {
    revenueDrivers: [
      'Data Center — EPYC server CPUs and Instinct MI-series AI accelerators.',
      'Client — Ryzen desktop / notebook CPUs; Gaming — semi-custom console chips and Radeon GPUs.',
      'Embedded — Xilinx FPGAs and adaptive SoCs for industrial, auto, comms.',
    ],
    productService: 'Almost entirely product (chip) revenue; reports by segment (Data Center, Client, Gaming, Embedded). No current product/service split in companyfacts.',
    costDrivers: [
      'Cost of revenue: TSMC wafers, packaging, HBM for Instinct GPUs, and amortization of acquired intangibles.',
      'R&D: CPU/GPU roadmaps and ROCm software — the largest operating cost.',
      'Amortization of Xilinx / acquisition intangibles weighs on GAAP operating income.',
    ],
    marginNote: 'Mix shift toward data center lifts margins; export-control inventory charges and acquisition amortization depress GAAP margins versus non-GAAP.',
    investment: [
      'Acquisitions to build rack-scale AI systems and software (e.g. ZT Systems, Silo AI, Nod.ai).',
      'Buybacks; no dividend. Reported OpenAI GPU supply agreement includes warrants that could add shares.',
    ],
    positives: ['Credible #2 AI accelerator supplier with growing hyperscaler adoption.', 'Server CPU share gains.'],
    risks: ['Competitive pressure from NVIDIA and custom ASICs.', 'Export controls and TSMC dependence.'],
    watch: ['Instinct GPU revenue ramp', 'Data Center segment margin', 'Warrant / share-count impact from large customer deals'],
  },
  intel: {
    revenueDrivers: [
      'Client Computing — PC CPUs (Core Ultra), still the largest revenue line.',
      'Data Center & AI — Xeon server CPUs and Gaudi accelerators.',
      'Intel Foundry — mostly internal wafers today; external foundry customers are early-stage.',
    ],
    productService: 'Predominantly product revenue (CPUs, chipsets, foundry wafers). No product/service split in companyfacts.',
    costDrivers: [
      'Cost of revenue: fab depreciation, under-utilisation, new-node ramp costs and impairments.',
      'R&D: process technology (18A, 14A) and product design — very large in absolute terms.',
      'Restructuring charges from workforce reductions.',
    ],
    marginNote: 'Owning fabs makes margins sensitive to utilisation and node ramps; impairments and restructuring compressed recent margins.',
    investment: [
      'Heavy fab capex (Arizona, Ohio, Ireland) partly offset by CHIPS Act support and co-investment partners.',
      'Reported equity investments from the US government, NVIDIA and SoftBank; dividend suspended in 2024.',
    ],
    positives: ['Strategic US foundry position with government support.', 'Cost-reduction programme underway.'],
    risks: ['Execution risk on 18A/14A and winning external foundry customers.', 'Equity issuance dilutes existing holders.'],
    watch: ['External foundry customer wins', 'Gross margin recovery', 'Capex vs operating cash flow', 'Share count'],
  },
  broadcom: {
    revenueDrivers: [
      'Semiconductor solutions — custom AI accelerators (XPUs) for hyperscalers, Ethernet switching (Tomahawk / Jericho), broadband, wireless.',
      'Infrastructure software — VMware Cloud Foundation, mainframe and security software (subscription transition).',
    ],
    productService: 'Reports semiconductor (product) vs infrastructure software segments; segment splits are dimensional and not in companyfacts.',
    costDrivers: [
      'Amortization of acquired intangibles (VMware) inside cost of revenue and opex.',
      'Wafers from TSMC; R&D across silicon and software.',
    ],
    marginNote: 'High-margin software mix and declining acquisition amortization support GAAP margin expansion; custom-ASIC mix can dilute gross margin.',
    investment: ['VMware acquisition was debt-funded → ongoing debt repayment.', 'Large and rising dividends plus buybacks.'],
    positives: ['Diversified AI networking + custom silicon franchise.', 'Strong FCF supports dividends.'],
    risks: ['Customer concentration in a few hyperscalers and Apple.', 'Leverage from acquisitions.'],
    watch: ['AI semiconductor revenue', 'VMware subscription renewals', 'Debt paydown pace'],
  },
  qualcomm: {
    revenueDrivers: [
      'QCT — Snapdragon handset SoCs, plus automotive, IoT and AI PC chips.',
      'QTL — patent licensing royalties on cellular devices (high margin).',
    ],
    productService: 'QCT ≈ product, QTL ≈ licensing; segment data is dimensional, not in companyfacts.',
    costDrivers: ['Cost of revenue: foundry wafers (TSMC, Samsung), packaging/test.', 'R&D: 5G/6G modems, Oryon CPUs, on-device AI.'],
    marginNote: 'Licensing mix lifts margins; handset cycle and Apple modem insourcing pressure QCT revenue.',
    investment: ['Mostly returns capital via buybacks and dividends.', 'Bolt-on acquisitions to diversify (auto, connectivity, data center).'],
    positives: ['High-margin licensing stream.', 'Diversification into auto and PCs.'],
    risks: ['Large China handset exposure.', 'Apple moving modems in-house; Arm licensing disputes.'],
    watch: ['Auto / IoT growth', 'Apple modem revenue roll-off', 'Data-center AI chip traction'],
  },
  arm: {
    revenueDrivers: [
      'Royalties — per-chip fees from smartphones, data-center CPUs, auto and IoT; rising with Armv9 and Compute Subsystems (CSS).',
      'Licensing — upfront architecture and IP licence fees, lumpy quarter to quarter.',
    ],
    productService: 'Revenue is licensing + royalty (IP), not product vs service. Not separately tagged in companyfacts.',
    costDrivers: ['Mostly R&D engineering headcount and stock-based compensation.', 'Very low cost of revenue (IP model).'],
    marginNote: 'Near-total gross margin; operating margin depends on R&D intensity and stock comp.',
    investment: ['Light capex; SoftBank holds a controlling stake.', 'Exploring own silicon could raise capex and change the model.'],
    positives: ['Royalty base compounding across billions of chips.', 'Asset-light, high gross margin.'],
    risks: ['Controlled by SoftBank (limited float influence).', 'Arm China relationship and Qualcomm litigation.'],
    watch: ['Royalty rate uplift (v9 / CSS)', 'Data-center CPU share', 'Own-chip strategy'],
    filingNote: 'Foreign private issuer: annual 20-F plus quarterly 6-K with XBRL.',
  },
  tsmc: {
    revenueDrivers: [
      'Leading-edge wafers (3nm / 5nm / 7nm) for HPC — AI accelerators and CPUs — now the largest platform.',
      'Smartphone SoCs (Apple, Qualcomm, MediaTek); advanced packaging (CoWoS, SoIC).',
    ],
    productService: 'Essentially all revenue is wafer / packaging sales. Recent splits are not in companyfacts.',
    costDrivers: ['Fab depreciation (very large), materials, utilities and labour.', 'Overseas fabs (Arizona, Japan) carry higher costs and dilute margins.'],
    marginNote: 'Margins track utilisation, node ramps, overseas-fab dilution and TWD/USD exchange rates.',
    investment: [
      'Very heavy capex for leading-edge and packaging capacity, including multi-fab Arizona expansion.',
      'Steadily rising quarterly dividends.',
    ],
    positives: ['Near-monopoly at the leading edge for AI chips.', 'Pricing power and strong operating cash flow.'],
    risks: ['Taiwan cross-strait geopolitical risk.', 'US tariff / Section 232 policy; customer concentration (Apple, NVIDIA).'],
    watch: ['AI accelerator wafer demand', 'Overseas fab margin dilution', 'Capex guidance', 'Cross-strait tensions'],
    filingNote: 'Files 20-F annually under IFRS in TWD; quarterly results are furnished on 6-K without XBRL, so quarterly figures are N/A.',
  },
  globalfoundries: {
    revenueDrivers: ['Specialty / mature-node wafers (22FDX, RF, silicon photonics) for smart mobile, auto, IoT and comms/data center.'],
    productService: 'Wafer sales; no product/service split.',
    costDrivers: ['Fab depreciation and utilisation-driven fixed costs.', 'R&D on specialty platforms.'],
    marginNote: 'Utilisation and pricing in mature nodes (facing Chinese competition) drive margins.',
    investment: ['Capacity capex in New York, Dresden and Singapore with CHIPS Act support.', 'Majority owner Mubadala has been selling down.'],
    positives: ['Only scaled US-headquartered pure-play specialty foundry.'],
    risks: ['Mature-node price pressure from China.', 'Share-sale overhang from majority owner.'],
    watch: ['Utilisation', 'Auto / industrial recovery', 'Silicon photonics for AI data centers'],
    filingNote: 'Reports under IFRS in USD.',
  },
  asml: {
    revenueDrivers: ['System sales — EUV, High-NA EUV and DUV lithography plus metrology.', 'Installed base management — service and upgrades.'],
    productService: 'Systems (product) vs installed base (service) are disclosed in the 20-F but not tagged in companyfacts for recent years.',
    costDrivers: ['Cost of systems: Zeiss optics and complex sub-assemblies; High-NA ramp costs.', 'Large R&D programme.'],
    marginNote: 'EUV / High-NA mix and installed-base revenue drive gross margin.',
    investment: ['Capacity capex in Veldhoven; strategic stake in Mistral AI (reported).', 'Dividends and buybacks.'],
    positives: ['Monopoly in EUV lithography.', 'Recurring installed-base revenue.'],
    risks: ['Export controls limiting China sales.', 'Customer concentration (TSMC, Samsung, Intel).'],
    watch: ['Bookings', 'China normalisation', 'High-NA adoption'],
    filingNote: 'Annual 20-F in EUR (US GAAP); quarterly 6-K results are not XBRL-tagged, so quarterly figures are N/A.',
  },
  amat: {
    revenueDrivers: ['Semiconductor Systems — deposition, etch, CMP, implant, inspection tools.', 'Applied Global Services — spares, upgrades, service contracts.', 'Display.'],
    productService: 'Systems vs services are segment data, not tagged in companyfacts.',
    costDrivers: ['Manufacturing and materials; R&D for GAA, backside power, HBM tools.'],
    marginNote: 'Mix of systems vs services and China share affect margins.',
    investment: ['Buybacks and dividends; R&D centre capex.'],
    positives: ['Broadest WFE portfolio; recurring services.'],
    risks: ['Large China revenue share and export-control rules.'],
    watch: ['China revenue share', 'Leading-edge logic and DRAM tool demand'],
  },
  lam: {
    revenueDrivers: ['Etch and deposition systems for memory (NAND, DRAM/HBM) and foundry/logic.', 'Customer Support Business Group — spares, upgrades, services.'],
    productService: 'Systems vs customer support split is dimensional only.',
    costDrivers: ['Manufacturing and materials; R&D.'],
    marginNote: 'Memory capex cycle and China mix drive margins.',
    investment: ['Buybacks and dividends.'],
    positives: ['Leader in etch; leverage to NAND/HBM upgrades.'],
    risks: ['Memory capex cyclicality; China exposure.'],
    watch: ['NAND upgrade cycle', 'China share'],
  },
  kla: {
    revenueDrivers: ['Process control — wafer/reticle inspection and metrology.', 'Services on a large installed base.'],
    productService: 'Product vs service splits stopped being tagged in companyfacts after 2018.',
    costDrivers: ['Cost of revenues; R&D; SG&A.'],
    marginNote: 'Very high margins from process-control leadership.',
    investment: ['Large buybacks and dividends.'],
    positives: ['Dominant share in process control.'],
    risks: ['China exposure; WFE cyclicality.'],
    watch: ['WFE spending', 'China share'],
    filingNote: 'Operating income is not tagged; shown as derived gross profit − R&D − SG&A.',
  },
  synopsys: {
    revenueDrivers: ['EDA software (time-based licences), design IP, and simulation/analysis after the Ansys acquisition.'],
    productService: 'Mostly software licences / subscriptions; no product/service split in companyfacts.',
    costDrivers: ['R&D engineers; amortization of acquired intangibles (Ansys).'],
    marginNote: 'Ansys integration and amortization affect GAAP margins.',
    investment: ['Ansys acquisition funded with cash, debt and stock; divestitures of non-core units.'],
    positives: ['EDA duopoly with recurring revenue.'],
    risks: ['China export restrictions; integration risk.'],
    watch: ['Ansys synergies', 'Design IP segment'],
  },
  cadence: {
    revenueDrivers: ['EDA software, hardware emulation (Palladium / Protium), IP, and system design & analysis.'],
    productService: 'Product & maintenance vs services split not tagged in companyfacts for recent years.',
    costDrivers: ['R&D headcount; cost of hardware emulation systems.'],
    marginNote: 'Hardware mix lowers margins; software is high margin.',
    investment: ['Bolt-on acquisitions; buybacks; no dividend.'],
    positives: ['EDA duopoly; AI chip design tailwinds.'],
    risks: ['China export restrictions.'],
    watch: ['Emulation hardware demand', 'Recurring revenue mix'],
    filingNote: 'Cost of revenue / gross profit are not tagged as standard totals in recent filings.',
  },
  microsoft: {
    revenueDrivers: [
      'Intelligent Cloud — Azure and server products, accelerated by AI workloads.',
      'Productivity & Business Processes — Microsoft 365, LinkedIn, Dynamics (Copilot attach).',
      'More Personal Computing — Windows, Xbox / gaming, search & devices.',
    ],
    productService: 'Microsoft reports "Product" and "Service and other" revenue, but those are dimensional facts not in companyfacts.',
    costDrivers: ['Data-center depreciation, AI capacity and GPU leases in cost of revenue.', 'R&D and sales & marketing.'],
    marginNote: 'AI capacity build-out raises depreciation, pressuring cloud gross margin even as revenue grows.',
    investment: [
      'Very large capex on data centers and GPUs plus finance leases.',
      'Strategic OpenAI stake (restructured in 2025, reported); dividends and buybacks.',
    ],
    positives: ['Diversified, recurring revenue base.', 'Strong balance sheet funds AI capex.'],
    risks: ['AI capex payback; dependence on OpenAI partnership.', 'Antitrust scrutiny.'],
    watch: ['Azure growth', 'Capex vs operating cash flow', 'OpenAI economics'],
  },
  amazon: {
    revenueDrivers: ['AWS cloud (most operating profit), online stores, third-party seller services, advertising, subscriptions.'],
    productService: 'Product vs service revenue is shown in the income statement but not tagged non-dimensionally after 2018.',
    costDrivers: ['Cost of sales and fulfillment / shipping.', '"Technology and infrastructure" (Amazon\u2019s R&D-like line) uses a company-specific tag → R&D shows N/A.'],
    marginNote: 'Mix shift toward AWS and advertising drives margin expansion; AI capex depreciation is a headwind.',
    investment: ['Very heavy capex for AWS data centers and Trainium.', 'Anthropic investment (reported); no dividend.'],
    positives: ['AWS and ads are high-margin growth engines.'],
    risks: ['Capex intensity compresses free cash flow.', 'Antitrust (FTC).'],
    watch: ['AWS growth & margin', 'Capex guidance', 'Free cash flow'],
  },
  google: {
    revenueDrivers: ['Search & other ads, YouTube ads, Google Cloud, subscriptions/platforms/devices, Other Bets.'],
    productService: 'Revenue categories are dimensional; not in companyfacts.',
    costDrivers: ['Traffic acquisition costs, data-center depreciation (TPUs), content.', 'R&D and sales & marketing.'],
    marginNote: 'Cloud profitability improvement vs rising AI depreciation.',
    investment: ['Large capex for TPUs and data centers; acquisitions (e.g. Wiz, reported); Anthropic stake.', 'Dividends (since 2024) and buybacks.'],
    positives: ['Cash-rich with TPU vertical integration.'],
    risks: ['Search antitrust remedies; AI disruption of search economics.'],
    watch: ['Cloud growth & margin', 'Capex', 'Search share'],
    filingNote: 'Acquisition payments are not tagged with a standard discrete us-gaap element in recent filings → N/A.',
  },
  meta: {
    revenueDrivers: ['Family of Apps advertising (Facebook, Instagram, WhatsApp, Messenger).', 'Reality Labs hardware (small, loss-making).'],
    productService: 'Advertising vs other is dimensional; not in companyfacts.',
    costDrivers: ['Infrastructure depreciation, Reality Labs spend, headcount.', 'Legal / regulatory costs.'],
    marginNote: 'Ad growth offsets rising AI depreciation; Reality Labs losses remain a drag.',
    investment: ['Massive AI data-center capex and off-balance-sheet JV financing (reported).', 'Strategic stake in Scale AI (reported); dividends and buybacks.'],
    positives: ['Highly profitable ad engine funds AI.'],
    risks: ['Capex payback; EU regulation; Reality Labs losses.'],
    watch: ['Capex guidance', 'Ad pricing / impressions', 'Reality Labs losses'],
  },
  oracle: {
    revenueDrivers: ['Cloud services & license support (OCI, Fusion, NetSuite).', 'Cloud & on-prem licences, hardware, services.'],
    productService: 'Oracle reports expenses by function — no cost-of-revenue or gross-profit totals → N/A.',
    costDrivers: ['Cloud services & support costs, data-center depreciation.', 'R&D; sales & marketing; amortization.'],
    marginNote: 'Shift to OCI infrastructure carries lower margins than legacy licence support.',
    investment: ['Capex surge for OCI AI data centers (incl. OpenAI-linked capacity), increasingly debt-funded.', 'Dividends; reduced buybacks.'],
    positives: ['Large contracted backlog (RPO) for AI cloud.'],
    risks: ['Rising leverage and capex > operating cash flow.', 'Customer concentration in a few AI contracts.'],
    watch: ['RPO conversion', 'Capex vs OCF', 'Debt issuance'],
  },
  marvell: {
    revenueDrivers: ['Data center — custom AI ASICs for hyperscalers, electro-optics DSPs, switching.', 'Enterprise networking, carrier, consumer.'],
    productService: 'Product revenue; no split in companyfacts.',
    costDrivers: ['Amortization of acquired intangibles (Inphi, Innovium).', 'R&D.'],
    marginNote: 'Amortization historically pushed GAAP into losses; data-center mix lifts margins.',
    investment: ['Sold automotive Ethernet unit (reported); buybacks expanding.'],
    positives: ['Leverage to AI optical interconnect and custom silicon.'],
    risks: ['Concentration in a few hyperscaler programmes.'],
    watch: ['Custom ASIC ramps', 'Optics demand'],
  },
  micron: {
    revenueDrivers: ['DRAM — including high-bandwidth memory (HBM) for AI accelerators.', 'NAND flash for data center SSDs, mobile, PC, auto.'],
    productService: 'Product revenue; business-unit split is dimensional.',
    costDrivers: ['Fab depreciation and wafer costs; memory-cycle pricing.', 'R&D for DRAM nodes and HBM.'],
    marginNote: 'Memory pricing cycles drive large margin swings; HBM mix is accretive.',
    investment: ['Heavy capex for US fabs (Idaho, New York) and HBM packaging with CHIPS Act support.', 'Small dividend.'],
    positives: ['HBM demand tied to AI build-out.'],
    risks: ['Cyclicality; China restrictions; HBM competition.'],
    watch: ['DRAM / HBM pricing', 'Capex', 'Inventory'],
  },
  apple: {
    revenueDrivers: ['iPhone (largest), Mac, iPad, Wearables/Home, and Services (App Store, iCloud, ads, licensing).'],
    productService: 'Apple reports Products and Services revenue separately, but those facts are dimensional and not in companyfacts.',
    costDrivers: ['Component costs (Apple silicon from TSMC, memory), assembly; services delivery costs.', 'R&D and SG&A.'],
    marginNote: 'Services mix raises gross margin; tariffs and component costs can compress product margins.',
    investment: ['Very large buybacks and dividends.', 'Moderate capex; announced multi-year US investment commitments.'],
    positives: ['Massive FCF and capital returns.'],
    risks: ['China manufacturing and demand exposure; tariffs.', 'Search-payment antitrust remedies.'],
    watch: ['iPhone cycle', 'Services growth', 'Tariff costs'],
  },
  spacex: {
    revenueDrivers: [
      'Connectivity (Starlink) — broadband and mobile satellite service; the largest revenue segment in the Q2 2026 10-Q ($4.29B of $7.81B).',
      'AI — Grok models, X platform and Neocloud GPU hosting (xAI merged Feb 2, 2026 under common control); Q2 AI revenue $2.56B.',
      'Space — Falcon / Starship launch and spacecraft missions; Q2 revenue $0.96B.',
    ],
    productService:
      'Reports three operating segments (Space, Connectivity, AI). Product vs services is not tagged in companyfacts; Connectivity and AI cloud hosting are primarily services, Space is primarily launch/spacecraft product revenue. See Note 18 of the Q2 2026 10-Q.',
    costDrivers: [
      'Cost of revenue: launch vehicle / satellite manufacturing, Starlink terminal and network costs, and GPU / data-center cost of compute for AI cloud customers.',
      'R&D: Starship development, next-gen Starlink, Grok model training and Colossus cluster build-out — the largest expense line in recent quarters.',
      'SG&A plus share-based compensation; restructuring charges tied to the X / xAI reorganisation.',
    ],
    marginNote:
      'Connectivity is profitable; Space and AI are still loss-making on an operating basis as R&D and cluster build-out run ahead of monetisation. Gross margin expands when AI and Starlink mix rises and early-ramp hardware costs fall.',
    investment: [
      'Very heavy capex — satellites, Starship production and especially Colossus GPU data centers (≈$28.5B of PP&E purchases in H1 2026 per XBRL).',
      'IPO proceeds of ≈$85.7B (Jun 2026) plus large long-term debt issuances fund the AI infra build; Megapack energy storage purchased from Tesla (related party).',
      'Equity M&A paid in stock (Cursor / Anysphere closed Aug 14, 2026 at a $60B implied equity value per 8-K); Google and Anthropic compute hosting contracts monetise spare GPU capacity.',
    ],
    positives: [
      'Starlink scale (10,200+ satellites, 167 countries) and multi-year AI compute contracts (Anthropic, Google) give contracted revenue visibility.',
      'Vertically integrated launch + satellite + AI infra is unique among public peers.',
    ],
    risks: [
      'Key-person / related-party concentration (CEO also leads Tesla; Tesla Megapack purchases; xAI merger under common control).',
      'Very large AI capex and debt plans (reports of a further ~$40B Nvidia-chip financing) raise leverage and utilisation risk if compute demand softens.',
      'Launch and regulatory risk (FAA, spectrum, export controls) and still-negative GAAP earnings.',
    ],
    watch: [
      'AI segment revenue and utilisation of Colossus capacity',
      'Capex vs IPO cash and new debt',
      'Starship Flight milestones',
      'Cursor / Mesh Optical integration and dilution',
      'Related-party Tesla purchases',
    ],
    filingNote:
      'Public since Jun 12, 2026 (Nasdaq: SPCX). First (and so far only) 10-Q filed Aug 4, 2026 for the quarter ended Jun 30, 2026 — so Annual view is N/A until the first 10-K. Cash-flow statement is year-to-date (6 months); single-quarter cash flows are therefore N/A. Before the IPO SpaceX filed only Form D / REGDEX private-placement notices, never periodic financial reports.',
  },
  tesla: {
    revenueDrivers: ['Automotive sales and regulatory credits.', 'Energy generation & storage; services & other.'],
    productService: 'Segment splits are dimensional; not in companyfacts.',
    costDrivers: ['Vehicle and battery costs.', 'R&D on FSD, robotaxi, Optimus and AI training compute.'],
    marginNote: 'Price cuts, credit revenue and AI spending drive margin trend.',
    investment: ['Capex on factories and AI compute clusters.', 'No buybacks or dividends.'],
    positives: ['Growing energy storage business.'],
    risks: ['EV demand and pricing; regulatory credit decline.', 'Key-person risk.'],
    watch: ['Auto gross margin', 'Energy storage growth', 'AI capex'],
  },
};

const NON_SEC: Record<string, string> = {
  softbank:
    'Listed in Tokyo; files with Japan\u2019s FSA (not SEC XBRL). Financial figures N/A here — see SoftBank Group IR. Exposure via Arm stake, Vision Fund and AI infrastructure / OpenAI commitments.',
  samsung:
    'Listed in Korea (K-IFRS); not an SEC XBRL filer. Figures N/A — see Samsung Electronics IR / DART. Memory (DRAM, HBM, NAND), foundry and devices.',
  skhynix:
    'Listed in Korea (K-IFRS); not an SEC XBRL filer. Figures N/A — see SK hynix IR / DART. Leading HBM supplier to AI accelerators.',
  smic:
    'Listed in Hong Kong / Shanghai STAR; not an SEC filer since its 2019 US delisting. Figures N/A — see SMIC IR / HKEX.',
};

const PRIVATE_NOTE =
  'Private company — no periodic SEC filings, so audited revenue, cost, profit and cash-flow figures are N/A. Valuations and funding in other tabs are estimates.';

export function finNoteFor(id: string, isPrivate?: boolean): FinNote {
  const n = FIN_NOTES[id] || ENERGY_FIN_NOTES[id];
  if (n) return n;
  const naReason = NON_SEC[id] || (isPrivate ? PRIVATE_NOTE : 'No SEC CIK mapped for this company — figures N/A.');
  return {
    revenueDrivers: [],
    productService: '',
    costDrivers: [],
    marginNote: '',
    investment: [],
    positives: [],
    risks: [],
    watch: [],
    naReason,
  };
}
