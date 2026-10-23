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

// Last day RSVPs can be changed, as 'YYYY-MM-DD' (end of that day, script's
// time zone). null = no deadline.
var RSVP_DEADLINE = null;

// Columns the script needs in the Guests tab, found by header name, so they
// can be in any order and other columns can be added freely.
var FIELDS = {
  household: 'Household',
  first: 'First name',
  last: 'Last name',
  attending: 'Attending',
  message: 'Message',
  updated: 'Last updated'
};
// Used when present: Jr, Sr, III... shown after the last name.
var OPTIONAL_FIELDS = { suffix: 'Suffix' };
var MAX_MESSAGE_LENGTH = 1000;

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
  if (req.action === 'save') return save(req.name, req.responses, req.message);
  return { ok: false, error: 'Unknown request.' };
}

// ---- Actions ----------------------------------------------------------------

function lookup(name) {
  var found = findHousehold(name);
  if (found.error) return { ok: false, error: found.error };
  var col = found.col;
  return {
    ok: true,
    deadlinePassed: deadlinePassed(),
    // The message lives on the row of the person who searched.
    message: String(found.self.values[col.message] || ''),
    members: found.rows.map(function (r) {
      return {
        first: r.values[col.first],
        last: r.values[col.last],
        suffix: col.suffix === -1 ? '' : String(r.values[col.suffix] || ''),
        attending: normalizeAttending(r.values[col.attending])
      };
    })
  };
}

function save(name, responses, message) {
  if (deadlinePassed()) {
    return { ok: false, error: 'The RSVP deadline has passed. Please text or call us to make changes.' };
  }
  if (!Array.isArray(responses)) return { ok: false, error: 'Missing responses.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findHousehold(name);
    if (found.error) return { ok: false, error: found.error };
    var col = found.col;

    // Validate every member before writing anything.
    var updates = [];
    for (var i = 0; i < found.rows.length; i++) {
      var row = found.rows[i];
      var label = fullName(row, col);
      var resp = responses.filter(function (r) {
        return normalize([r.first, r.last, r.suffix].join(' ')) === normalize(label);
      })[0];
      if (!resp || (resp.attending !== 'yes' && resp.attending !== 'no')) {
        return { ok: false, error: 'Please say whether ' + label + ' will attend.' };
      }
      updates.push({ row: row, attending: resp.attending === 'yes' ? 'Yes' : 'No' });
    }
    var note = cleanText(message);

    var sheet = found.sheet;
    var log = logSheet();
    var now = new Date();
    updates.forEach(function (u) {
      var isSelf = u.row === found.self;
      sheet.getRange(u.row.sheetRow, col.attending + 1).setValue(u.attending);
      if (isSelf) sheet.getRange(u.row.sheetRow, col.message + 1).setValue(note);
      sheet.getRange(u.row.sheetRow, col.updated + 1).setValue(now);
      var suffix = col.suffix === -1 ? '' : String(u.row.values[col.suffix] || '').trim();
      log.appendRow([now, u.row.values[col.household], u.row.values[col.first],
        u.row.values[col.last] + (suffix ? ' ' + suffix : ''), u.attending, isSelf ? note : '']);
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---- Helpers ----------------------------------------------------------------

// Finds the household of the guest whose full name matches, and returns all
// of that household's rows plus the searched person's own row ("self").
// Requires an exact full-name match so guessing a last name alone reveals
// nothing.
function findHousehold(name) {
  var wanted = lookupKey(name);
  if (wanted.split(' ').length < 2) return { error: 'Please enter your first and last name.' };

  var guests = readGuests();
  var col = guests.col;
  var matches = guests.rows.filter(function (r) {
    return lookupKey(fullName(r, col)) === wanted;
  });
  if (matches.length === 0) {
    return { error: "We couldn't find that name. Try the name on your invitation, or text or call us." };
  }
  var households = uniq(matches.map(function (r) { return String(r.values[col.household]); }));
  if (households.length > 1) {
    return { error: 'More than one guest has that name. Please text or call us to RSVP.' };
  }
  // "Chris Smith Jr" matches both Chris Jr and Chris Sr; prefer the one whose
  // name (suffix included, in any order) is exactly what was typed.
  var typed = sortedWords(name);
  var exact = matches.filter(function (r) { return sortedWords(fullName(r, col)) === typed; })[0];
  return {
    sheet: guests.sheet,
    col: col,
    self: exact || matches[0],
    rows: guests.rows.filter(function (r) { return String(r.values[col.household]) === households[0]; })
  };
}

// Reads the Guests tab. col maps each FIELDS key to its 0-based column.
function readGuests() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(GUESTS_SHEET);
  if (!sheet) throw new Error('Missing "' + GUESTS_SHEET + '" tab. Run setUp() first.');
  var width = sheet.getLastColumn();
  var header = width ? sheet.getRange(1, 1, 1, width).getValues()[0].map(headerKey) : [];
  var col = {};
  Object.keys(FIELDS).forEach(function (k) {
    col[k] = header.indexOf(headerKey(FIELDS[k]));
    if (col[k] === -1) throw new Error('Guests tab has no "' + FIELDS[k] + '" column. Run setUp() to add it.');
  });
  Object.keys(OPTIONAL_FIELDS).forEach(function (k) {
    col[k] = header.indexOf(headerKey(OPTIONAL_FIELDS[k]));
  });

  var rows = [];
  var last = sheet.getLastRow();
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, width).getValues().forEach(function (v, i) {
      if (String(v[col.household]).trim() && String(v[col.first]).trim()) {
        rows.push({ sheetRow: i + 2, values: v });
      }
    });
  }
  return { sheet: sheet, col: col, rows: rows };
}

function logSheet() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET);
    sheet.appendRow(['Time', 'Household', 'First name', 'Last name', 'Attending', 'Message']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function headerKey(h) {
  return String(h || '').trim().toLowerCase();
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

// "First Last Suffix" as shown on the site. Suffixes typed into the First or
// Last name column instead of a Suffix column also work.
function fullName(r, col) {
  var parts = [r.values[col.first], r.values[col.last]];
  if (col.suffix !== -1) parts.push(r.values[col.suffix]);
  return parts.map(function (p) { return String(p || '').trim(); }).filter(Boolean).join(' ');
}

function sortedWords(s) {
  return normalize(s).split(' ').sort().join(' ');
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
  var t = String(s || '').trim().slice(0, MAX_MESSAGE_LENGTH);
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

// ---- Setup ------------------------------------------------------------------

// Run from the Apps Script editor. Creates the Guests tab if needed and adds
// any missing columns at the end of the header row. Safe to run again.
function setUp() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(GUESTS_SHEET) || ss.insertSheet(GUESTS_SHEET);
  var width = sheet.getLastColumn();
  var have = width ? sheet.getRange(1, 1, 1, width).getValues()[0].map(headerKey) : [];
  Object.keys(FIELDS).forEach(function (k) {
    if (have.indexOf(headerKey(FIELDS[k])) === -1) {
      width++;
      sheet.getRange(1, width).setValue(FIELDS[k]);
    }
  });
  sheet.getRange(1, 1, 1, width).setFontWeight('bold');
  sheet.setFrozenRows(1);
  logSheet();
}
