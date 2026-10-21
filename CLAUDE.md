# norakevin — wedding website

Static wedding website for Nora & Kevin. Guests use it to get event details, RSVP, and find the registry. Many guests will be on phones and some are older relatives, so clarity beats cleverness.

## Fill in (TODO)

- Date:
- Venue(s):
- Domain: norakevin.com (apex; www.norakevin.com should redirect to it)
- Events (ceremony, reception, rehearsal, welcome drinks, etc.):
- RSVP deadline:
- Meal choices, if any:
- Plus-one policy:
- Design direction (Nora approves the look):

## Stack and hosting

- Plain HTML, CSS, and vanilla JavaScript. No framework, no build step, no package dependencies unless there's a clear reason.
- Hosted on GitHub Pages from the `main` branch. Custom domain registered at Spaceship; keep the `CNAME` file in the repo root and HTTPS enforced.
- This repo is **public** (required for GitHub Pages on a free account). Treat everything committed as visible to anyone.

## Hard rules

1. **Guests never create an account or sign in** for anything: viewing, RSVP, address collection, or gifts.
2. **No guest data in this repo, ever.** No names, addresses, emails, phone numbers, household codes, or guest lists, not even temporarily. Git history is permanent.
3. **No home address** on the site, and nothing that signals when the house will be empty.
4. **Keep the site out of search engines.** Every page gets `<meta name="robots" content="noindex, nofollow">`, and `robots.txt` disallows all.
5. **No trackers, analytics, ad pixels, or marketing scripts.** The only third-party pieces are the Tally form embed and the outbound Zola registry link.
6. **Mobile-first and accessible.** Readable font sizes, strong contrast, large tap targets, alt text on images. Core info (date, place, times) must be readable even if JavaScript fails.

## RSVPs and address collection

- RSVPs use a **Tally** form (free plan) embedded on the RSVP page. Responses go to a Google Sheet shared with Nora, which is the source of truth for the guest list.
- Do not enable any form setting that requires respondents to sign in.
- If per-household RSVP links are used, they prefill names through Tally hidden fields in the URL. Those links are sent to guests directly; they are never stored in this repo.
- Address collection (before save-the-dates) is a second Tally form feeding the same Sheet.
- The RSVP page includes a fallback line telling guests they can text or call to RSVP instead.

## Registry and gifts

- The Registry page links out to a **Zola** registry. Guests check out with a card on Zola; no payment handling is built into this site.
- Zola's optional Venmo route is fine to mention, but card checkout is the primary path because Venmo requires a guest account.

## Workflow

- Work on a branch, push often, and merge to `main` when a change works. Until the site is announced, merging to `main` and checking the live Pages URL is the preview step.
- After launch, keep `main` always working. Test changes on a branch first.
- Small commits with descriptive messages.
- Record new decisions in this file so future sessions pick them up.

## Planned pages (starting point, adjust as needed)

- Home: names, date, location, short welcome
- Schedule: each event with time, place, dress code
- Travel & Stay: directions, parking, nearby lodging
- RSVP: Tally embed plus fallback contact line
- Registry: link to Zola
- FAQ

## Pre-launch checklist

- [ ] Full test RSVP from a phone; confirm it lands in the Sheet
- [ ] Test the Zola gift flow in a private browser window; confirm no account prompt
- [ ] noindex tag on every page and robots.txt in place
- [ ] Custom domain resolves with HTTPS
- [ ] Repo contains no guest data (check history too)
- [ ] Spot-check on a small phone and a large desktop screen
