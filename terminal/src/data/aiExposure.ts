/**
 * What each company sells to AI companies / AI infrastructure, and how much of its reported business that is.
 * Qualitative only — no figures. Segment names are the reporting lines named in each company's filings; our SEC
 * snapshot (companyfacts) does not carry segment-level numbers, so segments are named, never quantified.
 *
 * exposure:
 *   pure     — AI / AI infrastructure is essentially the whole business (or AI-dominant)
 *   major    — AI infrastructure is a primary growth driver and a large share of the business
 *   partial  — meaningful AI exposure inside a much broader business
 *   indirect — sells inputs whose demand is partly AI-driven; AI revenue is not separately identifiable
 */
export type AiExposure = 'pure' | 'major' | 'partial' | 'indirect';

export interface AiProfile {
  exposure: AiExposure;
  /** Products & services provided to AI companies / AI infrastructure */
  offering: string;
  /** True when reported financials cover a business much larger than its AI-related activity */
  wholeCompany: boolean;
  /** Most AI-relevant reporting segment / line named in filings (no figures) */
  aiSegment?: string;
  /** Extra context, e.g. "AI-dominant" */
  note?: string;
}

export const AI_EXPOSURE_LABELS: Record<AiExposure, string> = {
  pure: 'Pure-play',
  major: 'Major',
  partial: 'Partial',
  indirect: 'Indirect',
};

export const AI_EXPOSURE_HELP: Record<AiExposure, string> = {
  pure: 'AI / AI infrastructure is essentially the whole business (or clearly dominates revenue).',
  major: 'AI infrastructure is a primary growth driver and a large share of the business.',
  partial: 'Meaningful AI exposure inside a much broader business.',
  indirect: 'Sells inputs whose demand is partly AI-driven; AI revenue is not separately identifiable.',
};

