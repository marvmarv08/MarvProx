# MarvProx

An offline inventory workflow prototype with protected selections, explicit previews, and simulated batch actions. A separate Windows native component contains reproducible patches for read-only Growtopia proxy research.

## Project status

The browser application uses sample inventory only. It does not connect to a game account or move real items. The native component is separate from the browser interface; live connectivity, current-client compatibility, and real inventory accuracy remain unverified. Real item dropping is not implemented.

## Features

- Select eligible items and exclude items that should stay.
- Keep locks, equipped items, and unidentified items protected.
- Preview exact quantities before confirming a simulated operation.
- Process simulated actions sequentially with a Stop control.
- Track completed, skipped, and failed actions separately.
- Reject stale previews and duplicate confirmations.
- Use keyboard-accessible controls and a responsive confirmation dialog.
- Run the browser demo offline without account credentials or external assets.

## Run the browser demo

Clone or download this repository, then open `index.html` in a modern browser. Keep `styles.css` and `src/` beside it. No installation, account, or backend is required for the sample application.

1. Uncheck an ordinary item to exclude it.
2. Select **Preview Drop All** to review the selected sample items.
3. Choose **Cancel** or **Confirm simulated drop**.
4. Use **Stop** to prevent the next action, or **Reset Sample Inventory** to start again.

An action already in progress may finish after Stop is pressed. All results belong to the sample inventory.

## Architecture

| Component | Responsibility |
| --- | --- |
| `src/inventory.js` | Inventory validation, protected items, and selection |
| `src/operation.js` | Preview validation, confirmation, sequencing, and stopping |
| `src/app.js` | Browser rendering and sample-data updates |
| `proxy/patches/` | Native offline-probe and read-only candidate changes |
| `proxy/scripts/` | Pinned-source preparation and Windows build/check helpers |
| `proxy/upstream.lock.json` | Exact upstream and submodule revisions |
| `proxy/conan.lock` | Native dependency recipe revisions |

## Development checks

Use Node.js 24 and Python 3. The package declares its own CommonJS module boundary and has no runtime dependencies:

```sh
node --test tests/inventory.test.cjs tests/operation.test.cjs
node --check src/inventory.js
node --check src/operation.js
node --check src/app.js
python3 -m unittest discover -s proxy/tests -v
```

The optional browser check uses Playwright and Chromium:

```sh
node tests/browser-check.cjs
```

Install `playwright-core` as a local test tool, or set `PLAYWRIGHT_MODULE` to an installed module's absolute path. Set `CHROMIUM_EXECUTABLE` when Chromium is stored elsewhere. Generated screenshots go in the ignored `artifacts/` folder. These tools are not needed to open the demo.

See [verification scope](docs/verification.md) for results and limits, and the [native component guide](proxy/README.md) for build prerequisites.

## Repository hygiene

This repository contains a selected source snapshot. Original local Git history, private planning records, environment files, certificates, keys, local settings, reference clones, binaries, logs, and generated screenshots are excluded. `.gitignore` also protects against adding those files during future work. Dependency lockfiles remain included for reproducibility.

## Third-party code

The native patches target an MIT-licensed upstream dependency. Required attribution and its full license are preserved in [third-party notices](THIRD_PARTY_NOTICES.md) and [the upstream license](proxy/UPSTREAM_LICENSE.txt). Other projects used only for historical comparison are not bundled or listed as features.
