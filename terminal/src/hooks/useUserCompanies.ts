import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AddError,
  fetchGrokStatus,
  fetchRequests,
  fetchUserCompanies,
  pullFinancials,
  removeUserCompany,
  retryGrokRequests,
  saveUserCompany,
  sendGrokRequest,
  toCompany,
  userCompanyId,
  type AddInput,
  type GrokRequest,
  type UserCompany,
} from '../services/userCompanies';
import type { Company } from '../types';

export type AddPhase = 'pulling' | 'saving' | 'requesting' | 'done' | 'error';
export interface AddProgress {
  phase: AddPhase;
  message?: string;
}

export interface UserCompaniesApi {
  companies: UserCompany[];
  /** User-added companies NOT yet in the built-in data, as Company records (Financials picker). */
  pendingCompanies: Company[];
  /** CIKs of user-added companies that now ship in the built-in data. */
  integratedCiks: Set<string>;
  requests: GrokRequest[];
  requestFor: (cik: string) => GrokRequest | undefined;
  configured: boolean | null;
  storage: 'server' | 'local';
  progress: Record<string, AddProgress>;
  add: (input: AddInput) => Promise<string | null>;
  remove: (cik: string) => Promise<void>;
  retry: (cik?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const pad = (c: string) => c.replace(/\D/g, '').padStart(10, '0');

export function useUserCompanies(builtIn: Company[]): UserCompaniesApi {
  const [companies, setCompanies] = useState<UserCompany[]>([]);
  const [requests, setRequests] = useState<GrokRequest[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [storage, setStorage] = useState<'server' | 'local'>('server');
  const [progress, setProgress] = useState<Record<string, AddProgress>>({});

  const refresh = useCallback(async () => {
    const [uc, rq, st] = await Promise.all([fetchUserCompanies(), fetchRequests(), fetchGrokStatus()]);
    setCompanies(uc.companies);
    setStorage(uc.storage);
    setRequests(rq.requests);
    setConfigured(st ?? rq.configured);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const builtInCiks = useMemo(
    () => new Set(builtIn.filter((c) => c.cik && !c.userAdded).map((c) => pad(c.cik!))),
    [builtIn]
  );

  const integratedCiks = useMemo(
    () => new Set(companies.filter((u) => builtInCiks.has(pad(u.cik))).map((u) => pad(u.cik))),
    [companies, builtInCiks]
  );

  const pendingCompanies = useMemo(
    () => companies.filter((u) => !builtInCiks.has(pad(u.cik))).map(toCompany),
    [companies, builtInCiks]
  );

  const requestFor = useCallback((cik: string) => requests.find((r) => r.cik === pad(cik)), [requests]);

  const setP = (cik: string, p: AddProgress | null) =>
    setProgress((s) => {
      const n = { ...s };
      if (p) n[cik] = p;
      else delete n[cik];
      return n;
    });

  const add = useCallback(
    async (input: AddInput): Promise<string | null> => {
      const cik = pad(input.cik);
      if (input.check.status !== 'ok') {
        setP(cik, { phase: 'error', message: 'No formal financial filings — can’t add' });
        return null;
      }
      try {
        setP(cik, { phase: 'pulling', message: 'Pulling SEC XBRL company facts…' });
        let fin = null;
        try {
          fin = await pullFinancials(cik, input.ticker);
        } catch (err) {
          throw new AddError(`Couldn’t pull SEC financials (${(err as Error).message}). Try again.`);
        }
        setP(cik, { phase: 'saving', message: 'Saving to your terminal…' });
        const saved = await saveUserCompany({ ...input, cik }, fin);
        setCompanies((list) => [...list.filter((c) => c.cik !== cik), saved]);
        setP(cik, { phase: 'requesting', message: 'Sending add request to Grok Bot…' });
        const req = await sendGrokRequest({ cik, ticker: input.ticker, name: input.name, note: input.note });
        setRequests((list) => [...list.filter((r) => r.cik !== cik), req]);
        setP(cik, { phase: 'done' });
        void fetchGrokStatus().then((s) => s != null && setConfigured(s));
        return userCompanyId(cik);
      } catch (err) {
        setP(cik, { phase: 'error', message: err instanceof Error ? err.message : String(err) });
        return null;
      }
    },
    []
  );

  const remove = useCallback(async (cik: string) => {
    const p = pad(cik);
    await removeUserCompany(p);
    setCompanies((list) => list.filter((c) => c.cik !== p));
    setP(p, null);
  }, []);

  const retry = useCallback(
    async (cik?: string) => {
      const list = await retryGrokRequests(cik ? pad(cik) : undefined);
      if (list) setRequests(list);
      await refresh();
    },
    [refresh]
  );

  return {
    companies,
    pendingCompanies,
    integratedCiks,
    requests,
    requestFor,
    configured,
    storage,
    progress,
    add,
    remove,
    retry,
    refresh,
  };
}
