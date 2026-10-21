/**
 * RSVP backend for norakevin.com.
 *
 * Lives in the Google Sheet (Extensions > Apps Script), deployed as a web app.
 * The site posts JSON here; this script looks guests up in the "Guests" tab
 * and writes their answers back. See apps-script/README.md for setup.
 *
 * This file is in a public repo: no guest data or secrets belong in it.
 */

// ---- Settings ---------------------------------------------------------------

var GUESTS_SHEET = 'Guests';
var LOG_SHEET = 'Responses log';

// Meal choices offered to attending guests. Empty list = no meal question.
var MEALS = ['Chicken', 'Fish', 'Vegetarian'];

// Last day RSVPs can be changed, as 'YYYY-MM-DD' (end of that day, script's
// time zone). null = no deadline.
var RSVP_DEADLINE = null;

var HEADERS = ['Household', 'First name', 'Last name', 'Attending', 'Meal', 'Dietary notes', 'Last updated'];
var COL = { household: 0, first: 1, last: 2, attending: 3, meal: 4, dietary: 5, updated: 6 };
var MAX_NOTE_LENGTH = 300;

// ---- Web app entry points ---------------------------------------------------

function doPost(e) {
  var result;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    result = handle(req);
  } catch (err) {
    console.error(err);
    result = { ok: false, error: 'Something went wrong on our end. Please try again, or text or call us instead.' };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'norakevin rsvp' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handle(req) {
  // Hidden field real people never fill in.
  if (req.website) return { ok: false, error: 'Unable to process this request.' };
  if (req.action === 'lookup') return lookup(req.name);
  if (req.action === 'save') return save(req.name, req.responses);
  return { ok: false, error: 'Unknown request.' };
}

// ---- Actions ----------------------------------------------------------------

function lookup(name) {
  var found = findHousehold(name);
  if (found.error) return { ok: false, error: found.error };
  return {
    ok: true,
    meals: MEALS,
    deadlinePassed: deadlinePassed(),
    members: found.rows.map(function (r) {
      return {
        first: r.values[COL.first],
        last: r.values[COL.last],
        attending: normalizeAttending(r.values[COL.attending]),
        meal: String(r.values[COL.meal] || ''),
        dietary: String(r.values[COL.dietary] || '')
      };
    })
  };
}

function save(name, responses) {
  if (deadlinePassed()) {
    return { ok: false, error: 'The RSVP deadline has passed. Please text or call us to make changes.' };
  }
  if (!Array.isArray(responses)) return { ok: false, error: 'Missing responses.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findHousehold(name);
    if (found.error) return { ok: false, error: found.error };

    // Validate every member before writing anything.
    var updates = [];
    for (var i = 0; i < found.rows.length; i++) {
      var row = found.rows[i];
      var key = personKey(row.values[COL.first], row.values[COL.last]);
      var resp = responses.filter(function (r) { return personKey(r.first, r.last) === key; })[0];
      var label = row.values[COL.first] + ' ' + row.values[COL.last];
      if (!resp) return { ok: false, error: 'Please answer for ' + label + '.' };
      if (resp.attending !== 'yes' && resp.attending !== 'no') {
        return { ok: false, error: 'Please say whether ' + label + ' will attend.' };
      }
      var meal = '';
      if (resp.attending === 'yes' && MEALS.length) {
        if (MEALS.indexOf(resp.meal) === -1) return { ok: false, error: 'Please choose a meal for ' + label + '.' };
        meal = resp.meal;
      }
      var dietary = resp.attending === 'yes' ? cleanText(resp.dietary) : '';
      updates.push({ row: row, attending: resp.attending === 'yes' ? 'Yes' : 'No', meal: meal, dietary: dietary });
    }

    var sheet = guestsSheet();
    var log = logSheet();
    var now = new Date();
    updates.forEach(function (u) {
      sheet.getRange(u.row.sheetRow, COL.attending + 1, 1, 4)
        .setValues([[u.attending, u.meal, u.dietary, now]]);
      log.appendRow([now, u.row.values[COL.household], u.row.values[COL.first], u.row.values[COL.last],
        u.attending, u.meal, u.dietary]);
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---- Helpers ----------------------------------------------------------------

// Finds the household of the guest whose full name matches, and returns all
// of that household's rows. Requires an exact full-name match so guessing a
// last name alone reveals nothing.
function findHousehold(name) {
  var wanted = lookupKey(name);
  if (wanted.split(' ').length < 2) return { error: 'Please enter your first and last name.' };

  var rows = guestRows();
  var matches = rows.filter(function (r) {
    return lookupKey(r.values[COL.first] + ' ' + r.values[COL.last]) === wanted;
  });
  if (matches.length === 0) {
    return { error: "We couldn't find that name. Try the name on your invitation, or text or call us." };
  }
  var households = uniq(matches.map(function (r) { return String(r.values[COL.household]); }));
  if (households.length > 1) {
    return { error: 'More than one guest has that name. Please text or call us to RSVP.' };
  }
  return {
    rows: rows.filter(function (r) { return String(r.values[COL.household]) === households[0]; })
  };
}

function guestRows() {
  var sheet = guestsSheet();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var rows = [];
  values.forEach(function (v, i) {
    if (String(v[COL.household]).trim() && String(v[COL.first]).trim()) {
      rows.push({ sheetRow: i + 2, values: v });
    }
  });
  return rows;
}

function guestsSheet() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(GUESTS_SHEET);
  if (!sheet) throw new Error('Missing "' + GUESTS_SHEET + '" tab. Run setUp() first.');
  return sheet;
}

function logSheet() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET);
    sheet.appendRow(['Time', 'Household', 'First name', 'Last name', 'Attending', 'Meal', 'Dietary notes']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Lowercase, strip accents and punctuation, collapse spaces.
function normalize(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Identifies one guest row; keeps suffixes so "Chris Sr" and "Chris Jr" differ.
function personKey(first, last) {
  return normalize(first + ' ' + last);
}

// What a guest must type to find their invitation; suffixes are optional.
var SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv'];
function lookupKey(fullName) {
  return normalize(fullName).split(' ').filter(function (w) {
    return w && SUFFIXES.indexOf(w) === -1;
  }).join(' ');
}

function normalizeAttending(v) {
  var s = String(v || '').trim().toLowerCase();
  return s === 'yes' ? 'yes' : s === 'no' ? 'no' : '';
}

// Trim, cap length, and stop Sheets from treating text as a formula.
function cleanText(s) {
  var t = String(s || '').trim().slice(0, MAX_NOTE_LENGTH);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

function deadlinePassed() {
  if (!RSVP_DEADLINE) return false;
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  return today > RSVP_DEADLINE;
}

function uniq(list) {
  return list.filter(function (v, i) { return list.indexOf(v) === i; });
}

// ---- One-time setup ---------------------------------------------------------

// Run once from the Apps Script editor to create the tabs with the right headers.
function setUp() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(GUESTS_SHEET) || ss.insertSheet(GUESTS_SHEET);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  logSheet();
}
