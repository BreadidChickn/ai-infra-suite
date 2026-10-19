# Disclaimer — real-money trading (opt-in, at your own risk)

This is the exact notice the bot prints on the first live start (`aitrader/live_guard.py → DISCLAIMER`).
It applies to every use of this software, paper or live.

```text
================================================================================
  REAL-MONEY TRADING — READ BEFORE CONTINUING
================================================================================
You are about to enable LIVE trading with REAL money through your own brokerage
account. By continuing you acknowledge and agree that:

  * This software is provided "AS IS", without warranty of any kind, express or
    implied, including fitness for a particular purpose. It is NOT financial,
    investment, tax or legal advice, and nobody involved is acting as your
    adviser or broker.
  * The repository owner and all contributors bear NO responsibility or
    liability for any losses, missed gains, fees, taxes, or other damages,
    including those caused by bugs, outages, data errors, stale or inaccurate
    data, model or signal errors, broker/API behaviour, or misconfiguration.
  * YOU alone bear ALL risk of loss, up to and including the entire amount you
    allow the bot to trade, and you are responsible for complying with all laws,
    broker terms and tax obligations that apply to you.
  * Past performance, backtests and paper-trading results do NOT guarantee or
    predict future results. Backtests contain biases and simplifications.
  * Automated strategies — including every strategy in this repository — can
    and do lose money, sometimes quickly. Safety limits reduce but do not
    remove risk (gaps, halts and partial fills can exceed any limit).
  * Only trade money you can afford to lose entirely. You can stop at any time
    by creating state/KILL or setting TRADING_HALT=1.

To proceed, the exact phrase  "I ACCEPT FULL RISK OF LOSS"  must be provided.
================================================================================
```

## How acknowledgement works
- Live trading needs `LIVE_RISK_ACK` set to exactly `I ACCEPT FULL RISK OF LOSS` (plus the other conditions in the README).
- On the first live start the notice above is printed. In an interactive terminal you must also **type** the phrase.
- Non-interactive runs (Grok Bot, cron, cloud) rely on the env phrase. **Grok Bot must show this notice in chat and get your explicit confirmation before it sets `LIVE_RISK_ACK`.**
- The acknowledgement is logged with a UTC timestamp to `state/live_ack.json` and published as `live_ack_at`.
- To withdraw it: unset `LIVE_RISK_ACK`, create `state/KILL` or set `TRADING_HALT=1`, and delete `state/live_ack.json`.

Nothing in this repository is financial, investment, tax or legal advice.
