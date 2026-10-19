import {
  daysBetween,
  fmtDeltaPct,
  fmtMoney,
  fmtPp,
  periodEnds,
  pointAt,
  series,
  windowVal,
  yearAgoEnd,
  type CompanyFin,
  type PeriodMode,
} from './secFinancials';
import type { FinNote } from '../data/financialNotes';

export type Tone = 'pos' | 'neg' | 'neutral';
export interface Insight {
  tone: Tone;
  title: string;
  detail: string;
  basis: 'SEC' | 'curated';
}

const pct = (a?: number, b?: number) => (a != null && b != null && b !== 0 ? (a / b) * 100 : undefined);

/** Window label: TTM (quarterly mode) or fiscal year (annual mode). */
export function windowName(mode: PeriodMode) {
  return mode === 'annual' ? 'fiscal year' : 'trailing 12 months';
}

export function analyze(fin: CompanyFin | null, mode: PeriodMode, end: string | undefined, note: FinNote) {
  const insights: Insight[] = [];
  const watch: string[] = [];
  const cur = fin?.currency;
  if (!fin || !end) {
    for (const p of note.positives) insights.push({ tone: 'pos', title: 'Business strength', detail: p, basis: 'curated' });
    for (const r of note.risks) insights.push({ tone: 'neg', title: 'Risk', detail: r, basis: 'curated' });
    return { insights, watch: [...note.watch] };
  }
  const ends = periodEnds(fin, mode);
  const prior = yearAgoEnd(ends, end);
  const w = (k: Parameters<typeof windowVal>[1], e = end) => windowVal(fin, k, mode, e);
  const W = windowName(mode);

  const rev = w('revenue');
  const revP = prior ? w('revenue', prior) : undefined;
  const opInc = w('operatingIncome');
  const opIncP = prior ? w('operatingIncome', prior) : undefined;
  const ni = w('netIncome');
  const ocf = w('ocf');
  const capex = w('capex');
  const capexP = prior ? w('capex', prior) : undefined;
  const fcf = w('fcf');
  const buy = w('buybacks');
  const div = w('dividends');
  const sbc = w('sbc');
  const dIss = w('debtIssued');
  const dRep = w('debtRepaid');

  // 1. Revenue growth
  if (rev != null && revP != null) {
    const g = pct(rev - revP, Math.abs(revP))!;
    insights.push({
      tone: g >= 10 ? 'pos' : g < 0 ? 'neg' : 'neutral',
      title: g >= 0 ? 'Revenue growth' : 'Revenue decline',
      detail: `Revenue ${fmtDeltaPct(g)} YoY over the ${W} (${fmtMoney(rev, cur)} vs ${fmtMoney(revP, cur)}).`,
      basis: 'SEC',
    });
    if (g < 0) watch.push('Whether revenue stabilises next quarter');
  }

  // 2. Operating margin trend
  const om = pct(opInc, rev);
  const omP = pct(opIncP, revP);
  if (om != null && omP != null) {
    const d = om - omP;
    insights.push({
      tone: d >= 1 ? 'pos' : d <= -1 ? 'neg' : 'neutral',
      title: d >= 1 ? 'Margin expansion' : d <= -1 ? 'Margin compression' : 'Stable margins',
      detail: `Operating margin ${om.toFixed(1)}% vs ${omP.toFixed(1)}% a year earlier (${fmtPp(d)}).`,
      basis: 'SEC',
    });
    if (d <= -1) watch.push('Operating margin trajectory and cost discipline');
  }

  // 3. GAAP profitability
  if (ni != null && ni < 0) {
    insights.push({ tone: 'neg', title: 'GAAP net loss', detail: `Net loss of ${fmtMoney(ni, cur)} over the ${W}.`, basis: 'SEC' });
    watch.push('Path to GAAP profitability');
  }

  // 4. Free cash flow
  if (fcf != null) {
    const fm = pct(fcf, rev);
    if (fcf < 0) {
      insights.push({ tone: 'neg', title: 'Negative free cash flow', detail: `FCF ${fmtMoney(fcf, cur)} (OCF − capex) over the ${W} — spending exceeds cash generated.`, basis: 'SEC' });
      watch.push('Funding of the cash shortfall (debt, equity or cash reserves)');
    } else if (fm != null) {
      insights.push({
        tone: fm >= 15 ? 'pos' : 'neutral',
        title: 'Free cash flow',
        detail: `FCF ${fmtMoney(fcf, cur)} — ${fm.toFixed(1)}% of revenue over the ${W}.`,
        basis: 'SEC',
      });
    }
  }

  // 5. Capex burden
  if (capex != null && ocf != null && ocf > 0) {
    const burden = (capex / ocf) * 100;
    const capexG = capexP ? pct(capex - capexP, Math.abs(capexP)) : undefined;
    const growthTxt = capexG != null ? `; capex ${fmtDeltaPct(capexG)} YoY` : '';
    if (burden >= 60) {
      insights.push({ tone: 'neg', title: 'Heavy capex burden', detail: `Capex absorbs ${burden.toFixed(0)}% of operating cash flow${growthTxt}. Returns depend on future utilisation of this capacity.`, basis: 'SEC' });
      watch.push('Capex guidance vs operating cash flow');
    } else if (burden <= 20) {
      insights.push({ tone: 'pos', title: 'Asset-light', detail: `Capex is only ${burden.toFixed(0)}% of operating cash flow${growthTxt}.`, basis: 'SEC' });
    } else {
      insights.push({ tone: 'neutral', title: 'Moderate capex', detail: `Capex uses ${burden.toFixed(0)}% of operating cash flow${growthTxt}.`, basis: 'SEC' });
    }
    if (capexG != null && capexG >= 40) watch.push('Payback on accelerating capex');
  }

  // 6. Dilution vs buybacks (diluted share count, same-period YoY)
  const sh = pointAt(fin, 'dilutedShares', mode, end)?.val;
  const shEnds = series(fin, 'dilutedShares', mode).map((p) => p.end);
  const shPriorEnd = shEnds.find((e) => {
    const d = daysBetween(e, end);
    return d >= 340 && d <= 390;
  });
  const shP = shPriorEnd ? pointAt(fin, 'dilutedShares', mode, shPriorEnd)?.val : undefined;
  if (sh != null && shP != null && shP > 0) {
    const ch = ((sh - shP) / shP) * 100;
    insights.push({
      tone: ch <= -0.5 ? 'pos' : ch >= 1 ? 'neg' : 'neutral',
      title: ch <= -0.5 ? 'Share count shrinking' : ch >= 1 ? 'Shareholder dilution' : 'Share count flat',
      detail: `Diluted weighted-average shares ${fmtDeltaPct(ch)} YoY — ${ch < 0 ? 'each share owns a larger slice of earnings' : ch >= 1 ? 'each share owns a smaller slice of earnings' : 'little change in ownership per share'}.`,
      basis: 'SEC',
    });
    if (ch >= 1) watch.push('Stock comp and equity issuance (dilution)');
  }
  if (buy != null && sbc != null && sbc > 0) {
    insights.push({
      tone: buy >= sbc ? 'pos' : 'neutral',
      title: buy >= sbc ? 'Buybacks exceed stock comp' : 'Buybacks below stock comp',
      detail: `Buybacks ${fmtMoney(buy, cur)} vs stock-based compensation ${fmtMoney(sbc, cur)} over the ${W}.`,
      basis: 'SEC',
    });
  }

  // 7. Dividend capacity
  if (div != null && div > 0) {
    if (fcf != null && fcf > 0) {
      const payout = (div / fcf) * 100;
      insights.push({
        tone: payout <= 60 ? 'pos' : payout > 100 ? 'neg' : 'neutral',
        title: 'Dividend coverage',
        detail: `Dividends ${fmtMoney(div, cur)} = ${payout.toFixed(0)}% of free cash flow${payout > 100 ? ' — not covered by FCF' : ''}.`,
        basis: 'SEC',
      });
    } else if (fcf != null) {
      insights.push({ tone: 'neg', title: 'Dividend not covered', detail: `Dividends ${fmtMoney(div, cur)} paid while FCF is negative.`, basis: 'SEC' });
      watch.push('Dividend sustainability');
    }
  } else if (series(fin, 'dividends', mode).length === 0) {
    insights.push({ tone: 'neutral', title: 'No regular dividend tagged', detail: 'Shareholder returns come from growth and/or buybacks rather than dividends.', basis: 'SEC' });
  }

  // 8. Total shareholder payout vs FCF
  if (fcf != null && fcf > 0 && (buy || div)) {
    const tot = (buy || 0) + (div || 0);
    const r = (tot / fcf) * 100;
    if (r > 110) {
      insights.push({ tone: 'neutral', title: 'Returning more than FCF', detail: `Buybacks + dividends = ${r.toFixed(0)}% of FCF, funded from cash reserves or debt.`, basis: 'SEC' });
    }
  }

  // 9. Debt flows
  if (dIss != null || dRep != null) {
    const net = (dIss || 0) - (dRep || 0);
    if (ocf && Math.abs(net) > 0.1 * Math.abs(ocf)) {
      insights.push({
        tone: net > 0 ? 'neg' : 'pos',
        title: net > 0 ? 'Net borrowing' : 'Deleveraging',
        detail: `Net debt ${net > 0 ? 'issued' : 'repaid'} ${fmtMoney(Math.abs(net), cur)} over the ${W} (${pct(Math.abs(net), Math.abs(ocf))!.toFixed(0)}% of OCF).`,
        basis: 'SEC',
      });
      if (net > 0) watch.push('Leverage and interest costs');
    }
  }

  // 10. Curated structural positives / risks (concentration, geopolitics)
  for (const p of note.positives) insights.push({ tone: 'pos', title: 'Business strength', detail: p, basis: 'curated' });
  for (const r of note.risks) insights.push({ tone: 'neg', title: 'Concentration / geopolitical', detail: r, basis: 'curated' });

  const allWatch = [...new Set([...watch, ...note.watch])];
  return { insights, watch: allWatch };
}