export const AI_PROFILES: Record<string, AiProfile> = {
  /* ---------- Chips ---------- */
  nvidia: {
    exposure: 'pure',
    offering: 'Data-center GPUs (Hopper, Blackwell, Rubin) and rack-scale systems (GB200/GB300 NVL72), NVLink/NVSwitch scale-up fabric, InfiniBand and Spectrum-X Ethernet networking, Grace CPUs, and the CUDA software stack (cuDNN, TensorRT, NIM, AI Enterprise) used to train and serve models.',
    wholeCompany: false,
    aiSegment: 'Compute & Networking segment / Data Center market platform',
    note: 'AI-dominant: Data Center is the large majority of revenue; Gaming, ProViz and Automotive are included in the totals.',
  },
  amd: {
    exposure: 'major',
    offering: 'Instinct MI-series AI accelerators and Helios rack systems, EPYC server CPUs for AI head nodes, Pensando DPUs/NICs, ROCm open software, plus rack-integration capability from ZT Systems.',
    wholeCompany: true,
    aiSegment: 'Data Center segment',
  },
  intel: {
    exposure: 'partial',
    offering: 'Xeon server CPUs used as AI host processors, Gaudi accelerators, and Intel Foundry advanced-node and packaging (Foveros, EMIB) services offered to external chip designers.',
    wholeCompany: true,
    aiSegment: 'Data Center and AI (DCAI) segment',
  },
  broadcom: {
    exposure: 'major',
    offering: 'Custom AI accelerators (XPUs) co-designed with hyperscalers, Tomahawk/Jericho Ethernet switching for AI clusters, optical and PCIe connectivity, plus VMware private-cloud software.',
    wholeCompany: true,
    aiSegment: 'Semiconductor Solutions segment (AI semiconductors); Infrastructure Software (VMware) is also in the totals',
  },
  qualcomm: {
    exposure: 'partial',
    offering: 'On-device AI via Snapdragon NPUs (phones, PCs, cars) and AI200/AI250 data-center inference accelerator cards and racks announced in 2025.',
    wholeCompany: true,
    aiSegment: 'QCT (Qualcomm CDMA Technologies) segment',
  },
  arm: {
    exposure: 'partial',
    offering: 'CPU architecture licences and royalties — Neoverse cores underpin NVIDIA Grace, AWS Graviton, Google Axion and Microsoft Cobalt data-center CPUs — plus compute subsystems (CSS) for custom AI silicon.',
    wholeCompany: true,
    aiSegment: 'Single reporting segment; licence vs royalty revenue lines (infrastructure royalties are the AI-relevant part)',
  },
  marvell: {
    exposure: 'major',
    offering: 'Custom AI ASICs for hyperscalers, electro-optical interconnect (PAM4 DSPs, 800G/1.6T optics), data-center switching and storage controllers.',
    wholeCompany: true,
    aiSegment: 'Data center end market (the majority of revenue)',
  },
  huawei: {
    exposure: 'partial',
    offering: 'Ascend AI accelerators and CloudMatrix rack systems, MindSpore software and Huawei Cloud AI services, mainly for the Chinese market.',
    wholeCompany: true,
    aiSegment: 'Not an SEC filer — no segment data here',
  },
  /* ---------- Foundry ---------- */
  tsmc: {
    exposure: 'major',
    offering: 'Leading-edge wafer manufacturing (N3/N2) for GPUs, custom AI ASICs and server CPUs, and CoWoS / SoIC advanced packaging that integrates logic with HBM.',
    wholeCompany: true,
    aiSegment: 'HPC platform (revenue by platform; AI accelerators sit inside it)',
  },
  'samsung-foundry': {
    exposure: 'partial',
    offering: 'Contract chip manufacturing (SF3/SF2 gate-all-around nodes) and packaging for AI chip designers; part of Samsung Electronics.',
    wholeCompany: true,
    aiSegment: 'Division of Samsung Electronics’ DS (Device Solutions) segment — no separate filings',
  },
  globalfoundries: {
    exposure: 'indirect',
    offering: 'Specialty and mature-node manufacturing, including silicon-photonics and RF / power chips used in data-center optics and power delivery.',
    wholeCompany: true,
    aiSegment: 'Single reporting segment (data-center / communications is one end market)',
  },
  smic: {
    exposure: 'partial',
    offering: 'Chinese domestic foundry capacity; reported to manufacture China-designed AI accelerators on its most advanced nodes.',
    wholeCompany: true,
    aiSegment: 'Not an SEC filer — no segment data here',
  },
  /* ---------- Equipment / EDA ---------- */
  asml: {
    exposure: 'partial',
    offering: 'EUV and DUV lithography systems and installed-base services that leading-edge logic and HBM/DRAM makers need to build AI chips.',
    wholeCompany: true,
    aiSegment: 'Single reporting segment (EUV systems are the AI-relevant line)',
  },
  amat: {
    exposure: 'partial',
    offering: 'Deposition, etch, CMP and inspection tools for gate-all-around transistors, backside power, HBM stacking and advanced packaging.',
    wholeCompany: true,
    aiSegment: 'Semiconductor Systems segment',
  },
  lam: {
    exposure: 'partial',
    offering: 'Etch and deposition equipment, including high-aspect-ratio etch for HBM / 3D NAND and tools for advanced packaging.',
    wholeCompany: true,
    aiSegment: 'Single reporting segment',
  },
  kla: {
    exposure: 'partial',
    offering: 'Process control — wafer / reticle inspection and metrology — that leading-edge and advanced-packaging lines for AI chips depend on.',
    wholeCompany: true,
    aiSegment: 'Semiconductor Process Control segment',
  },
  synopsys: {
    exposure: 'partial',
    offering: 'EDA software, AI-assisted design tools, interface and processor IP (HBM, PCIe, UCIe) and, since Ansys, multiphysics simulation used to design AI chips and systems.',
    wholeCompany: true,
    aiSegment: 'Design Automation and Design IP segments',
  },
  cadence: {
    exposure: 'partial',
    offering: 'EDA tools, verification and emulation hardware (Palladium / Protium), IP and system-analysis software used by AI chip and system designers.',
    wholeCompany: true,
    aiSegment: 'Single reporting segment',
  },
  /* ---------- Memory ---------- */
  micron: {
    exposure: 'major',
    offering: 'HBM3E / HBM4 stacked memory for AI accelerators, high-capacity data-center DRAM (DDR5, LPDDR for servers) and data-center SSDs.',
    wholeCompany: true,
    aiSegment: 'Cloud Memory Business Unit (HBM and hyperscale DRAM)',
  },
  skhynix: {
    exposure: 'major',
    offering: 'HBM (the leading supplier to NVIDIA), server DRAM and enterprise SSDs (Solidigm).',
    wholeCompany: true,
    aiSegment: 'Not an SEC filer — no segment data here',
  },
  samsung: {
    exposure: 'partial',
    offering: 'HBM, server DRAM, enterprise SSDs and foundry services for AI chips — alongside phones, TVs and appliances.',
    wholeCompany: true,
    aiSegment: 'DS (Device Solutions) segment — memory and foundry',
  },
  /* ---------- Cloud / hyperscalers ---------- */
  microsoft: {
    exposure: 'partial',
    offering: 'Azure AI infrastructure (GPU clusters, Maia accelerators), Azure OpenAI / Foundry model services, and Copilot AI applications; OpenAI’s largest investor and compute partner.',
    wholeCompany: true,
    aiSegment: 'Intelligent Cloud segment (Azure)',
  },
  amazon: {
    exposure: 'partial',
    offering: 'AWS GPU and Trainium / Inferentia capacity, Bedrock model hosting and SageMaker; major investor in and compute provider to Anthropic.',
    wholeCompany: true,
    aiSegment: 'AWS segment',
  },
  google: {
    exposure: 'partial',
    offering: 'Google Cloud TPUs and GPU capacity, Vertex AI / Gemini models and APIs; investor in Anthropic and TPU supplier to it.',
    wholeCompany: true,
    aiSegment: 'Google Cloud segment',
  },
  meta: {
    exposure: 'partial',
    offering: 'Mainly a buyer of AI infrastructure (GPU superclusters, MTIA chips, nuclear and gas power deals); releases Llama open-weight models used by other AI companies.',
    wholeCompany: true,
    aiSegment: 'No AI segment — AI spend sits mostly in Family of Apps (Reality Labs is separate)',
  },
  oracle: {
    exposure: 'major',
    offering: 'Oracle Cloud Infrastructure (OCI) GPU superclusters and multicloud database services, contracted by OpenAI (Stargate), Meta, xAI and others.',
    wholeCompany: true,
    aiSegment: 'Cloud services and license support (OCI is inside this line)',
  },
  /* ---------- AI labs / startups ---------- */
  openai: { exposure: 'pure', offering: 'Frontier models (GPT series), ChatGPT and API services; a major buyer of compute through Stargate, Microsoft, Oracle and CoreWeave.', wholeCompany: false, note: 'Private — no SEC filings.' },
  anthropic: { exposure: 'pure', offering: 'Claude models and API services for enterprises and developers; buys compute from AWS (Trainium), Google (TPUs) and others.', wholeCompany: false, note: 'Private — no SEC filings.' },
  cerebras: { exposure: 'pure', offering: 'Wafer-scale AI processors (WSE), CS-series systems and Cerebras inference cloud.', wholeCompany: false, note: 'Private in this terminal — no SEC financials.' },
  groq: { exposure: 'pure', offering: 'LPU inference chips and GroqCloud low-latency inference service.', wholeCompany: false, note: 'Private — no SEC filings.' },
  sambanova: { exposure: 'pure', offering: 'RDU dataflow AI chips, SambaNova Suite systems and inference cloud.', wholeCompany: false, note: 'Private — no SEC filings.' },
  /* ---------- Devices / investors / space ---------- */
  apple: {
    exposure: 'indirect',
    offering: 'Mostly an AI buyer and integrator: on-device Apple Intelligence on custom silicon and Private Cloud Compute servers; a major TSMC leading-edge customer.',
    wholeCompany: true,
    aiSegment: 'No AI segment (reports by geography and product category)',
  },
  tesla: {
    exposure: 'indirect',
    offering: 'Megapack battery storage sold to data centers (including AI campuses) and in-house AI training / inference for FSD and Optimus; a large NVIDIA GPU buyer.',
    wholeCompany: true,
    aiSegment: 'Energy generation and storage segment (Megapack)',
  },
  softbank: {
    exposure: 'partial',
    offering: 'Capital: controls Arm, is a large OpenAI investor and Stargate partner, and funds AI startups through Vision Fund.',
    wholeCompany: true,
    aiSegment: 'Not an SEC filer — no segment data here',
  },
  spacex: {
    exposure: 'partial',
    offering: 'Since the Feb 2026 xAI merger: Grok models and Colossus GPU data centers that rent compute to Anthropic and Google; also Starlink connectivity and launch for orbital compute ambitions.',
    wholeCompany: true,
    aiSegment: 'AI segment (xAI, Grok, Colossus) — alongside Space and Connectivity in its 10-Q',
  },
  /* ---------- Energy: utilities & IPPs ---------- */
  constellation: { exposure: 'partial', offering: 'Firm, carbon-free nuclear power under long-term PPAs to hyperscaler data centers (Microsoft Crane restart, Meta Clinton, Amazon Calvert Cliffs, Google uprates).', wholeCompany: true, aiSegment: 'No AI segment — reports by region (Mid-Atlantic, Midwest, New York, ERCOT, other)' },
  vistra: { exposure: 'partial', offering: 'Nuclear and gas power under long-term contracts to data centers (Amazon Comanche Peak, Meta Perry / Davis-Besse) plus retail electricity.', wholeCompany: true, aiSegment: 'No AI-specific segment' },
  talen: { exposure: 'partial', offering: '1.92 GW of nuclear power from Susquehanna to AWS data centers under a PPA running to 2042.', wholeCompany: true, aiSegment: 'No AI-specific segment' },
  nrg: { exposure: 'partial', offering: 'Retail and wholesale power; developing gas-fired capacity and supply agreements for data centers (deals not yet final).', wholeCompany: true, aiSegment: 'No AI-specific segment' },
  nextera: { exposure: 'partial', offering: 'Renewable, storage and nuclear power contracts to hyperscalers (Google Duane Arnold restart, Meta 2.5 GW) and co-developed data-center campuses.', wholeCompany: true, aiSegment: 'NextEra Energy Resources (contracted generation); FPL is the regulated utility' },
  dominion: { exposure: 'partial', offering: 'Regulated electricity for Northern Virginia’s data-center cluster and an exploratory SMR partnership with Amazon.', wholeCompany: true, aiSegment: 'Dominion Energy Virginia' },
  duke: { exposure: 'partial', offering: 'Regulated electricity and new generation for data centers in the Carolinas and Midwest (multi-GW signed agreements, including Microsoft).', wholeCompany: true, aiSegment: 'Electric Utilities and Infrastructure segment' },
  southern: { exposure: 'partial', offering: 'Regulated electricity and new generation for large data-center loads, including up to 3.2 GW for OpenAI in Georgia.', wholeCompany: true, aiSegment: 'Georgia Power (traditional electric operating company)' },
  /* ---------- Energy: equipment ---------- */
  gevernova: { exposure: 'partial', offering: 'Gas turbines for data-center and utility power plants, grid equipment (transformers, HVDC) and services.', wholeCompany: true, aiSegment: 'Power segment (gas turbines); Electrification (grid)' },
  siemensenergy: { exposure: 'partial', offering: 'Gas turbines, grid technology (transformers, HVDC) and services for utilities and data-center developers.', wholeCompany: true, aiSegment: 'Not an SEC filer — no segment data here (Gas Services and Grid Technologies are the relevant units)' },
  bloom: { exposure: 'partial', offering: 'On-site solid-oxide fuel-cell power for data centers (Brookfield $25B AI-power partnership, Oracle and AEP deployments).', wholeCompany: true, aiSegment: 'Single reporting segment' },
  vertiv: { exposure: 'major', offering: 'Data-center power and thermal infrastructure — UPS, switchgear, busway, liquid cooling (CDUs), prefabricated modules — co-engineered with NVIDIA for high-density AI racks.', wholeCompany: true, aiSegment: 'Reports by region (Americas, APAC, EMEA); data centers are its main end market' },
  eaton: { exposure: 'partial', offering: 'Electrical gear for data centers — switchgear, UPS, power distribution and modular power (Fibrebond) — plus 800 VDC work with NVIDIA.', wholeCompany: true, aiSegment: 'Electrical Americas segment' },
  /* ---------- Energy: nuclear developers & fuel ---------- */
  oklo: { exposure: 'major', offering: 'Aurora small modular reactors and fuel recycling aimed at powering data centers (Meta prepayment / 1.2 GW campus; non-binding Switch agreement).', wholeCompany: false, note: 'Pre-revenue: data-center power is the core of its business plan.' },
  nuscale: { exposure: 'partial', offering: 'SMR designs (NRC-certified) marketed for data-center and utility power, e.g. the TVA / ENTRA1 program.', wholeCompany: true, aiSegment: 'Single reporting segment' },
  cameco: { exposure: 'indirect', offering: 'Uranium, conversion and fuel services, plus a Westinghouse stake (reactors in the US $80B framework that includes AI data-center power).', wholeCompany: true, aiSegment: 'Uranium, Fuel services and Westinghouse segments (IFRS 40-F)' },
  centrus: { exposure: 'indirect', offering: 'LEU and HALEU enrichment for reactors, including advanced reactors (Oklo letter of intent) planned for data-center power.', wholeCompany: true, aiSegment: 'LEU and Technical Solutions segments' },
  /* ---------- Energy: gas, renewables, others ---------- */
  ormat: { exposure: 'partial', offering: 'Geothermal power under long-term PPAs, including new capacity contracted by Google, plus geothermal equipment and storage.', wholeCompany: true, aiSegment: 'Electricity segment' },
  eqt: { exposure: 'indirect', offering: 'Natural-gas supply for gas-fired data-center power (e.g. the Homer City campus in Pennsylvania).', wholeCompany: true, aiSegment: 'No AI-specific segment' },
  williams: { exposure: 'partial', offering: 'Gas pipelines and dedicated behind-the-meter power projects for data centers (Socrates projects in Ohio serving Meta).', wholeCompany: true, aiSegment: 'No AI-specific segment' },
  kindermorgan: { exposure: 'indirect', offering: 'Natural-gas transport and storage serving new gas-fired power for data centers.', wholeCompany: true, aiSegment: 'Natural Gas Pipelines segment' },
  energytransfer: { exposure: 'indirect', offering: 'Gas supply and pipelines to data-center power plants (e.g. supply agreement with Oracle).', wholeCompany: true, aiSegment: 'Intrastate / interstate transportation & storage segments' },
  brookfieldrenewable: { exposure: 'partial', offering: 'Hydro, wind and solar power under hyperscaler frameworks (Microsoft multi-GW framework, Google hydro deal).', wholeCompany: true, aiSegment: 'Hydroelectric segment (Google deal) — IFRS 20-F' },
  firstsolar: { exposure: 'indirect', offering: 'Utility-scale solar modules for developers building power that is often contracted to data centers.', wholeCompany: true, aiSegment: 'Modules segment' },
  vestas: { exposure: 'indirect', offering: 'Wind turbines and service for developers whose projects are often contracted to tech / data-center buyers.', wholeCompany: true, aiSegment: 'Not an SEC filer — no segment data here' },
  neste: { exposure: 'indirect', offering: 'Renewable diesel (HVO) used to fuel data-center backup generators — a thin AI link.', wholeCompany: true, aiSegment: 'Not an SEC filer — no segment data here' },
};

export function aiProfileFor(id: string): AiProfile | undefined {
  return AI_PROFILES[id];
}
