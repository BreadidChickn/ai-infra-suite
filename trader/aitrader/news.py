"""Python port of services/newsFeed.ts: Google News RSS fetch, source quality, lexicon sentiment,
dedupe, company tagging, and headline weight = quality*exp(-age/240h)*(1+0.25*log2(1+dupes))."""
import math, re, time, html, email.utils
import xml.etree.ElementTree as ET
import requests
from .universe import COMPANIES

NEWS_QUERIES = [
    'Nvidia OR "AI chips" OR semiconductor when:7d', 'AI chip stocks when:1d',
    'TSMC OR foundry OR "Samsung Foundry" OR "Intel Foundry" when:30d',
    'ASML OR "Applied Materials" OR "Lam Research" OR KLA chip equipment when:30d',
    'HBM OR "SK Hynix" OR Micron memory chips when:30d',
    'Synopsys OR Cadence OR "Arm Holdings" chip design when:30d',
    'hyperscaler capex "data center" Microsoft OR Amazon OR Google OR Meta when:7d',
    'OpenAI OR Anthropic OR xAI compute deal when:7d', '"AI infrastructure" when:1d',
    '"export controls" chips China OR tariffs semiconductors when:30d',
    'Trump Xi rare earths AI chips when:30d', 'SpaceX OR Starlink OR SPCX when:7d',
    '"data center" nuclear power OR PPA OR SMR when:30d',
    '"data center" "natural gas" OR "gas turbines" OR pipeline when:30d',
    'utility "data center" load OR "large load" OR interconnection when:30d',
    '"data center" solar OR wind OR geothermal OR hydro power deal when:30d',
    'Constellation OR Vistra OR Talen OR Oklo OR NuScale OR Cameco when:30d',
    '"GE Vernova" OR "Siemens Energy" OR "Bloom Energy" OR Vertiv OR Eaton data center when:30d',
    'biofuel OR "renewable diesel" OR "renewable natural gas" "data center" when:30d',
    'AI power demand electricity grid when:1d',
]

TIER1 = re.compile(r"reuters|bloomberg|wall street journal|wsj|financial times|\bft\b|associated press|\bap news\b|cnbc|the information|barron|nikkei|the economist", re.I)
TIER2 = re.compile(r"utility dive|datacenterdynamics|\bdcd\b|power magazine|powermag|world nuclear news|data center frontier|latitude media|heatmap|canary media|s&p global|marketwatch|yahoo finance|fortune|axios|business insider|new york times|washington post|techcrunch|the verge|tom's hardware|semianalysis|eetimes|ars technica|wired|forbes|politico|the register|investor's business daily|digitimes|trendforce|naturalgasintel|ngi|e&e news|siliconangle|construction dive|anandtech|ieee spectrum|bnef|platts|argus|nasdaq|globe and mail|nikkei asia", re.I)
LOW = re.compile(r"motley fool|fool\.com|zacks|investorplace|benzinga|seeking alpha|stocktitan|marketbeat|simply wall|tipranks|gurufocus|insidermonkey|ad hoc news|ad-hoc|finviz|24/7 wall|msn$|blockchain|coin", re.I)


def source_quality(source, url=""):
    s = f"{source} {url or ''}"
    if TIER1.search(s): return 1.0
    if TIER2.search(s): return 0.8
    if LOW.search(s): return 0.35
    return 0.55


PHRASES = [('force majeure', -1.6), ('sell-off', -1.6), ('all-time high', 1.8), ('record high', 1.8),
           ('price target raised', 1.4), ('raises guidance', 1.5), ('cuts guidance', -1.6), ('falls short', -1.3),
           ('stop-work', -1.5), ('data center pause', -1.2), ('supply crunch', -1.1), ('sold out', 0.8)]
_LEX_SRC = """excite 1 excites 1 upbeat 1.2 surge 2 surges 2 soar 2 soars 2 jump 1.5 jumps 1.5 rally 1.5 rallies 1.5 gain 1 gains 1
rise 1 rises 1 climbs 1 climb 1 beat 1.5 beats 1.5 record 1.2 boost 1.2 boosts 1.2 win 1.2 wins 1.2 won 1.1 expand 1 expands 1
expansion 0.8 strong 1 stronger 1 growth 1 upgrade 1.5 upgraded 1.5 upgrades 1.4 approve 1.2 approves 1.2 approved 1.2 approval 1
deal 0.6 agreement 0.5 partnership 0.6 invest 0.6 invests 0.7 investment 0.5 secures 1 signs 0.6 inks 0.6 lands 0.8 accelerate 0.8
accelerates 0.8 optimism 1.2 optimistic 1.2 relief 1 truce 1 eases 0.8 ease 0.8 lifts 1 tops 1 profit 0.6 milestone 1 breakthrough 1.5
outperform 1.5 bullish 1.5 restart 0.7 revive 0.8 revives 0.8 landmark 0.8 boom 1.2 demand 0.3 launches 0.4 unveils 0.4 online 0.4
recover 0.9 recovers 0.9 rebound 1.1 rebounds 1.1
plunge -2 plunges -2 plummet -2 plummets -2 slump -1.8 slumps -1.8 tumble -1.8 tumbles -1.8 crash -2 crashes -2 sink -1.5 sinks -1.5
falls -1.2 fall -1 drop -1.2 drops -1.2 slide -1.2 slides -1.2 decline -1 declines -1 cut -1 cuts -1 miss -1.5 misses -1.5
downgrade -1.5 downgraded -1.5 downgrades -1.4 warn -1.3 warns -1.3 warning -1.2 risk -0.7 risks -0.8 delay -1.2 delays -1.2
delayed -1.2 halt -1.5 halts -1.5 halted -1.5 pause -1 paused -1 ban -1.5 bans -1.5 banned -1.5 restrict -1.2 restricts -1.2
restrictions -1.2 curbs -1.2 curb -1.1 sanction -1.3 sanctions -1.3 tariff -1 tariffs -1 probe -1.2 investigation -1 lawsuit -1.2
sues -1.2 shortage -1.2 shortages -1.2 bottleneck -1 bottlenecks -1 outage -1.3 outages -1.3 blackout -1.5 glut -1 bubble -1.3
selloff -1.6 loss -1 losses -1 layoffs -1.3 concerns -0.8 concern -0.7 fears -1.1 fear -1 worries -1 slow -0.8 slows -0.8
slowdown -1.2 weak -1 weaker -1 struggle -1 struggles -1 oppose -0.8 opposition -0.8 backlash -1.1 strain -1 strains -1 crisis -1.5
war -1.2 tension -1 tensions -1 threat -1 threatens -1.1 bearish -1.5 overvalued -1.2 cancel -1.4 cancels -1.4 cancelled -1.4
canceled -1.4 scrap -1.3 scraps -1.3 rejects -1.2 rejected -1.2 denied -1.1 denies -1 hurdles -0.9 hurdle -0.9 squeeze -0.9
volatile -0.6 volatility -0.6 uncertainty -0.9 shortfall -1.2 writedown -1.4 write-down -1.4"""
_t = _LEX_SRC.split()
LEXICON = {_t[i]: float(_t[i + 1]) for i in range(0, len(_t), 2)}
NEGATORS = {'not', 'no', 'never', 'without', "won't", "isn't", "doesn't", "didn't", 'fail', 'fails', 'failed', 'lack', 'lacks'}


