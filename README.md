# SuperSplit

A bill splitter that lives entirely in your browser. No account, no server, no
network. Everything is stored in IndexedDB on the device and the app keeps
working with the Wi-Fi off.

Built as a plain ES-module PWA: no framework, no build step, no runtime
dependencies. Serve the folder and it runs.

## Run it

```bash
python3 .claude/devserver.py 5173
```

Then open <http://localhost:5173/supersplit/>. The dev server mirrors the
production path prefix, so local URLs match the deployed ones. Any static server works (`npx serve`,
`python3 -m http.server`, Netlify, GitHub Pages, an S3 bucket); the bundled dev
server just adds no-cache headers so edits show up immediately.

It needs `http://` or `https://`. Opening `index.html` over `file://` breaks ES
modules and service workers. Add `?nosw=1` to the URL to skip service-worker
registration while developing.

To install it as an app, use your browser's "Install" or "Add to Home Screen".

## What it does

**Groups.** One group per trip, flat or dinner. Add people by name and each
gets a generated avatar (no image files, no network). Mark one of them as you
and every screen shows your own position.

**Expenses.** Enter the amount *before tax*, then attach any number of taxes
and fees:

- a percentage (GST 18%) or a flat amount (₹300 service charge)
- each one is spread either **by share**, in proportion to what each person
  actually consumed, or **equally**, for flat per-head fees like a cover charge

**Discounts.** A bill that shows the full amount with the money off written
underneath is its own thing, not a negative tax, so it gets its own section.
Each discount is a percentage or a flat amount, and two choices make it match
the bill:

- **Before tax or after tax.** Before tax comes off first and the tax is then
  worked out on the lower amount, which is what happens when a dish is
  discounted. After tax comes off the final total, which is what a coupon
  does.
- **Who it applies to.** Everyone by default, or name the people it belongs
  to. A percentage is a percentage of what those people are actually on the
  hook for, not of the whole bill, so "20% off my dish" comes off that dish.
  Where it covers more than one person you can spread it by share or equally.

Discount one person's dish before tax and their tax drops with it while
everyone else's stays put. Discounts stack, and a discount larger than the
amount it comes off is refused rather than quietly turning into a negative
share.

**Round off.** Shops round the printed total, so ₹103.33 becomes ₹103 or ₹104.
Tick *Round off the bill* and choose **Nearest** (the GST rule: 50 paise and
over rounds up), **Round up**, or **Exact** to type the figure actually
printed. The difference is spread across the same split, so the shares still
add up to the printed total to the last paisa.

**Who paid.** One person or several. Split what they put in equally, by exact
amounts, or by percentage. The amounts have to add up to the total, and the app
shows how much is left over while you type.

**How it splits.** Equally, by exact amounts, by percentage, or by shares
(1x, 2x and so on). Deselect anyone who was not in on it. Splits apply to the pre-tax
amount; taxes, fees and the round-off ride along on top. The editor shows the
pre-tax share you typed with the extras noted beside it, and the saved expense
shows the all-in figure.

Nothing is assumed: no payer is preselected, and saving checks the title, the
amount, who paid, that the paid amounts add up to the total, and that the split
adds up to the pre-tax amount, listing everything outstanding at once. If a
bill with the same name, date and amount is already in the group, it asks
before adding a second one.

Every number is stored in integer minor units (paise, cents) and split with
largest-remainder allocation, so shares always add back up to the total to the
last unit.

A bill that does not divide evenly leaves one unit over, and somebody has to
take it. Handing it to the first name in the list every time adds up: ten odd
bills and the same person is ten paise down. So the app keeps a rounding
ledger per group, works through the expenses oldest first, and gives each
leftover to whoever is furthest behind. Over a run of bills the totals come
out dead even whenever the arithmetic allows it, and where it cannot (the
group total itself does not divide) nobody is more than a paisa off.

The expense editor starts from the same ledger position the saved expense will
have, so the shares it previews are the shares you get. The detailed statement
notes this under the balances table when a bill has split unevenly, and the
expense list below shows exactly where each odd unit went.

**Settle up.** Two views of the same balances:

- **Actual debts.** Everyone pays back whoever covered them. Debts inside a
  pair cancel out, and so does circular debt (A owes B owes C owes A), which is
  what keeps this view in step with the simplified one.
- **Simplify debts.** The same balances re-routed into the fewest possible
  payments, the way Splitwise does it. Fewer transfers, but you may end up
  paying someone you never shared a bill with.

