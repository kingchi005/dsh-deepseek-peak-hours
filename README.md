# DeepSeek peak hours

A DeepSeek Harness plugin for the Harness Web UI. One pill under the chat
composer answers the question that decides when to run a batch job:

> **Off-peak · peak in 9h 1m**

Click it for today's local timeline, the rule that decided the current window,
and the price of every model at the active rate. The dot is orange during peak
hours and green off-peak.

Community plugin, not an official DeepSeek product.

## Install

Requires DSH `0.2.2-rc.1` or newer (the running instance reports its version to
the plugin manager) and network access to `github.com`.

From the Web UI, open **Plugins** → **Add plugin** and enter the repository
address:

```
https://github.com/kingchi005/dsh-deepseek-peak-hours
```

From an agent, ask it to run `plugin_manager` with `action: install_bundle` and
the spec form:

```
github:kingchi005/dsh-deepseek-peak-hours#<full-commit-sha>
```

The manager lists the repository through `git ls-remote`, then installs a copy
packed from the commit, selects it as a bundle, and activates the Client module.
Only the files named in `files` ship: the Host anchor, the Client module, the
bundle patch, both locale dictionaries, the icon, this README, the LICENSE and
the tests.

Prefer a spec pinned to a full 40-character commit. The manager can update a
Git-installed bundle in place only while the saved spec pins a commit; a branch
or tag spec installs the same code but has to be reinstalled to move to a newer
release.

## Update

Install the newer commit spec again. The manager replaces the running version;
when the Client module has already loaded, the replacement reports
`restart-required` and shows up after the instance restarts.

## Remove

From the Web UI, open **Plugins**, open this bundle and choose **Uninstall**. From
an agent, use `plugin_manager` with `action: remove_bundle` and the target
`dsh-deepseek-peak-hours`.

## What it computes

| Item | Rule |
|---|---|
| Peak window | 01:00–04:00 and 06:00–10:00 **UTC**, Monday–Friday |
| Off-peak | Every other hour, all weekend, and Chinese public holidays in full |
| Holiday calendar | Official rest days for 2026–2027, as Beijing dates |
| Prices | Per 1M tokens, in USD; off-peak is exactly half of peak |

Everything is derived from the browser clock: there is no Host route, no network
read and no credential. The Host half of the bundle is an empty anchor, so the
widget also works offline and behind a proxy.

## What the panel shows

- **Status** — peak or off-peak, the multiplier (`2× off-peak rates` /
  `50% of peak rates`), the reason (peak hours, off-peak hours, weekend, or
  Chinese public holiday), and the time of the next change.
- **Today's timeline** — 15-minute blocks for the local day with a "now"
  marker, so the two peak windows are visible in local time (for example
  02:00–05:00 and 07:00–11:00 in Africa/Lagos).
- **Current prices** — `deepseek-flash` and `deepseek-v4-pro`, with cache-hit,
  cache-miss and output rates. The active rate is bold; the other window's rate
  sits beside it, so the discount is visible at a glance.
- **Provenance** — the pricing source link and the date the table was checked.

The widget lives in the `conversation.composer.dock` slot, so it appears once a
conversation is open, and it follows the UI language (English or Chinese).

## Updating the data

Two static tables in [`client.js`](client.js) carry the external facts, and the
widget degrades gracefully when they go stale:

- `MODELS` — the per-million-token prices. Re-check
  [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing) and bump
  `PRICING_UPDATED`.
- `HOLIDAYS` — the Chinese rest days, as Beijing calendar dates. Take the
  `isOffDay: true` entries of each year from
  [holiday-cn](https://github.com/NateScarlet/holiday-cn), and add the year to
  `HOLIDAY_YEARS`. Make-up workdays that fall on a weekend are not listed: a
  weekend is off-peak either way. When the current year is missing, the panel
  keeps working on weekday rules and shows a warning.

## Compatibility

The package declares `engines.dsh` and `engines.node`, and the plugin manager
refuses an incompatible version. A registry or local install is judged before
pnpm runs; a Git install can only be judged after the fetch, so an incompatible
instance reports the failure and the profile is rolled back. The widget was built
and verified against DSH `0.2.2-rc.3`, and it only uses the Client `slots` and
`locale` services plus the `conversation.composer.dock` slot.

## Development and tests

The widget's pure logic is tested by extracting the marked region of
`client.js` and importing it, so the tests check the shipped code rather than a
copy. Run from this directory:

```
npm test
```

That runs the Client module load test (module id, slot registration, style
scoping, dictionaries) and the logic test. The logic test is timezone-sensitive;
run it under a half-hour zone (`Asia/Kolkata`), a quarter-hour zone
(`Asia/Kathmandu`), a DST zone (`Europe/Berlin`) and a southern-hemisphere zone
(`Pacific/Auckland`) to cover the timeline arithmetic:

```
TZ=Asia/Kathmandu node test/peak-logic.test.mjs
```

There are no runtime or development dependencies, and nothing to build.

## License

[MIT](LICENSE) © KingDavid Ezennwa