def score_sentiment(title):
    """Same as scoreSentiment(): sum of weights, negator flip x-0.7, squash s/sqrt(s^2+6) -> [-1,1]."""
    lower = f" {title.lower()} "
    s = 0.0
    for p, w in PHRASES:
        if p in lower:
            s += w
            lower = lower.replace(p, " ")
    toks = [t for t in re.split(r"[^a-z0-9'-]+", lower) if t]
    for i, t in enumerate(toks):
        w = LEXICON.get(t)
        if w is None: continue
        neg = (i >= 1 and toks[i - 1] in NEGATORS) or (i >= 2 and toks[i - 2] in NEGATORS)
        s += -0.7 * w if neg else w
    return 0.0 if s == 0 else round(s / math.sqrt(s * s + 6), 3)


STOP = set('the a an and or of to in on for with as at by from is are be its it this that after over into new says say amid us'.split())


def _words(t):
    return {w for w in re.sub(r"[^a-z0-9 ]+", " ", t.lower()).split() if len(w) > 1 and w not in STOP}


def dedupe(raw):
    """Jaccard >= 0.6 merge; keep best quality / earliest; count dupes."""
    raw = sorted(raw, key=lambda r: (-r["quality"], r["published"]))
    kept = []
    for r in raw:
        w = _words(r["title"])
        for k in kept:
            inter = len(w & k["w"]); uni = len(w | k["w"]) or 1
            if inter / uni >= 0.6:
                k["dupes"] += 1; break
        else:
            kept.append({**r, "w": w, "dupes": 0})
    for k in kept: k.pop("w")
    return kept


def _matchers():
    out = []
    for c in COMPANIES:
        pats = [re.escape(c["name"])]
        if c.get("ticker") and len(c["ticker"]) >= 3 and "." not in c["ticker"]:
            pats.append(r"\b" + re.escape(c["ticker"]) + r"\b")
        out.append((c["id"], re.compile("|".join(pats), re.I)))
    return out


_M = _matchers()


def tag_companies(title):
    return [cid for cid, rx in _M if rx.search(title)]


def parse_rss(xml):
    out = []
    root = ET.fromstring(xml)
    for it in root.iter("item"):
        title = html.unescape(it.findtext("title") or "")
        src_el = it.find("source")
        source = src_el.text if src_el is not None else ""
        url = src_el.get("url", "") if src_el is not None else ""
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        pd = it.findtext("pubDate")
        try:
            ts = email.utils.parsedate_to_datetime(pd).timestamp()
        except Exception:
            continue
        out.append({"title": title, "source": source, "published": ts, "quality": source_quality(source, url)})
    return out


def fetch_feed(queries=NEWS_QUERIES, timeout=15):
    raw, fails = [], []
    for q in queries:
        try:
            r = requests.get("https://news.google.com/rss/search", params={"q": q, "hl": "en-US", "gl": "US", "ceid": "US:en"},
                             timeout=timeout, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status(); raw += parse_rss(r.text)
        except Exception as e:
            fails.append((q, str(e)[:80]))
        time.sleep(0.3)
    items = dedupe(raw)
    for i in items:
        i["sentiment"] = score_sentiment(i["title"])
        i["companies"] = tag_companies(i["title"])
    return items, fails


def weight(item, now):
    age_h = max(0.0, (now - item["published"]) / 3600)
    return item["quality"] * math.exp(-age_h / 240) * (1 + 0.25 * math.log2(1 + item["dupes"]))


def weighted_score(items, now, max_age_h=24 * 30):
    """-100..100, or None (N/A) when no headlines."""
    sw = s = 0.0
    for i in items:
        if (now - i["published"]) / 3600 > max_age_h: continue
        w = weight(i, now); sw += w; s += w * i["sentiment"]
    return 100 * s / sw if sw > 0 else None


def company_news_sent(items, now):
    by = {}
    for i in items:
        for cid in i["companies"]:
            by.setdefault(cid, []).append(i)
    return {cid: weighted_score(v, now) for cid, v in by.items()}