Settling in either view updates the other, and once nothing is left the group
is marked as settled everywhere.

Tap **Why?** on any debt for a plain list: what the other person covered for
you, what you covered for them, anything already settled, and the difference.
No signed rows to decode.

**Insights.** Each group shows daily spend with the group total and, once
someone is marked as you, your share alongside it, plus the total, the daily
average and the busiest day. The window runs from the first expense to the
last, so it covers exactly the stretch the group was in use, and the daily
average means something. A span of three days or fewer is drawn as bars, since
a line through one point is not a line.
The home screen shows daily spend across every group from the first recorded
expense through today, with the per-day average covering that same elapsed
period. It also breaks down which group the money goes to, either for this
month or as a monthly average. Hover or tap a chart for exact figures, and
every total is printed on the page as well.

**Sharing.** From a whole group or from a single debt:

| Format | Contents |
| --- | --- |
| Text | WhatsApp-ready summary of who owes whom |
| Image | PNG card, same summary, receipt styling |
| PDF | Full statement: every expense, its taxes and discounts, who paid, what each person owes, balances and settlements |

Each one can go to the OS share sheet (`navigator.share`) or be saved to your
downloads. Where the share sheet is not available, text is copied to the
clipboard and files fall back to a download.

**Currency.** One currency per group, picked at creation and changeable later
(amounts are never converted). Currencies without decimals, like JPY, are
handled.

**Moving between browsers.** Export the whole profile or a single group as
JSON, then import it anywhere. Groups, people, expenses and settlements all
carry random ids, so importing a group you already have merges into it instead
of duplicating it. Before anything is written, the import screen shows what it
found:

- entries that are new, and entries already on the device
- **conflicts**, where the same entry differs on both sides, with both versions
  side by side and a choice of which to keep (it preselects the one edited most
  recently)
- **possible duplicates**, where the same day, name and amount arrived under a
  different id, with a choice of skipping it or keeping both

Nothing is overwritten until you press Import.

## Layout

```
index.html            app shell
manifest.webmanifest  PWA manifest
sw.js                 offline cache, precaches the whole app
css/app.css           design tokens and every component
assets/               logo, favicon, PWA icons, Geist
vendor/               Apache ECharts, vendored for offline use
js/
  app.js              boot and hash router
  core/
    db.js             IndexedDB wrapper with a localStorage fallback
    store.js          in-memory state, persistence, subscriptions
    money.js          minor units, parsing, formatting, allocation
    split.js          one expense to per-person paid/owed, taxes and round-off
    balances.js       net balances, actual and simplified debts, explanations
    analytics.js      daily series and per-group totals for the charts
    transfer.js       export, import planning, conflict and duplicate detection
    avatar.js         generated avatars, in SVG and on canvas
  export/
    doc.js            neutral document model shared by all exporters
    text.js           plain-text renderer
    paint.js          canvas primitives and the SuperSplit mark
    layout.js         block layout shared by image and PDF
    image.js          PNG renderer
    pdf.js            minimal PDF writer, JPEG pages, no library
    share.js          navigator.share, download, clipboard
  ui/                 screens, sheets, charts, components, icons
  util/dom.js         hyperscript and helpers
```

Sheets each own a history entry, so the phone back button closes them one at a
time and leaves no stale entries behind.

## Design

Dark, violet on near-black, in the spirit of slice.bank.in. Every colour is a
token at the top of `css/app.css`.

Type is [Geist](https://vercel.com/font) by Vercel (SIL OFL, bundled as a
single 69 KB variable font in `assets/fonts/`). Sizes are all in `rem` and the
root size grows smoothly from 15px on a phone to 17.5px on a desktop, so
nothing snaps at a breakpoint. Widths work the same way: a constant 16px
gutter, one container that grows with the window up to 1080px, and card
collections that add columns as the room appears.

Charts are Apache ECharts, vendored in `vendor/` (the "common" build: line,
bar and pie, 698 KB raw and about 235 KB over the wire). It is fetched the
first time a chart is needed rather than on boot, and precached so it keeps
working offline. Tooltips are a bonus rather than the only way to read a
chart: the legend and the figures under each chart always spell the numbers
out.

The mark is a receipt with a torn edge whose face is a calculator. It is drawn
in code (`js/export/paint.js`) as well as in SVG, so it renders at any size and
appears on every export.

## Discoverability

