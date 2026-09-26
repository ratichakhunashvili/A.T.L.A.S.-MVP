# End-to-end suites

These drive the **real application in a real browser** — the real Mapbox map,
the real recommendation engine, the real repositories. Nothing is mocked, which
is why they have caught bugs that unit tests would not: a missed `style.load`
race, a session that lagged a render, a panel missing its gutter.

## Running them

```bash
npm run dev            # in one terminal — the suites need a server
npm run test:e2e       # in another
```

Individually:

```bash
node tests/enginetests.mjs
node tests/journey.mjs
```

### Configuration

Everything machine-specific is an environment variable with a sensible default:

| Variable | Default | What it is |
|---|---|---|
| `BASE_URL` | `http://localhost:5180` | the running dev server |
| `CHROME_PATH` | auto-detected | the browser binary |
| `PUPPETEER_PATH` | resolved from `node_modules` | an existing puppeteer-core |
| `TEST_OUT` | `tests/output` | where screenshots land (git-ignored) |

`puppeteer-core` is not a dependency of this project — it is large and only
needed to run these. Install it, or point `PUPPETEER_PATH` at a copy you
already have.

## The suites

| Suite | What it covers |
|---|---|
| `enginetests.mjs` | 70 assertions — the recommendation engine, through a dev-only bridge |
| `achievements.mjs` | 45 — achievements, attraction codes, range, momentum, the dev account |
| `journey.mjs` | 33 — the whole guest journey, QR to completed task |
| `hoteldelete.mjs` | 21 — deleting a property and its cascade |
| `interact.mjs` | the overlay state machine and admin→guest writes |
| `newfeatures.mjs` | proximity, distances and the account flow |
| `locationtests.mjs` | GPS correctness: accuracy, permissions, one watcher |
| `ladder.mjs` | the geolocation retry ladder |
| `models-e2e.mjs` | 3D models end to end, including geographic anchoring |
| `adminpick.mjs` | picking a location in the model editor |
| `editor-drag.mjs` | dragging a model in 3D |
| `perfprobe.mjs` | position updates do not churn the map |
| `review.mjs` | captures the whole product for visual review |

## Two things worth knowing

**Run them one at a time.** They render the map with SwiftShader; several
browsers at once starve each other and produce false failures.

**They wait on conditions, not on delays.** Every fixed `setTimeout` that was
once in here eventually went flaky. If you add a step, wait for the thing you
are about to act on.
