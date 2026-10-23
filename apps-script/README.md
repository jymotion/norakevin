# RSVP backend setup

The RSVP page (`/rsvp/`) saves answers into a Google Sheet through a small
Google Apps Script. Until the script is deployed, the page runs in demo mode
with made-up guests and saves nothing.

Guest names live only in the Google Sheet, never in this repo.

## One-time setup (about 10 minutes)

1. **Create the Sheet.** In Google Drive, create a new Google Sheet, e.g.
   "Wedding guests". Share it with Nora.
2. **Add the script.** In the Sheet, open **Extensions → Apps Script**. Delete
   whatever is in `Code.gs` and paste in the contents of `apps-script/Code.gs`
   from this repo. Click **Save**.
3. **Create the tabs.** In the toolbar's function dropdown pick `setUp`, then
   click **Run**. Google asks for permission: choose your account, then
   **Advanced → Go to (project name)**, then **Allow**. (The "unverified app"
   warning is normal for your own scripts.) The Sheet now has a `Guests` tab.
4. **Deploy.** Click **Deploy → New deployment**. Click the gear and pick
   **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click
   **Deploy** and copy the **Web app URL** (ends in `/exec`).
5. **Connect the site.** Give that URL to Claude (or paste it into `ENDPOINT`
   at the top of `rsvp/rsvp.js`) and push. The demo banner disappears and
   the page uses the real Sheet. Add `?demo` to the page URL
   (`norakevin.com/rsvp/?demo`) to try it with made-up guests anytime.

## The Guests tab

| Household | First name | Last name | Attending | Message | Last updated |
|-----------|------------|-----------|-----------|---------|--------------|

- Fill in **Household**, **First name**, **Last name**. Everyone with the same
  Household value is one invitation; any label works (`Smith family`, `H12`).
- The other columns are filled in by the site. You can also edit them by hand,
  e.g. when someone RSVPs by text. Use `Yes` or `No` in **Attending**.
- An empty **Attending** cell means that person hasn't answered yet. Guests
  can answer for some of their household now (say, not the plus-one) and come
  back later for the rest. Leaving someone blank counts as "don't know yet":
  their **Last updated** is stamped and the **Responses log** gets a row with
  Attending empty. Guests can also tap a chosen answer again to clear it,
  which empties an earlier Yes/No.
- **Message** is the optional note to Nora & Kevin. It goes on the row of the
  person whose name was searched, so if Alex RSVPs for the household, Alex's
  row gets the message. Each person who searches keeps their own message.
- The script finds columns by their header text, so the order doesn't matter
  and you can add your own columns (addresses, notes) anywhere. Don't rename
  the six headers above. Running `setUp` again adds any that are missing.
- Guests find their invitation by typing their first and last name.
  Capitals, accents, punctuation and middle names don't matter. The last name
  must match what's in the Sheet; the first name can be a common form of it:
  - Short forms that are the start of the full name match automatically, in
    either direction (Kim ↔ Kimberly, Chris ↔ Christopher, Jen ↔ Jennifer).
  - Other nicknames (Bob ↔ Robert, Peggy ↔ Margaret, Bill ↔ William) come
    from the `NICKNAMES` list near the bottom of `Code.gs`. Add a line there
    for anything unusual a guest goes by.
  - An exact name always wins. If a nickname could mean people in two
    different households, the guest is asked to type the name on their
    invitation instead.
- **Suffixes (Jr, Sr, II, III, IV):** add an optional column headed
  **Suffix** and put them there, keeping First name "Chris" and Last name
  "Smith". The site shows "Chris Smith Jr". Guests can type "Chris Smith"
  or "Chris Smith Jr"; typing the suffix makes their message land on their
  own row. Suffixes typed into the First or Last name column also work.
- Two guests with the identical name in different households can't use the
  form; they're told to text or call.
- For a plus-one whose name you don't know yet, add a row like
  `Guest` / `of Alex Sample` in the same household.
- Every submission is also appended to a **Responses log** tab, so changes are
  never lost.

## Settings

At the top of `Code.gs`:

- `RSVP_DEADLINE`: e.g. `'2027-05-01'`. After that day the form shows answers
  but won't accept changes.

## Changing the script later

Paste the new `Code.gs` into the editor and save, then **Deploy → Manage
deployments → (pencil icon) → Version: New version → Deploy**. This keeps the
same URL. Choosing "New deployment" instead makes a new URL the site doesn't know.

## Tests

`node apps-script/test.js` runs the script against a fake in-memory sheet.