/* ------------------------------------------------------------------ */
/* Year-to-date analysis (first-time filers, e.g. a company whose only */
/* 10-Q so far reports cash flows on a 6-month YTD basis)              */
/* ------------------------------------------------------------------ */

export interface YtdWindow {
  start: string;
  end: string;
  months: number;
  priorStart?: string;
  priorEnd?: string;
}

const YTD_KEYS = ['ocf', 'capex', 'fcf', 'investPurchases', 'buybacks', 'debtIssued', 'debtRepaid'] as const;

/** Latest YTD window available for cash-flow metrics (and its year-earlier comparable), or null. */
export function ytdWindow(fin: CompanyFin | null | undefined): YtdWindow | null {
  if (!fin) return null;
  for (const k of YTD_KEYS) {
    const ys = fin.metrics?.[k]?.ytd;
    if (!ys?.length) continue;
    const last = ys[ys.length - 1]!;
    const prior = ys.find((p) => {
      const d = daysBetween(p.end, last.end);
      return d >= 340 && d <= 390;
    });
    return {
      start: last.start,
      end: last.end,
      months: last.ytdMonths || Math.round(daysBetween(last.start, last.end) / 30.44),
      priorStart: prior?.start,
      priorEnd: prior?.end,
    };
  }
  return null;
}

