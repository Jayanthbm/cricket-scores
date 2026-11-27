# cricket-scores

Personal cricket scoring API on Cloudflare Workers, backed by the public
Cricbuzz JSON endpoints.

* **v1** (`/matches`, `/matches/:id`, `/team-icon/:imageId/:shortName`) is the
  original wrapper and is unchanged.
* **v2** (`/v2/...`) is the new, integration-first API: one match shape for every
  format and state, plus toss, result, player of the match, target/required rate,
  partnership, last wicket, DRS, Test day/lead, full scorecard and commentary.

Start with **[docs/v2/README.md](docs/v2/README.md)**.

| Doc | Contents |
| --- | --- |
| [docs/v2/01-upstream-analysis.md](docs/v2/01-upstream-analysis.md) | what Cricbuzz returns, every quirk, what does not exist |
| [docs/v2/02-states-matrix.md](docs/v2/02-states-matrix.md) | every state x format, what is populated, real examples |
| [docs/v2/03-api-contract.md](docs/v2/03-api-contract.md) | endpoints, fields, errors, front-end recipes |
| [docs/v2/04-gaps-and-roadmap.md](docs/v2/04-gaps-and-roadmap.md) | known gaps, capture plan, next steps |

## Commands

```bash
npm install
npm run dev        # wrangler dev on :8787
npm test           # vitest (watch);  npx vitest run for one-shot
npm run capture    # long-running upstream capture harness (see doc 04)
npm run deploy     # wrangler deploy
```

## Layout

```
src/index.js     worker entry: v1 router + one additive handleV2() hook
src/routes|services|utils   v1 (untouched)
src/v2/          v2 router, upstream client, normalisers, response envelope
scripts/         capture.mjs upstream capture harness
docs/v2/         the v2 documentation set
test/            vitest suites for v1 + v2
```

## Quick check

```bash
curl -s localhost:8787/v2 | jq
curl -s 'localhost:8787/v2/matches?state=live' | jq
curl -s localhost:8787/v2/matches/178523/live | jq '.data.match.live'
```
