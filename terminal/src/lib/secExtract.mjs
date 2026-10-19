// Shared SEC XBRL companyfacts → compact financial series extractor.
// Used by scripts/fetch-sec.mjs (build-time snapshot) and the browser (live refresh via /api/sec).
// Plain JS on purpose so Node 20 can import it without a TS loader.

/** @typedef {{tags: string[], sum?: string[][], additive?: boolean, unit?: 'money'|'shares'}} MetricDef */

const G = 'us-gaap';
const I = 'ifrs-full';

/** Ordered tag fallbacks per metric. `sum` = composite fallback (all parts must exist for a period). */
export const METRIC_DEFS = {
  revenue: {
    [G]: { tags: ['Revenues', 'RegulatedAndUnregulatedOperatingRevenue', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'] },
    [I]: { tags: ['Revenue', 'RevenueFromContractsWithCustomers'] },
  },
  revenueProducts: {
    [G]: { tags: ['RevenueFromContractWithCustomerProductMember', 'SalesRevenueGoodsNet', 'RevenueFromSaleOfGoods'] },
    [I]: { tags: ['RevenueFromSaleOfGoods'] },
  },
  revenueServices: {
    [G]: { tags: ['SalesRevenueServicesNet', 'RevenueFromServices'] },
    [I]: { tags: ['RevenueFromRenderingOfServices'] },
  },
  costOfRevenue: {
    [G]: { tags: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization'] },
    [I]: { tags: ['CostOfSales'] },
  },
  rnd: {
    [G]: { tags: ['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost'] },
    [I]: { tags: ['ResearchAndDevelopmentExpense'] },
  },
  sga: {
    [G]: { tags: ['SellingGeneralAndAdministrativeExpense'], sum: [['SellingAndMarketingExpense', 'GeneralAndAdministrativeExpense'], ['MarketingExpense', 'GeneralAndAdministrativeExpense']] },
    [I]: { tags: ['SellingGeneralAndAdministrativeExpense'], sum: [['SellingExpense', 'AdministrativeExpense'], ['DistributionCosts', 'AdministrativeExpense']] },
  },
  opex: {
    [G]: { tags: ['OperatingExpenses'] },
    [I]: { tags: ['OperatingExpense'] },
  },
  operatingIncome: {
    [G]: { tags: ['OperatingIncomeLoss'] },
    [I]: { tags: ['ProfitLossFromOperatingActivities'] },
  },
  netIncome: {
    [G]: { tags: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'] },
    [I]: { tags: ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'] },
  },
  grossProfit: {
    [G]: { tags: ['GrossProfit'] },
    [I]: { tags: ['GrossProfit'] },
  },
  ocf: {
    [G]: { tags: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'] },
    [I]: { tags: ['CashFlowsFromUsedInOperatingActivities'] },
  },
  capex: {
    [G]: { tags: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForProceedsFromProductiveAssets'] },
    [I]: { tags: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', 'PurchaseOfPropertyPlantAndEquipment'] },
  },
  acquisitions: {
    [G]: { tags: ['PaymentsToAcquireBusinessesNetOfCashAcquired', 'PaymentsToAcquireBusinessesGross', 'PaymentsToAcquireBusinessesAndInterestInAffiliates'] },
    [I]: { tags: ['CashFlowsUsedInObtainingControlOfSubsidiariesOrOtherBusinessesClassifiedAsInvestingActivities'] },
  },
  investPurchases: {
    [G]: { tags: ['PaymentsToAcquireInvestments', 'PaymentsToAcquireMarketableSecurities', 'PaymentsToAcquireAvailableForSaleSecuritiesDebt', 'PaymentsToAcquireAvailableForSaleSecurities', 'PaymentsToAcquireShortTermInvestments'] },
    [I]: { tags: ['PurchaseOfFinancialInstrumentsClassifiedAsInvestingActivities', 'PurchaseOfOtherLongtermAssetsClassifiedAsInvestingActivities'] },
  },
  investProceeds: {
    [G]: { tags: ['ProceedsFromSaleMaturityAndCollectionsOfInvestments', 'ProceedsFromSaleAndMaturityOfMarketableSecurities', 'ProceedsFromMaturitiesPrepaymentsAndCallsOfAvailableForSaleSecurities', 'ProceedsFromSaleOfAvailableForSaleSecuritiesDebt', 'ProceedsFromSaleAndMaturityOfAvailableForSaleSecurities', 'ProceedsFromSaleAndMaturityOfOtherInvestments'] },
    [I]: { tags: ['ProceedsFromSalesOrMaturityOfFinancialInstrumentsClassifiedAsInvestingActivities'] },
  },
  buybacks: {
    [G]: { tags: ['PaymentsForRepurchaseOfCommonStock', 'PaymentsForRepurchaseOfEquity'] },
    [I]: { tags: ['PaymentsToAcquireOrRedeemEntitysShares'] },
  },
  dividends: {
    [G]: { tags: ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock', 'PaymentsOfOrdinaryDividends'] },
    [I]: { tags: ['DividendsPaidClassifiedAsFinancingActivities', 'DividendsPaid'] },
  },
  debtIssued: {
    [G]: { tags: ['ProceedsFromIssuanceOfLongTermDebt', 'ProceedsFromIssuanceOfDebt', 'ProceedsFromIssuanceOfSeniorLongTermDebt', 'ProceedsFromDebtNetOfIssuanceCosts', 'ProceedsFromIssuanceOfUnsecuredDebt', 'ProceedsFromDebtMaturingInMoreThanThreeMonths'] },
    [I]: { tags: ['ProceedsFromIssueOfBondsNotesAndDebentures', 'ProceedsFromNoncurrentBorrowings', 'ProceedsFromBorrowingsClassifiedAsFinancingActivities'] },
  },
  debtRepaid: {
    [G]: { tags: ['RepaymentsOfLongTermDebt', 'RepaymentsOfDebt', 'RepaymentsOfSeniorDebt', 'RepaymentsOfConvertibleDebt', 'RepaymentsOfDebtMaturingInMoreThanThreeMonths', 'RepaymentsOfDebtAndCapitalLeaseObligations', 'RepaymentsOfUnsecuredDebt', 'RepaymentsOfLongTermDebtAndCapitalSecurities'] },
    [I]: { tags: ['RepaymentsOfBondsNotesAndDebentures', 'RepaymentsOfNoncurrentBorrowings', 'RepaymentsOfBorrowingsClassifiedAsFinancingActivities'] },
  },
  sbc: {
    [G]: { tags: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'] },
    [I]: { tags: ['AdjustmentsForSharebasedPayments'] },
  },
  dilutedShares: {
    [G]: { tags: ['WeightedAverageNumberOfDilutedSharesOutstanding'], additive: false, unit: 'shares' },
    [I]: { tags: ['WeightedAverageNumberOfSharesOutstandingDiluted', 'AdjustedWeightedAverageShares'], additive: false, unit: 'shares' },
  },
};

export const METRIC_KEYS = Object.keys(METRIC_DEFS);

const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

function pickUnit(units, wantShares, currency) {
  const keys = Object.keys(units || {});
  if (!keys.length) return null;
  if (wantShares) return keys.find((k) => k === 'shares') || null;
  if (currency) return keys.includes(currency) ? currency : null;
  if (keys.includes('USD')) return 'USD';
  return keys.find((k) => /^[A-Z]{3}$/.test(k)) || null;
}

/** Reporting currency = the ISO currency unit with the most facts across the taxonomy (avoids mixing e.g. TWD with USD convenience translations). */
function dominantCurrency(tax) {
  const counts = {};
  for (const node of Object.values(tax)) {
    for (const [u, arr] of Object.entries(node.units || {})) {
      if (/^[A-Z]{3}$/.test(u)) counts[u] = (counts[u] || 0) + arr.length;
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

/** Dedupe raw facts by (start,end), keeping the most recently filed value (captures restatements). */
function durationFacts(arr) {
  const byKey = new Map();
  for (const f of arr) {
    if (!f.start || !f.end || typeof f.val !== 'number') continue;
    const k = f.start + '|' + f.end;
    const prev = byKey.get(k);
    if (!prev || String(f.filed) > String(prev.filed)) byKey.set(k, f);
  }
  return [...byKey.values()];
}

function toPoint(f, tag, extra) {
  return { start: f.start, end: f.end, val: f.val, form: f.form, accn: f.accn, filed: f.filed, tag, ...(extra || {}) };
}

/** Build annual + quarterly series for one tag (facts already deduped). */
function seriesForFacts(facts, tag, additive) {
  const annual = [];
  const quarterly = [];
  const ytd = [];
  const qKeys = new Set();
  for (const f of facts) {
    const d = days(f.start, f.end);
    if (d >= 340 && d <= 380) annual.push(toPoint(f, tag));
    else if (d >= 80 && d <= 100) {
      quarterly.push(toPoint(f, tag));
      qKeys.add(f.end);
    } else if (additive && d >= 150 && d <= 290) {
      // Year-to-date (6M / 9M) totals as filed in 10-Qs — kept for first-time filers whose cash flows are YTD-only.
      ytd.push(toPoint(f, tag, { ytdMonths: Math.round(d / 30.44) }));
    }
  }
  if (additive) {
    // Derive discrete quarters from YTD differences (cash-flow items are usually YTD-only in 10-Qs; Q4 = FY − 9M).
    const byStart = new Map();
    for (const f of facts) {
      const d = days(f.start, f.end);
      if (d < 80 || d > 380) continue;
      if (!byStart.has(f.start)) byStart.set(f.start, []);
      byStart.get(f.start).push(f);
    }
    for (const list of byStart.values()) {
      list.sort((a, b) => (a.end < b.end ? -1 : 1));
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const cur = list[i];
        const gap = days(prev.end, cur.end);
        if (gap < 80 || gap > 100) continue;
        if (qKeys.has(cur.end)) continue;
        const startDate = new Date(Date.parse(prev.end) + DAY).toISOString().slice(0, 10);
        quarterly.push({
          start: startDate,
          end: cur.end,
          val: cur.val - prev.val,
          form: cur.form,
          accn: cur.accn,
          filed: cur.filed,
          tag,
          derived: 'ytd-diff',
        });
        qKeys.add(cur.end);
      }
    }
    // First-10-Q case: a 6-month YTD total plus the discrete Q2 → Q1 = 6M − Q2 (e.g. newly public companies with no Q1 10-Q).
    const discrete = facts.filter((f) => {
      const d = days(f.start, f.end);
      return d >= 80 && d <= 100;
    });
    for (const f of facts) {
      const d = days(f.start, f.end);
      if (d < 170 || d > 195) continue;
      const q2 = discrete.find((q) => q.end === f.end && q.start !== f.start);
      if (!q2) continue;
      const headDays = days(f.start, q2.start);
      if (headDays < 80 || headDays > 100) continue;
      const headEnd = new Date(Date.parse(q2.start) - DAY).toISOString().slice(0, 10);
      if ([...qKeys].some((k) => Math.abs(days(k, headEnd)) <= 7)) continue;
      quarterly.push({
        start: f.start,
        end: headEnd,
        val: f.val - q2.val,
        form: f.form,
        accn: f.accn,
        filed: f.filed,
        tag,
        derived: 'ytd-diff',
      });
      qKeys.add(headEnd);
    }
  }
  return { annual, quarterly, ytd };
}

function mergeByEnd(target, incoming) {
  const have = new Set(target.map((p) => p.end));
  for (const p of incoming) if (!have.has(p.end)) { target.push(p); have.add(p.end); }
}

function sumSeries(seriesList, label) {
  // Only periods present in every component
  const maps = seriesList.map((s) => new Map(s.map((p) => [p.end, p])));
  const out = [];
  for (const [end, p0] of maps[0]) {
    const parts = maps.map((m) => m.get(end));
    if (parts.some((p) => !p)) continue;
    out.push({ ...p0, val: parts.reduce((a, p) => a + p.val, 0), tag: label, derived: 'sum' });
  }
  return out;
}

/**
 * Extract compact financial series from an SEC companyfacts JSON.
 * @param {any} json companyfacts payload
 * @param {{maxAnnual?: number, maxQuarterly?: number}} [opts]
 */
export function extractFinancials(json, opts = {}) {
  const maxAnnual = opts.maxAnnual ?? 6;
  const maxQuarterly = opts.maxQuarterly ?? 10;
  const facts = json?.facts || {};
  const hasGaap = facts[G] && Object.keys(facts[G]).length > 20;
  const hasIfrs = facts[I] && Object.keys(facts[I]).length > 20;
  const taxonomy = hasGaap ? G : hasIfrs ? I : null;
  const result = {
    entityName: json?.entityName || '',
    cik: json?.cik != null ? String(json.cik).padStart(10, '0') : '',
    taxonomy,
    currency: null,
    metrics: {},
    missing: [],
    tagsUsed: {},
  };
  if (!taxonomy) {
    result.missing = [...METRIC_KEYS];
    return result;
  }
  const tax = facts[taxonomy];
  const currency = dominantCurrency(tax);
  result.currency = currency;

  const readTag = (tag, def) => {
    const node = tax[tag];
    if (!node) return null;
    const unit = pickUnit(node.units, def.unit === 'shares', def.unit === 'shares' ? null : currency);
    if (!unit) return null;
    const s = seriesForFacts(durationFacts(node.units[unit]), tag, def.additive !== false);
    return { ...s, unit };
  };

  for (const key of METRIC_KEYS) {
    const def = METRIC_DEFS[key][taxonomy];
    const annual = [];
    const quarterly = [];
    const ytd = [];
    const used = [];
    for (const tag of def.tags) {
      const s = readTag(tag, def);
      if (!s || (!s.annual.length && !s.quarterly.length && !s.ytd.length)) continue;
      const beforeA = annual.length;
      const beforeQ = quarterly.length;
      const beforeY = ytd.length;
      mergeByEnd(annual, s.annual);
      mergeByEnd(quarterly, s.quarterly);
      mergeByEnd(ytd, s.ytd);
      if (annual.length > beforeA || quarterly.length > beforeQ || ytd.length > beforeY) used.push(tag);
    }
    if (def.sum) {
      for (const parts of def.sum) {
        const ss = parts.map((t) => readTag(t, def));
        if (ss.some((s) => !s)) continue;
        const label = parts.join('+');
        const a = sumSeries(ss.map((s) => s.annual), label);
        const q = sumSeries(ss.map((s) => s.quarterly), label);
        const beforeA = annual.length;
        const beforeQ = quarterly.length;
        mergeByEnd(annual, a);
        mergeByEnd(quarterly, q);
        if (annual.length > beforeA || quarterly.length > beforeQ) used.push(label);
      }
    }
    annual.sort((a, b) => (a.end < b.end ? -1 : 1));
    quarterly.sort((a, b) => (a.end < b.end ? -1 : 1));
    ytd.sort((a, b) => (a.end < b.end ? -1 : 1));
    if (!annual.length && !quarterly.length && !ytd.length) {
      result.missing.push(key);
      continue;
    }
    result.metrics[key] = {
      annual: annual.slice(-maxAnnual),
      quarterly: quarterly.slice(-maxQuarterly),
      // YTD totals only matter when discrete quarters are unavailable and they are newer than the latest annual period
      // (e.g. a first 10-Q after an IPO). Keeps the snapshot compact and avoids stale half-year 6-K facts.
      ...(ytd.length && !quarterly.length && (!annual.length || ytd[ytd.length - 1].end > annual[annual.length - 1].end)
        ? { ytd: ytd.slice(-4) }
        : {}),
    };
    result.tagsUsed[key] = used;
  }
  // Drop stale metrics (e.g. pre-2018 SalesRevenueGoodsNet product splits) whose latest period is >2y older than revenue's.
  const revLatest = [...(result.metrics.revenue?.annual || []), ...(result.metrics.revenue?.quarterly || [])]
    .map((p) => p.end).sort().at(-1);
  result.stale = [];
  if (revLatest) {
    for (const [key, m] of Object.entries(result.metrics)) {
      const latest = [...m.annual, ...m.quarterly, ...(m.ytd || [])].map((p) => p.end).sort().at(-1);
      if (latest && days(latest, revLatest) > 730) {
        delete result.metrics[key];
        result.stale.push({ key, latest, tags: result.tagsUsed[key] });
        delete result.tagsUsed[key];
        result.missing.push(key);
      }
    }
  }

  // Derived fallbacks (clearly flagged): gross profit = revenue − cost of revenue; opex = gross profit − operating income.
  deriveDiff(result, 'grossProfit', 'revenue', 'costOfRevenue', 'Revenue−CostOfRevenue', maxAnnual, maxQuarterly);
  // Operating income fallback (approximation, flagged): gross profit − R&D − SG&A.
  if (!result.metrics.operatingIncome && result.metrics.rnd && result.metrics.sga) {
    deriveDiff(result, '_gpLessRnd', 'grossProfit', 'rnd', 'tmp', maxAnnual, maxQuarterly);
    deriveDiff(result, 'operatingIncome', '_gpLessRnd', 'sga', 'GrossProfit−R&D−SG&A (approx.)', maxAnnual, maxQuarterly);
    delete result.metrics._gpLessRnd;
    delete result.tagsUsed._gpLessRnd;
  }
  deriveDiff(result, 'opex', 'grossProfit', 'operatingIncome', 'GrossProfit−OperatingIncome', maxAnnual, maxQuarterly);
  // Free cash flow is always derived: operating cash flow − capex.
  deriveDiff(result, 'fcf', 'ocf', 'capex', 'OCF−Capex', maxAnnual, maxQuarterly, true);
  return result;
}

function deriveDiff(result, key, aKey, bKey, label, maxAnnual, maxQuarterly, always) {
  if (result.metrics[key] && !always) return;
  const a = result.metrics[aKey];
  const b = result.metrics[bKey];
  if (!a || !b) return;
  const diff = (as, bs) => {
    const bm = new Map(bs.map((p) => [p.end, p]));
    const out = [];
    for (const p of as) {
      const q = bm.get(p.end);
      if (!q) continue;
      out.push({ ...p, val: p.val - q.val, tag: label, derived: 'calc' });
    }
    return out;
  };
  const annual = diff(a.annual, b.annual).slice(-maxAnnual);
  const quarterly = diff(a.quarterly, b.quarterly).slice(-maxQuarterly);
  const ytd = a.ytd && b.ytd ? diff(a.ytd, b.ytd).slice(-4) : [];
  if (!annual.length && !quarterly.length && !ytd.length) return;
  result.metrics[key] = { annual, quarterly, ...(ytd.length && !quarterly.length ? { ytd } : {}) };
  result.tagsUsed[key] = [label];
  result.missing = result.missing.filter((m) => m !== key);
}

/** EDGAR filing index URL for an accession number. */
export function filingIndexUrl(cik, accn) {
  const c = String(Number(String(cik).replace(/\D/g, '')));
  const a = String(accn);
  return `https://www.sec.gov/Archives/edgar/data/${c}/${a.replace(/-/g, '')}/${a}-index.htm`;
}

/** Forms that count as formal periodic / registration filings (an amended "/A" variant counts as its base form). */
export const FORMAL_FORMS = ['10-K', '10-Q', '20-F', '40-F', 'S-1', 'F-1'];

/** Distinct formal forms present in an SEC submissions payload's recent filings. */
export function formalFilingForms(sub) {
  const set = new Set();
  for (const f of sub?.filings?.recent?.form || []) {
    const base = String(f).replace(/\/A$/, '');
    if (FORMAL_FORMS.includes(base)) set.add(base);
  }
  return [...set].sort();
}

/**
 * Compact filing summary from an SEC submissions payload: form counts + recent periodic / IPO documents.
 * Same shape the build-time snapshot stores under `filings[id]`.
 */
export function summarizeSubmissions(sub, cik, maxRecent = 12) {
  const recent = sub?.filings?.recent;
  const formCounts = {};
  const out = [];
  const c = Number(String(cik).replace(/\D/g, ''));
  if (recent?.form) {
    for (let i = 0; i < recent.form.length; i++) {
      const form = String(recent.form[i]);
      formCounts[form] = (formCounts[form] || 0) + 1;
      if (!/^(10-[KQ]|20-F|40-F|8-K|6-K|S-1|S-1\/A|F-1|F-1\/A|DRS|DRS\/A|424B4|FWP|D|D\/A|8-A12B)$/i.test(form)) continue;
      if (out.length >= maxRecent) continue;
      const accn = String(recent.accessionNumber[i]);
      const primary = String(recent.primaryDocument?.[i] || '');
      out.push({
        form,
        filed: String(recent.filingDate[i]),
        accn,
        desc: String(recent.primaryDocDescription?.[i] || recent.items?.[i] || form),
        url: `https://www.sec.gov/Archives/edgar/data/${c}/${accn.replace(/-/g, '')}/${primary || accn + '-index.htm'}`,
      });
    }
  }
  return { formCounts, recent: out, fetchedAt: new Date().toISOString(), name: sub?.name, tickers: sub?.tickers, exchanges: sub?.exchanges };
}