The page is a client-rendered app, so a crawler that does not run JavaScript
would otherwise see an empty shell. Three things fix that, and none of them
involve serving different content to crawlers than to people:

- the HTML ships a real splash (logo, `h1`, a sentence saying what the app is)
  which doubles as the loading screen, plus a `noscript` block spelling out
  every feature
- `application/ld+json` carries a `WebApplication`, an `Organization`, a
  `WebSite` and a nine-question `FAQPage`, which is what answer engines quote
- `llms.txt` is a plain-language summary of the whole app for model crawlers,
  following the llmstxt.org convention

`robots.txt` allows everything and names the AI crawlers explicitly (GPTBot,
ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended, CCBot and the
rest). There is nothing private to protect here: no accounts, no server, no
user data.

Open Graph and Twitter cards point at `assets/og-image.png`, a 1200x630 card
generated from `assets/og.svg`. Regenerate it by editing the SVG and rendering
it at 1200 square, then cropping the middle 630.

## Deploying

`vercel.json` carries the production headers. Any static host works, but if you
use something else, mirror these.

### Serving it under a path

`index.html` points at `/supersplit/css/app.css`, `/supersplit/js/app.js` and
so on, and the service worker registers `/supersplit/sw.js` with scope
`/supersplit/`. Absolute paths mean the app does not care whether it is
reached with a trailing slash, but they do fix it to one path.

The public URL is `https://lowkey.tools/supersplit/`, where the parent site
proxies to this project and strips the prefix on the way:

```json
{ "source": "/supersplit", "destination": "https://supersplit.lowkey.tools" },
{ "source": "/supersplit/:path*", "destination": "https://supersplit.lowkey.tools/:path*" }
```

Because the prefix is stripped, the origin never sees `/supersplit`, so anyone
reaching `supersplit.lowkey.tools` directly would follow the absolute paths
into a 404. This project's own `vercel.json` maps the prefix back onto the
root to cover that:

```json
"rewrites": [{ "source": "/supersplit/:path*", "destination": "/:path*" }]
```

`.claude/devserver.py` does the same thing, and redirects `/supersplit` to
`/supersplit/`, so local development runs on the same URLs as production.
Browse to <http://localhost:5173/supersplit/>.

**The parent site should still add the trailing-slash redirect**, even though
assets no longer depend on it:

```json
"redirects": [
  { "source": "/supersplit", "destination": "/supersplit/", "permanent": true }
]
```

A service worker only controls pages at or below its scope, and `/supersplit`
sits just outside `/supersplit/`. Without the redirect the app still loads at
the bare path, but it will not work offline there.

Two more things follow from being proxied onto a path:

- **`robots.txt`, `sitemap.xml` and `llms.txt` here only count for this
  project's own domain.** Crawlers read them from the root of whatever host
  they are on, so lowkey.tools needs its own root `robots.txt` listing
  `Sitemap: https://lowkey.tools/supersplit/sitemap.xml`, and its own root
  `llms.txt`.
- **The two hosts are different origins, so they hold different data.** A
  group created on `lowkey.tools/supersplit/` is not visible on
  `supersplit.lowkey.tools`. Publish and link one of them; the canonical tag
  already points at the path version.

**Caching.** The font and the vendored library never change, so they get a year
with `immutable`. HTML, `sw.js` and the manifest must always revalidate, or a
deploy would not reach anyone. JS and CSS have no content hashes in their
names, so they sit in between: the browser revalidates on every load (a cheap
304) while the CDN caches them for a year and Vercel purges the edge on deploy.

**Security.** A strict Content-Security-Policy (`default-src 'self'`, no
`unsafe-eval`, no external origins at all, framing denied), HSTS with preload,
`nosniff`, `no-referrer`, same-origin COOP and CORP, and a Permissions-Policy
that turns off camera, microphone, geolocation and the rest. The app talks to
nothing off-origin, so the policy can stay this tight.

`.claude/devserver.py` sends the same security headers, so a policy mistake
shows up locally rather than after a deploy.

## Notes

- Storage falls back to `localStorage` if IndexedDB is unavailable, as in some
  private windows. The Settings sheet shows which one is in use.
- The service worker precaches everything on install. The app's own HTML, JS
  and CSS are then served network-first, so a new version takes effect on the
  next load rather than the one after it, and it falls back to the cache the
  moment there is no network. The font, icons and the charting library are
  served cache-first, since those only change with a new filename.
