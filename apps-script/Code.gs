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

// Finds the household of the guest whose name matches, and returns all of
// that household's rows plus the searched person's own row ("self").
// An exact full-name match wins. Failing that, the last name must match and
// the first name may be a nickname (see sameFirstName). A last name alone
// never matches.
function findHousehold(name) {
  var wanted = lookupKey(name);
  if (wanted.split(' ').length < 2) return { error: 'Please enter your first and last name.' };

  var guests = readGuests();
  var col = guests.col;
  var matches = guests.rows.filter(function (r) {
    return lookupKey(fullName(r, col)) === wanted;
  });
  var loose = matches.length === 0;
  if (loose) {
    matches = guests.rows.filter(function (r) { return nicknameMatch(wanted, r, col); });
  }
  if (matches.length === 0) {
    return { error: "We couldn't find that name. Try the name on your invitation, or text or call us." };
  }
  var households = uniq(matches.map(function (r) { return String(r.values[col.household]); }));
  if (households.length > 1) {
    return {
      error: loose
        ? 'We found more than one possible match. Please enter your name as it appears on your invitation, or text or call us.'
        : 'More than one guest has that name. Please text or call us to RSVP.'
    };
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

// Typed name (already a lookupKey) vs one guest row: the typed name must end
// with the guest's last name, and the first word typed must be a form of the
// guest's first name. Words in between (middle names) are ignored.
function nicknameMatch(wanted, r, col) {
  var last = lookupKey(r.values[col.last]);
  var first = lookupKey(r.values[col.first]).split(' ')[0];
  if (!last || !first) return false;
  var tail = ' ' + last;
  if (wanted.length <= tail.length || wanted.slice(-tail.length) !== tail) return false;
  return sameFirstName(wanted.slice(0, -tail.length).split(' ')[0], first);
}

// Kim/Kimberly, Chris/Christopher: one is the start of the other (3+ letters).
// Bob/Robert, Peggy/Margaret: listed together in NICKNAMES.
function sameFirstName(a, b) {
  if (a === b) return true;
  var shorter = a.length < b.length ? a : b;
  var longer = shorter === a ? b : a;
  if (shorter.length >= 3 && longer.indexOf(shorter) === 0) return true;
  return NICKNAME_GROUPS.some(function (g) { return g.indexOf(a) !== -1 && g.indexOf(b) !== -1; });
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

// ---- Nicknames --------------------------------------------------------------

// Common nicknames, one group per line: any two names on the same line count
// as the same first name. Nicknames that are just the start of the full name
// (Kim/Kimberly, Jen/Jennifer) already match without being listed here.
// Generic names only; add a line if a guest goes by something not covered.
var NICKNAMES = [
  'albert al bert bertie',
  'alexander alex al xander sasha',
  'alexandra alex alexa lexi sandra sandy',
  'alfred al alfie fred',
  'andrew andy drew',
  'anne ann annie nan nancy',
  'anthony tony',
  'barbara barb babs',
  'benjamin ben benny benji',
  'catherine cathy cat kate katie',
  'charles charlie chuck chas',
  'christina chris tina chrissy',
  'christine chris tina chrissy',
  'christopher chris kit topher',
  'cynthia cindy',
  'daniel dan danny',
  'david dave davey',
  'deborah deb debbie',
  'dominic dom',
  'dorothy dot dottie',
  'edward ed eddie ted teddy ned',
  'eleanor ellie nell nora',
  'elizabeth liz lizzie lizzy beth betsy betty libby eliza',
  'eugene gene',
  'frances fran frannie',
  'francis frank frankie',
  'frederick fred freddie',
  'gerald jerry gerry',
  'gregory greg',
  'harold harry hal',
  'helen nell nellie',
  'henry hank harry',
  'isabel isabella izzy bella',
  'jacob jake',
  'jacqueline jackie',
  'james jim jimmy jamie',
  'jeffrey jeff',
  'jerome jerry',
  'john jack johnny jon',
  'jonathan jon jonny',
  'joseph joe joey',
  'josephine jo josie',
  'joshua josh',
  'judith judy',
  'katherine kathy kate katie kat kit',
  'kathleen kathy kate katie',
  'kenneth ken kenny',
  'lawrence larry',
  'leonard leo len lenny',
  'margaret maggie meg peggy peg marge margie greta',
  'mary molly polly mae',
  'matthew matt matty',
  'michael mike mikey mick mickey',
  'nathaniel nate nathan nat',
  'nicholas nick nicky',
  'patricia pat patty trish tricia',
  'patrick pat paddy',
  'peter pete',
  'rebecca becky becca',
  'richard rich rick ricky dick',
  'robert rob robbie bob bobby bert',
  'ronald ron ronnie',
  'samantha sam sammy',
  'samuel sam sammy',
  'sarah sally sadie',
  'stephen steve stevie',
  'steven steve stevie',
  'susan sue susie suzy',
  'theodore ted teddy theo',
  'theresa terry tess tessa',
  'thomas tom tommy',
  'timothy tim timmy',
  'victoria vicky tori',
  'vincent vince vinny',
  'virginia ginny',
  'william will willie willy bill billy liam',
  'zachary zach zack'
];
var NICKNAME_GROUPS = NICKNAMES.map(function (line) { return line.split(' '); });

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