/** Value of a metric over a YTD window: the filed YTD total, else the sum of discrete quarters inside the window. */
export function ytdVal(fin: CompanyFin | null | undefined, key: Parameters<typeof series>[1], start?: string, end?: string): number | undefined {
  if (!fin || !start || !end) return undefined;
  const y = fin.metrics?.[key]?.ytd?.find((p) => Math.abs(daysBetween(p.end, end)) <= 7 && Math.abs(daysBetween(p.start, start)) <= 7);
  if (y) return y.val;
  const qs = series(fin, key, 'quarterly').filter((p) => daysBetween(start, p.start) >= -7 && daysBetween(p.end, end) >= -7);
  const months = daysBetween(start, end) / 30.44;
  if (!qs.length || Math.abs(qs.length * 3 - months) > 1.5) return undefined;
  return qs.reduce((a, p) => a + p.val, 0);
}

export function analyzeYtd(fin: CompanyFin | null, w: YtdWindow | null): { insights: Insight[]; watch: string[] } {
  const insights: Insight[] = [];
  const watch: string[] = [];
  if (!fin || !w) return { insights, watch };
  const cur = fin.currency;
  const W = `${w.months} months to ${w.end} (YTD, as filed in the 10-Q)`;
  const g = (k: Parameters<typeof series>[1]) => ytdVal(fin, k, w.start, w.end);
  const gp = (k: Parameters<typeof series>[1]) => ytdVal(fin, k, w.priorStart, w.priorEnd);
  const rev = g('revenue');
  const revP = gp('revenue');
  if (rev != null && revP != null && revP !== 0) {
    const gr = ((rev - revP) / Math.abs(revP)) * 100;
    insights.push({
      tone: gr >= 10 ? 'pos' : gr < 0 ? 'neg' : 'neutral',
      title: gr >= 0 ? 'Revenue growth (YTD)' : 'Revenue decline (YTD)',
      detail: `Revenue ${fmtDeltaPct(gr)} YoY over the ${W}: ${fmtMoney(rev, cur)} vs ${fmtMoney(revP, cur)}.`,
      basis: 'SEC',
    });
  }
  const op = g('operatingIncome');
  const opP = gp('operatingIncome');
  if (op != null && rev) {
    const om = (op / rev) * 100;
    const omP = opP != null && revP ? (opP / revP) * 100 : undefined;
    insights.push({
      tone: op < 0 ? 'neg' : om >= 15 ? 'pos' : 'neutral',
      title: op < 0 ? 'Operating loss (YTD)' : 'Operating profit (YTD)',
      detail: `Operating ${op < 0 ? 'loss' : 'income'} ${fmtMoney(op, cur)} (${om.toFixed(1)}% margin) over the ${W}${omP != null ? ` vs ${omP.toFixed(1)}% a year earlier` : ''}.`,
      basis: 'SEC',
    });
  }
  const ni = g('netIncome');
  if (ni != null && ni < 0) {
    insights.push({ tone: 'neg', title: 'GAAP net loss (YTD)', detail: `Net loss of ${fmtMoney(ni, cur)} over the ${W}.`, basis: 'SEC' });
    watch.push('Path to GAAP profitability');
  }
  const ocf = g('ocf');
  const capex = g('capex');
  const capexP = gp('capex');
  const fcf = g('fcf');
  if (fcf != null && fcf < 0) {
    insights.push({
      tone: 'neg',
      title: 'Negative free cash flow (YTD)',
      detail: `FCF ${fmtMoney(fcf, cur)} (OCF ${fmtMoney(ocf, cur)} − capex ${fmtMoney(capex, cur)}) over the ${W} — the build-out is funded by IPO proceeds and debt, not operations.`,
      basis: 'SEC',
    });
    watch.push('Funding of the cash shortfall (debt, equity or cash reserves)');
  }
  if (capex != null && rev) {
    const cg = capexP ? ((capex - capexP) / Math.abs(capexP)) * 100 : undefined;
    insights.push({
      tone: 'neg',
      title: 'Very heavy capex',
      detail: `Capex ${fmtMoney(capex, cur)} = ${((capex / rev) * 100).toFixed(0)}% of revenue over the ${W}${cg != null ? ` (capex ${fmtDeltaPct(cg)} YoY)` : ''}. Returns depend on filling the new data-center / satellite capacity.`,
      basis: 'SEC',
    });
    watch.push('Capex guidance vs operating cash flow');
  }
  const dIss = g('debtIssued');
  const dRep = g('debtRepaid');
  if (dIss != null || dRep != null) {
    const net = (dIss || 0) - (dRep || 0);
    insights.push({
      tone: net > 0 ? 'neg' : 'pos',
      title: net > 0 ? 'Net borrowing (YTD)' : 'Deleveraging (YTD)',
      detail: `Debt issued ${fmtMoney(dIss, cur)} vs repaid ${fmtMoney(dRep, cur)} → net ${net > 0 ? 'borrowed' : 'repaid'} ${fmtMoney(Math.abs(net), cur)} over the ${W}.`,
      basis: 'SEC',
    });
    if (net > 0) watch.push('Leverage and interest costs');
  }
  return { insights, watch };
}
