/**
 * Qualitative Financials-tab context for the energy layer. Like financialNotes.ts, NO figures here are
 * used as data — every number in the tab comes from SEC XBRL (snapshot / live) or is N/A.
 * Notes = per-market template (how that business earns and spends) + the company's own summary and its
 * sourced AI / data-center link from energyCompanies.ts.
 */
import type { Company, Segment } from '../types';
import type { FinNote } from './financialNotes';
import { energyCompanies } from './energyCompanies';

type Template = Omit<FinNote, 'naReason' | 'filingNote'>;

const UTILITY_COST_NOTE =
  'Utilities and power generators generally do not tag cost of revenue / gross profit; their cost lines are fuel & purchased power, O&M and depreciation, so gross-margin figures show N/A.';

const TEMPLATES: Partial<Record<Segment, Template>> = {
  energy_utility: {
    revenueDrivers: [
      'Electricity sales — regulated retail rates (allowed return on rate base) and/or competitive wholesale & retail power.',
      'Large-load contracts (data centers) signed as electric service agreements or long-term PPAs.',
    ],
    productService: 'Power & energy services; not split into product vs service in companyfacts.',
    costDrivers: ['Fuel and purchased power (natural gas, coal, nuclear fuel).', 'Operations & maintenance, depreciation of generation, transmission & distribution assets.', 'Interest on a large debt load.'],
    marginNote: UTILITY_COST_NOTE,
    investment: ['Multi-year capex plans for new generation, transmission and grid upgrades — rising with data-center load forecasts.', 'Funded by debt, equity issuance and (for regulated utilities) recovered through rates.'],
    positives: ['Data-center demand lifts load growth after ~15 years of flat US electricity demand.'],
    risks: ['Regulatory risk: rate cases, large-load tariffs and who pays for new capacity.', 'Execution / cost overruns on new plants and interconnection delays.', 'Rate sensitivity — capital intensive, high leverage.'],
    watch: ['Signed data-center ESAs / PPAs (GW)', 'Capex plan revisions', 'Large-load tariff rulings', 'Interconnection queue progress'],
  },
  energy_nuclear: {
    revenueDrivers: [
      'Operators: 24/7 carbon-free power sold under long-term PPAs (often to hyperscalers) and in wholesale markets; federal nuclear production tax credits.',
      'Developers / fuel: SMR design & licensing work, uranium mining and conversion, enrichment (LEU / HALEU) contracts.',
    ],
    productService: 'Power, fuel and engineering services; segment detail is not in companyfacts.',
    costDrivers: ['Nuclear fuel, outage and refuelling costs, O&M at large plants.', 'For developers: R&D and licensing (NRC) spend ahead of revenue.'],
    marginNote: 'Operators’ margins depend on power prices and PPA pricing; pre-revenue SMR developers post operating losses, so margins show N/A or negative.',
    investment: ['Uprates and restarts of existing reactors; SMR first-of-a-kind builds; fuel-supply expansion (enrichment capacity).'],
    positives: ['Firm, carbon-free baseload is the scarcest resource hyperscalers are contracting for.'],
    risks: ['NRC licensing timelines and first-of-a-kind cost overruns.', 'Fuel supply concentration (Russian enrichment bans, HALEU scarcity).', 'Many SMR agreements are non-binding MOUs / LOIs.'],
    watch: ['PPA announcements with hyperscalers', 'NRC milestones', 'Uranium / SWU prices', 'Restart & uprate schedules'],
  },
  energy_gas: {
    revenueDrivers: ['Natural-gas production (sales volumes × realised prices) or pipeline / midstream fees (mostly fee-based, take-or-pay contracts).', 'Gas supply and dedicated pipelines / power for data-center campuses.'],
    productService: 'Commodity sales and transportation services; not split in companyfacts.',
    costDrivers: ['Production & gathering costs, depletion (producers).', 'Pipeline O&M, compression and depreciation (midstream).'],
    marginNote: 'Producer margins swing with Henry Hub gas prices; midstream fee-based margins are steadier.',
    investment: ['Growth capex on new pipelines and behind-the-meter power projects for data centers.'],
    positives: ['Gas-fired generation is the fastest firm capacity to build for AI load growth.'],
    risks: ['Commodity price volatility; permitting of new pipelines.', 'Turbine supply bottlenecks limit gas-power buildout.', 'Emissions policy.'],
    watch: ['Data-center gas supply deals', 'Pipeline FIDs / approvals', 'Henry Hub price'],
  },
  energy_turbines: {
    revenueDrivers: ['Gas turbines, fuel cells and power equipment sold to utilities, IPPs and data-center developers.', 'Long-term service agreements on the installed base (recurring, higher margin).'],
    productService: 'Equipment plus services; the product/service split is not tagged in companyfacts.',
    costDrivers: ['Materials (steel, nickel alloys), manufacturing labour and capacity expansion.', 'Warranty and project-execution costs.'],
    marginNote: 'Margins expand with pricing power from a sold-out order backlog; wind / project segments can dilute.',
    investment: ['Factory capacity expansion to meet multi-year backlog; R&D on hydrogen-ready / higher-efficiency units.'],
    positives: ['Backlog and slot reservations extend years out on data-center-driven demand.'],
    risks: ['Execution on capacity ramps; cyclical order intake if AI capex slows.'],
    watch: ['Orders & backlog (GW)', 'Pricing on new slots', 'Service margin'],
  },
  energy_renewables: {
    revenueDrivers: ['Long-term PPAs from hydro, wind, solar and storage assets (renewable IPPs), or solar-module sales (manufacturers).', 'Hyperscaler framework agreements for multi-GW clean capacity.'],
    productService: 'Power sales or module sales; not split in companyfacts.',
    costDrivers: ['Depreciation of generating assets and interest (IPPs).', 'Polysilicon / glass / labour costs (module makers).'],
    marginNote: 'Contracted assets yield stable margins; module makers depend on pricing and US tax credits (45X).',
    investment: ['Development pipeline capex, acquisitions of operating platforms, US manufacturing capacity.'],
    positives: ['Hyperscalers are the largest corporate buyers of clean power.'],
    risks: ['Interest-rate sensitivity; policy changes to clean-energy tax credits; intermittency (needs storage / firming).'],
    watch: ['Corporate PPA volumes', 'Tax-credit policy', 'Module pricing'],
  },
  energy_wind: {
    revenueDrivers: ['Wind turbine sales and multi-year service contracts.'],
    productService: 'Turbines and services.',
    costDrivers: ['Steel, blades, logistics; warranty provisions.'],
    marginNote: 'Thin project margins; service is the profit pool.',
    investment: ['Factory footprint and next-generation turbine platforms.'],
    positives: ['Corporate clean-energy buying (incl. data centers) supports order intake.'],
    risks: ['Indirect AI exposure — data-center demand reaches turbine makers via developers, not direct contracts.'],
    watch: ['Order intake', 'Service margin', 'US offshore / onshore policy'],
  },
  energy_geothermal: {
    revenueDrivers: ['Electricity from geothermal plants under long-term PPAs; geothermal equipment (product segment); energy storage.'],
    productService: 'Electricity, product (power-plant equipment) and storage segments.',
    costDrivers: ['Drilling and well-field costs, plant O&M, depreciation.'],
    marginNote: 'Contracted baseload PPAs give stable electricity-segment margins.',
    investment: ['New geothermal capacity and repowering; storage projects.'],
    positives: ['Geothermal is one of few firm, carbon-free sources available this decade.'],
    risks: ['Resource / drilling risk; small scale versus hyperscaler demand.'],
    watch: ['New data-center PPAs', 'Capacity additions (MW)'],
  },
  energy_biofuel: {
    revenueDrivers: ['Renewable diesel (HVO), sustainable aviation fuel and fossil-refining margins.'],
    productService: 'Fuel products.',
    costDrivers: ['Waste & residue feedstock costs; refinery operations.'],
    marginNote: 'Driven by renewable-fuel sales margins and regulatory credit prices.',
    investment: ['Renewable-fuel refinery capacity.'],
    positives: ['HVO replaces diesel in data-center backup generators.'],
    risks: ['THIN AI LINK: data centers are a niche customer; results are driven by transport-fuel markets.'],
    watch: ['Renewable-fuel margins', 'Data-center backup-fuel contracts'],
  },
  energy_grid: {
    revenueDrivers: ['Data-center power & cooling equipment (UPS, switchgear, busway, liquid cooling) plus grid / electrical products.', 'Services on the installed base.'],
    productService: 'Mostly products; services are reported within segments, not as a separate companyfacts line.',
    costDrivers: ['Materials (copper, steel, electronics), manufacturing and capacity expansion.'],
    marginNote: 'Margins expand with data-center volume and pricing; acquisitions add amortization.',
    investment: ['Capacity expansion, bolt-on acquisitions in power & cooling, R&D for high-density AI racks (800 VDC, liquid cooling).'],
    positives: ['Direct beneficiary of AI data-center build-outs; co-engineering with NVIDIA on rack power.'],
    risks: ['Cyclical if hyperscaler capex slows; supply-chain constraints.'],
    watch: ['Data-center orders & backlog', 'Book-to-bill', 'Margin expansion'],
  },
};

