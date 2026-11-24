# 01 — Recent 15m Buy 13 against a forming New Trend

**Cutoff:** 2026-11-20 08:00 UTC (16:00 UTC+8)  
**Evidence:** The documented 15m example in the [project README](../../../README.md#九转数据从哪来). The complete export and supplementary observations are pending.

| Item | Documented value |
| --- | --- |
| Latest 15m signal | Buy 13 |
| Signal bar opens | 07:15 UTC |
| Signal bar closes | 07:30 UTC |
| Risk Level | 60,698.9 |
| 15m New Trend | Down, forming, step 3/9 |

## Expected checks

- Measure the signal age from 07:30 UTC to 08:00 UTC. The result is 30 minutes.
- With the Buy 13 treated as valid in the documented example, the expected 15m direction is up as a reversal candidate. Flag the forming downward New Trend as opposing evidence.
- Verify Risk Level validity against the full export and available subsequent closed bars before reproducing this result independently.
- Keep higher-timeframe alignment, price confirmation, technical confluence, and the on-chain assessment pending until the corresponding observations are available. The excerpt alone does not establish a confidence grade or bottom scale.

## Reproduce

With historical bars available in the upstream checkout, export the point-in-time snapshot:

```powershell
npm run --silent insight -- BTCUSDC --at 2026-11-20T08:00:00Z --json > insight.json
```

Save the export beside this case. Add technical and on-chain observations when their availability at the cutoff can be established. Run the original and revised Skill on the same inputs and record the actual outputs and discrepancies.

**Status:** Signal-age arithmetic checked against the README example. Complete replay and before/after comparison pending.
