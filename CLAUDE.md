# norakevin — wedding website

Static wedding website for Nora & Kevin. Guests use it to get event details, RSVP, and find the registry. Many guests will be on phones and some are older relatives, so clarity beats cleverness.

## Fill in (TODO)

- Date: Saturday, September 18, 2027
- Venue(s): Philadelphia, PA, Old City area. Ceremony, cocktail hour and reception are all at The Down Town Club (https://weddings.cescaphe.com/pages/down-town-club), about 0.1 mi from 433 Chestnut St. Ceremony starts 4:30pm; guests asked to arrive 15–20 minutes early.
- Domain: norakevin.com (apex; www.norakevin.com should redirect to it)
- Events (ceremony, reception, rehearsal, welcome drinks, etc.): welcome drinks (location TBD), ceremony & reception (same venue), afterparty (location TBD, 0.2–0.3 mi from the hotels).
- RSVP deadline: August 18 (2027)
- Meal choices, if any: none. Guests choose their food at the wedding, so the RSVP doesn't ask (no dietary question either).
- Plus-one policy: no guests beyond those formally invited. Kids: adults-only apart from family members in the ceremony. Dress code: formal. All indoors.
- Design direction (Nora approves the look): classic black-on-white, modeled on a Zola-style template Kevin picked. Script "The wedding of" (Monsieur La Doulaise) over spaced serif caps (Cormorant Garamond), mixed-case letter-spaced nav as a small utility bar at the top left (desktop; sticky, full-width white background so it stays readable over the video) with no underlines (none for hover or the current page), one big photo/video. Desktop masthead spacing is tight, matched to a screenshot Kevin provided. Phones: top bar with menu button and "N&K" monogram, photo first.

## Stack and hosting

- Plain HTML, CSS, and vanilla JavaScript. No framework, no build step, no package dependencies unless there's a clear reason.
- Hosted on GitHub Pages from the `main` branch. Custom domain registered at Spaceship; keep the `CNAME` file in the repo root and HTTPS enforced.
- This repo is **public** (required for GitHub Pages on a free account). Treat everything committed as visible to anyone.

## Site structure

- Shared styles in `style.css`, shared JS (phone menu, home page video) in `site.js`. Each page is a folder with `index.html` (`/schedule/`, `/travel/`, ...).
- The top bar, masthead, nav and footer are copied into every page (no build step). When the nav changes, update every page and move `aria-current="page"` to the right link.
- Footer: Kevin's line-drawn heart (`images/heart.svg`) in the bottom-right of every page, as a CSS background on `.site-footer` (not an `<img>`, so it can't be dragged or selected). 7rem tall, 2.75rem in from the right and bottom. It must never be visible without scrolling but should hide *just* below the fold: `.page` is at least 100vh tall and the footer is only heart + inset + a 1rem gap tall.
- Placeholder text still to be decided is wrapped in `<span class="tbd">[…]</span>` (yellow highlight) so it's easy to spot; `grep -r 'class="tbd"'` lists what's left. The FAQ (`faq/index.html`, `.qa` styles) text comes from Kevin's "Wedding website FAQ" Claude Doc (https://claude.ai/artifact/MatVMoFjEJpoa4PE8p9ngB): he edits there, then the page is updated to match (page names become links; phone numbers are `sms:` links). Kevin wants it as an accordion: only questions show, each opens its answer on click/tap (`<details>`/`<summary>`, works without JS, thin +/− on the right, each opens independently).
- Fonts are self-hosted in `fonts/` (OFL licenses alongside), so pages make no requests to Google Fonts.
- Home page hero is a silent looping video (`video/hero.mp4`, `video/hero.webm` fallback, `video/hero-poster.jpg`). Kevin wants it non-interactive: no controls, no hover icons, no play/pause; keep `pointer-events: none` and no `controls` attribute. It is Nora & Kevin's own Super 8 engagement footage (shot 2026-10-02): scanned, graded and cut to about 21s, cropped to hide the neighbouring film frames (1280×898), ending on "9/18/27" in Cormorant Garamond over the film's end leader. The grading and edit happen outside this repo with ffmpeg; commit only the web encodes, never the scans or ProRes masters. Kevin wants the film frame's dark border and rounded corners always visible, at any width on any device: the video box uses the footage's own ratio (`aspect-ratio: 1280 / 898`, `object-fit: contain`) on desktop and phones, so nothing is cropped; update the ratio if the video is re-cut at another size. It is also never taller than the screen below the pinned header (nav bar on desktop, top bar on phones): `site.js` measures that header into `--header-h` and the video's width shrinks to keep the shape, so the whole frame fits on short laptop screens. `site.js` starts it muted; if a browser blocks autoplay, the first tap, click or key press starts it, and an `ended` handler restarts it if `loop` fails. Visitors whose device asks for reduced motion get the poster.
- Home page is just nav, masthead (script, names, date and place) and the video. Kevin removed the "N days to go" countdown and, for now, the date/place/RSVP block that sat below the video (it's in git history if wanted back).
- Masthead sizes Kevin chose on desktop: "The wedding of" 30px, names 60px (scales down on phones), date/place line 18px. Set in rem in `style.css`.

## Hard rules

1. **Guests never create an account or sign in** for anything: viewing, RSVP, address collection, or gifts.
2. **No guest data in this repo, ever.** No names, addresses, emails, phone numbers, household codes, or guest lists, not even temporarily. Git history is permanent.
3. **No home address** on the site, and nothing that signals when the house will be empty.
4. **Keep the site out of search engines.** Every page gets `<meta name="robots" content="noindex, nofollow">`, and `robots.txt` disallows all.
5. **No trackers, analytics, ad pixels, or marketing scripts.** The only third-party pieces are the Google Apps Script RSVP backend (or Tally form embed), and the outbound Zola registry link.
6. **Mobile-first and accessible.** Readable font sizes, strong contrast, large tap targets, alt text on images. Core info (date, place, times) must be readable even if JavaScript fails.

## RSVPs and address collection

- **RSVP is custom and on trial.** Kevin wants to test it; if he isn't confident in it, strip it out and fall back to Tally (or similar).
  - Page: `rsvp/index.html` + `rsvp/rsvp.js`. Backend: `apps-script/Code.gs`, a Google Apps Script web app bound to the guest Google Sheet (shared with Nora, the source of truth). Setup steps in `apps-script/README.md`.
  - Guests type their full name; the script returns their whole household, and one page answers for everyone: accept/decline per person, plus one optional message to the couple. The message is stored on the row of the person whose name was searched. Revisiting shows current answers (and the searcher's own message) so they can edit. No meals, dietary notes or song requests.
  - Partial and fully blank RSVPs are allowed: a blank answer is an inferred "don't know yet" (e.g. the plus-one). Accepts / Declines are toggle buttons (`aria-pressed`), not radios, so a guest can tap the chosen one again to clear it. A blank is written like any answer: Attending set to empty (clearing an earlier Yes/No), Last updated stamped, Responses log row added. Empty Attending = hasn't answered / don't know yet. The thank-you says "Come back anytime to answer for the rest of your household" (no names listed).
  - Kevin wants minimal text on the RSVP page: no instructions above the name box or the household, no always-visible "text or call us" line. That fallback appears only inside error messages (name not found, can't connect, save failed).
  - Layout: one compact row per guest (name left, Accepts / Declines buttons right, hairlines between rows) so a household of 4 fits on one screen. Long names wrap with the buttons kept on the right.
  - `Code.gs` finds Guests columns by header name (Household, First name, Last name, Attending, Message, Last updated), so Nora can reorder or add columns; `setUp()` adds missing ones. An optional **Suffix** column (Jr, Sr...) is shown after the last name; search ignores suffixes, but when one is typed, the message goes to that exact person.
  - Name matching: exact full name first. If none, the last name must match and the first name may be a short form (3+ letters, either is the start of the other: Kim/Kimberly) or a listed nickname (`NICKNAMES` in `Code.gs`: Bob/Robert, Peggy/Margaret). Middle names typed are ignored. A loose match that spans two households is refused. No per-guest nickname lists.
  - `ENDPOINT` in `rsvp/rsvp.js` is the deployed web app URL (connected 2026-10-21). Empty, or `?demo` in the page URL = demo mode with made-up guests, nothing saved.
  - Tests: `node apps-script/test.js`. After changing `Code.gs`, Kevin must paste it into the Apps Script editor and deploy a new version of the existing deployment.
- Do not enable any setting that requires respondents to sign in.
- Address collection (before save-the-dates) can be a Tally form feeding the same Sheet.
- When the RSVP form fails (name not found, network or save error), the error tells guests they can text or call to RSVP instead.

## Registry and gifts

- The Registry page links out to a **Zola** registry. Guests check out with a card on Zola; no payment handling is built into this site.
- Zola's optional Venmo route is fine to mention, but card checkout is the primary path because Venmo requires a guest account.

## Workflow

- Until the site is announced, Kevin has approved pushing directly to `main` (no PR needed). Merging to `main` and checking the live Pages URL is the preview step.
- After launch, keep `main` always working. Test changes on a branch first.
- Small commits with descriptive messages.
- Record new decisions in this file so future sessions pick them up.

## Planned pages (starting point, adjust as needed)

- Home: names, date, location, short welcome
- Schedule: each event with time, place, dress code
- Travel (`travel/index.html`): "From PHL Airport" and "From Amtrak 30th Street Station" (taxi, Uber/Lyft, SEPTA train to Jefferson Station, 0.6 mi from the hotels), then one section per parking option, formatted the same way. First is "Venue Parking": the Down Town Club garage at 615 Chestnut St (Saturday $11 all day, open 9 am–2 am, from the garage sign; recheck rates closer to the date). Uses the same `.facts` label/value list as Hotels. Like Hotels, the page uses `.content.wide`: sections flow two per row at 860px+ and stack on phones. Each section has a 3:2 photo on top, above its heading, styled like the hotel photos (`.travel-photo` shares the `.hotel-photo` rule), saved in `images/travel/`; all three photos (PHL control tower, 30th Street Station hall, the parking garage entrance) were supplied by Kevin. The garage photo came from a SpotHero listing with a watermark in the corner, cropped out (`venue-parking-entrance.jpg` is cropped from the top of the original, above the watermark). The PHL photo is only 680px wide, so swap in a larger one if he finds it.
- Hotels (`hotels/index.html`, its own page in the nav after Travel): one section per hotel with address, room rates, check-in time, parking (the hotel's valet price, Monaco $61 and Renaissance $65, plus the nearest off-site garage, The Bourse Garage at 44 S 4th St, $32 all day; recheck prices closer to the date), distances to each event, a "Book a room" button (hotel block link) and the hotel's website. Currently Kimpton Hotel Monaco and Renaissance Philadelphia Downtown. Hotels sit side by side at 860px+ (the page uses `.content.wide`, 64rem) and stack on phones. Each has a 3:2 photo on top, saved in `images/hotels/` (never hot-linked from hotel sites, so visitors' browsers don't contact them); the Kimpton exterior comes from monaco-philadelphia.com, the Renaissance exterior was supplied by Kevin. Distances are listed in event order: welcome drinks, ceremony & reception, afterparty. Keep number+unit and "label · value" together with `&nbsp;` so lines don't break awkwardly on small phones.
- RSVP: custom form (see above) plus fallback contact line
- Registry: link to Zola
- FAQ

## Pre-launch checklist

- [ ] Full test RSVP from a phone; confirm it lands in the Sheet
- [ ] Test the Zola gift flow in a private browser window; confirm no account prompt
- [ ] noindex tag on every page and robots.txt in place
- [ ] Custom domain resolves with HTTPS
- [ ] Repo contains no guest data (check history too)
- [ ] Spot-check on a small phone and a large desktop screen
- [ ] No `class="tbd"` placeholders left on any page
- [ ] Click every hotel "Book a room" and website link (Marriott and IHG block automated checks, so test in a browser)