const FILING_NOTES: Record<string, string> = {
  nextera:
    'Capital expenditures are reported with company-specific extension tags (FPL / NextEra Energy Resources) that SEC companyfacts does not expose, so capex and free cash flow show N/A rather than estimated.',
  cameco: 'Canadian MJDS filer: annual 40-F under IFRS in CAD (ifrs-full taxonomy); quarterly results are furnished on 6-K and may lack XBRL.',
  brookfieldrenewable: 'Foreign private issuer: annual 20-F under IFRS in USD; several standard lines (operating income, cost of revenue) are not tagged → N/A.',
  energytransfer: 'Master limited partnership: per-unit figures are for common units; distributions are not tagged as dividends.',
  talen: 'Emerged from bankruptcy in 2023 (fresh-start accounting), so pre-2023 history is limited.',
  oklo: 'Pre-revenue SMR developer — revenue and margins are N/A / zero; costs are mostly R&D and G&A.',
};

const NON_SEC_REASON: Record<string, string> = {
  siemensenergy:
    'Listed in Frankfurt (ENR.DE); reports under IFRS to German regulators, not an SEC XBRL filer. Figures N/A here — see Siemens Energy IR.',
  vestas: 'Listed in Copenhagen (VWS.CO); reports under IFRS in EUR, not an SEC filer. Figures N/A here — see Vestas IR.',
  neste: 'Listed in Helsinki (NESTE.HE); reports under IFRS in EUR, not an SEC filer. Figures N/A here — see Neste IR.',
};

function build(c: Company): FinNote | null {
  const t = TEMPLATES[c.segment];
  if (!t) return null;
  const link = c.aiLink;
  const linkLine = link
    ? `AI / data-center link (${link.strength}; ${link.source}, ${link.date}): ${link.summary}`
    : undefined;
  return {
    ...t,
    revenueDrivers: [c.summary, ...t.revenueDrivers],
    positives: linkLine ? [linkLine, ...t.positives] : t.positives,
    naReason: NON_SEC_REASON[c.id],
    filingNote: FILING_NOTES[c.id],
  };
}

export const ENERGY_FIN_NOTES: Record<string, FinNote> = Object.fromEntries(
  energyCompanies.map((c) => [c.id, build(c)]).filter((e): e is [string, FinNote] => e[1] != null)
);
