// Tests Code.gs against a fake in-memory spreadsheet. Run: node apps-script/test.js
// Guest names here are made up.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function fakeSheet(rows) {
  return {
    rows,
    getLastRow() { return this.rows.length; },
    getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); },
    getRange(r, c, nr = 1, nc = 1) {
      const sheet = this;
      return {
        getValues() {
          return sheet.rows.slice(r - 1, r - 1 + nr).map(row => {
            const out = row.slice(c - 1, c - 1 + nc);
            while (out.length < nc) out.push('');
            return out;
          });
        },
        setValue(v) {
          const row = sheet.rows[r - 1] || (sheet.rows[r - 1] = []);
          row[c - 1] = v;
          return this;
        },
        setFontWeight() { return this; }
      };
    },
    appendRow(v) { this.rows.push(v); },
    setFrozenRows() {}
  };
}

const HEADER = ['Household', 'First name', 'Last name', 'Attending', 'Message', 'Last updated'];

function load(guestRows, header = HEADER) {
  const sheets = { Guests: fakeSheet([header.slice(), ...guestRows.map(r => r.slice())]) };
  const ctx = {
    console: { log: console.log, error() {} },
    SpreadsheetApp: {
      getActive: () => ({
        getSheetByName: n => sheets[n] || null,
        insertSheet: n => (sheets[n] = fakeSheet([]))
      })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ body: s, setMimeType() { return this; } })
    },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: { formatDate: d => d.toISOString().slice(0, 10) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), ctx);
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  return { ctx, sheets, post };
}

const guests = [
  ['H1', 'Alex', 'Sample', '', '', ''],
  ['H1', 'Jordan', 'Sample', '', '', ''],
  ['H2', 'Zoë', "O'Brien", '', '', ''],
  ['H3', 'Sam', 'Twin', '', '', ''],
  ['H4', 'Sam', 'Twin', '', '', ''],
  ['H5', 'Pat Sr', 'Example', '', '', ''],
  ['H5', 'Pat Jr', 'Example', '', '', '']
];
const ALEX = 1, JORDAN = 2, ZOE = 3; // row indexes in the fake sheet (0 = header)
const ATT = 3, MSG = 4, UPD = 5;    // column indexes for the default header

const both = (a, j) => [
  { first: 'Alex', last: 'Sample', attending: a },
  { first: 'Jordan', last: 'Sample', attending: j }
];
// Arrays made inside the sandbox have a different prototype; compare contents.
const plain = v => JSON.parse(JSON.stringify(v));
const isDate = v => Object.prototype.toString.call(v) === '[object Date]';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok -', name);
}

test('lookup needs first and last name', () => {
  const { post } = load(guests);
  assert.match(post({ action: 'lookup', name: 'Alex' }).error, /first and last/);
});

test('lookup returns the whole household, with no meal options', () => {
  const { post } = load(guests);
  const res = post({ action: 'lookup', name: '  alex   SAMPLE ' });
  assert.ok(res.ok);
  assert.deepStrictEqual(res.members, [
    { first: 'Alex', last: 'Sample', suffix: '', attending: '' },
    { first: 'Jordan', last: 'Sample', suffix: '', attending: '' }
  ]);
  assert.strictEqual(res.message, '');
  assert.strictEqual(res.meals, undefined);
});

test('lookup ignores accents and punctuation', () => {
  const { post } = load(guests);
  assert.ok(post({ action: 'lookup', name: 'Zoe OBrien' }).ok);
});

test('unknown name and last name alone reveal nothing', () => {
  const { post } = load(guests);
  assert.match(post({ action: 'lookup', name: 'Nobody Here' }).error, /couldn't find/);
  assert.match(post({ action: 'lookup', name: 'Sample Sample' }).error, /couldn't find/);
});

test('duplicate names across households are refused', () => {
  const { post } = load(guests);
  assert.match(post({ action: 'lookup', name: 'Sam Twin' }).error, /More than one/);
});

test('Jr/Sr are optional when looking up, but still separate people', () => {
  const { post, sheets } = load(guests);
  for (const name of ['Pat Example', 'Pat Sr Example', 'pat example jr']) {
    const res = post({ action: 'lookup', name });
    assert.ok(res.ok, name);
    assert.deepStrictEqual(res.members.map(m => m.first), ['Pat Sr', 'Pat Jr']);
  }
  assert.ok(post({
    action: 'save', name: 'Pat Example', message: 'Hi', responses: [
      { first: 'Pat Sr', last: 'Example', attending: 'yes' },
      { first: 'Pat Jr', last: 'Example', attending: 'no' }
    ]
  }).ok);
  assert.deepStrictEqual(sheets.Guests.rows.slice(6).map(r => r[ATT]), ['Yes', 'No']);
  // An ambiguous search ("Pat Example") puts the message on the first match.
  assert.deepStrictEqual(sheets.Guests.rows.slice(6).map(r => r[MSG]), ['Hi', '']);
  // Typing the suffix picks that exact person, in any word order.
  for (const name of ['Pat Jr Example', 'Pat Example Jr.']) {
    post({ action: 'save', name, message: 'From Jr', responses: [
      { first: 'Pat Sr', last: 'Example', attending: 'yes' },
      { first: 'Pat Jr', last: 'Example', attending: 'no' }
    ] });
    assert.deepStrictEqual(sheets.Guests.rows.slice(6).map(r => r[MSG]), ['Hi', 'From Jr'], name);
  }
});

test('an optional Suffix column shows after the last name and picks the right person', () => {
  const header = ['Household', 'First name', 'Last name', 'Suffix', 'Attending', 'Message', 'Last updated'];
  const { post, sheets } = load([
    ['H1', 'Kim', 'Example', '', '', '', ''],
    ['H1', 'Chris', 'Example', 'Sr.', '', '', ''],
    ['H1', 'Chris', 'Example', 'Jr', '', '', '']
  ], header);
  for (const name of ['Chris Example', 'Chris Example Jr', 'Kim Example']) {
    const res = post({ action: 'lookup', name });
    assert.ok(res.ok, name);
    assert.deepStrictEqual(res.members.map(m => [m.first, m.last, m.suffix].join(' ').trim()),
      ['Kim Example', 'Chris Example Sr.', 'Chris Example Jr']);
  }
  const res = post({ action: 'save', name: 'chris example jr', message: 'Hi', responses: [
    { first: 'Kim', last: 'Example', suffix: '', attending: 'yes' },
    { first: 'Chris', last: 'Example', suffix: 'Sr.', attending: 'no' },
    { first: 'Chris', last: 'Example', suffix: 'Jr', attending: 'yes' }
  ] });
  assert.ok(res.ok, res.error);
  const rows = sheets.Guests.rows.slice(1);
  assert.deepStrictEqual(rows.map(r => r[4]), ['Yes', 'No', 'Yes']);
  assert.deepStrictEqual(rows.map(r => r[5]), ['', '', 'Hi']);
  assert.deepStrictEqual(plain(sheets['Responses log'].rows.slice(1).map(r => r[3])), ['Example', 'Example Sr.', 'Example Jr']);
  // Leaving out a suffix in the answers doesn't count as answering for that person.
  assert.match(post({ action: 'save', name: 'Kim Example', responses: [
    { first: 'Kim', last: 'Example', attending: 'yes' },
    { first: 'Chris', last: 'Example', attending: 'no' }
  ] }).error, /whether Chris Example Sr\./);
});

test('nicknames and short forms find the guest, in either direction', () => {
  const { post } = load([
    ['N1', 'Kimberly', 'Example', '', '', ''],
    ['N1', 'Chris', 'Example', '', '', ''],
    ['N2', 'Robert', 'Byname', '', '', ''],
    ['N2', 'Peg', 'Byname', '', '', ''],
    ['N3', 'Jennifer', 'De La Cruz', '', '', '']
  ]);
  const found = n => { const r = post({ action: 'lookup', name: n }); return r.ok ? r.members.map(m => m.first).join('+') : r.error; };
  assert.strictEqual(found('Kim Example'), 'Kimberly+Chris');
  assert.strictEqual(found('Christopher Example'), 'Kimberly+Chris');
  assert.strictEqual(found('Bob Byname'), 'Robert+Peg');
  assert.strictEqual(found('Margaret Byname'), 'Robert+Peg');
  assert.strictEqual(found('Jen De La Cruz'), 'Jennifer');
  assert.strictEqual(found('Jennifer Ann De La Cruz'), 'Jennifer'); // middle name ignored
});

test('loose matching still needs the last name and a real first-name link', () => {
  const { post } = load([
    ['N1', 'Kimberly', 'Example', '', '', ''],
    ['N2', 'Mark', 'Byname', '', '', '']
  ]);
  for (const name of ['Ki Example', 'Kimberly Exemple', 'Mike Byname', 'Example Example', 'Byname Byname']) {
    assert.match(post({ action: 'lookup', name }).error, /couldn't find/, name);
  }
});

test('an exact match wins over nicknames; ambiguous nicknames are refused', () => {
  const { post } = load([
    ['A', 'Chris', 'Smith', '', '', ''],
    ['B', 'Christopher', 'Smith', '', '', ''],
    ['C', 'Christine', 'Jones', '', '', ''],
    ['D', 'Christopher', 'Jones', '', '', '']
  ]);
  assert.deepStrictEqual(post({ action: 'lookup', name: 'Chris Smith' }).members.map(m => m.first), ['Chris']);
  assert.deepStrictEqual(post({ action: 'lookup', name: 'Christopher Smith' }).members.map(m => m.first), ['Christopher']);
  assert.match(post({ action: 'lookup', name: 'Chris Jones' }).error, /more than one possible match/);
});

test('the message goes to the person found by nickname', () => {
  const { post, sheets } = load([
    ['N1', 'Kimberly', 'Example', '', '', ''],
    ['N1', 'Chris', 'Example', '', '', '']
  ]);
  const res = post({ action: 'save', name: 'Kim Example', message: 'From Kim', responses: [
    { first: 'Kimberly', last: 'Example', attending: 'yes' },
    { first: 'Chris', last: 'Example', attending: 'yes' }
  ] });
  assert.ok(res.ok, res.error);
  assert.deepStrictEqual(sheets.Guests.rows.slice(1).map(r => r[MSG]), ['From Kim', '']);
  assert.strictEqual(post({ action: 'lookup', name: 'Kim Example' }).message, 'From Kim');
});

test('honeypot blocks bots', () => {
  const { post } = load(guests);
  assert.strictEqual(post({ action: 'lookup', name: 'Alex Sample', website: 'x' }).ok, false);
});

test('save writes attendance for everyone and the message on the searcher\'s row', () => {
  const { post, sheets } = load(guests);
  const res = post({ action: 'save', name: 'Jordan Sample', responses: both('yes', 'no'), message: '  So happy for you!  ' });
  assert.ok(res.ok, res.error);
  const rows = sheets.Guests.rows;
  assert.strictEqual(rows[ALEX][ATT], 'Yes');
  assert.strictEqual(rows[JORDAN][ATT], 'No');
  assert.strictEqual(rows[ALEX][MSG], '');
  assert.strictEqual(rows[JORDAN][MSG], 'So happy for you!');
  assert.ok(isDate(rows[ALEX][UPD]) && isDate(rows[JORDAN][UPD]));
  assert.strictEqual(rows[ZOE][ATT], '');
  const log = sheets['Responses log'].rows;
  assert.deepStrictEqual(plain(log[0]), ['Time', 'Household', 'First name', 'Last name', 'Attending', 'Message']);
  assert.deepStrictEqual(plain(log.slice(1).map(r => r.slice(2))), [
    ['Alex', 'Sample', 'Yes', ''],
    ['Jordan', 'Sample', 'No', 'So happy for you!']
  ]);
});

test('lookup shows the searcher their own saved message', () => {
  const { post } = load(guests);
  post({ action: 'save', name: 'Jordan Sample', responses: both('yes', 'yes'), message: 'From Jordan' });
  const jordan = post({ action: 'lookup', name: 'Jordan Sample' });
  assert.strictEqual(jordan.message, 'From Jordan');
  assert.deepStrictEqual(jordan.members.map(m => m.attending), ['yes', 'yes']);
  assert.strictEqual(post({ action: 'lookup', name: 'Alex Sample' }).message, '');
});

test('each household member keeps their own message', () => {
  const { post, sheets } = load(guests);
  post({ action: 'save', name: 'Jordan Sample', responses: both('yes', 'yes'), message: 'From Jordan' });
  post({ action: 'save', name: 'Alex Sample', responses: both('yes', 'no'), message: 'From Alex' });
  assert.strictEqual(sheets.Guests.rows[JORDAN][MSG], 'From Jordan');
  assert.strictEqual(sheets.Guests.rows[ALEX][MSG], 'From Alex');
  assert.strictEqual(sheets.Guests.rows[JORDAN][ATT], 'No');
});

test('save rejects missing members and missing answers without writing', () => {
  const { post, sheets } = load(guests);
  const alex = { first: 'Alex', last: 'Sample', attending: 'yes' };
  assert.match(post({ action: 'save', name: 'Alex Sample', responses: [alex] }).error, /whether Jordan/);
  assert.match(post({ action: 'save', name: 'Alex Sample', responses: both('yes', '') }).error, /whether Jordan/);
  assert.match(post({ action: 'save', name: 'Alex Sample', responses: both('maybe', 'no') }).error, /whether Alex/);
  assert.strictEqual(sheets.Guests.rows[ALEX][ATT], '');
  assert.strictEqual(sheets['Responses log'], undefined);
});

test('save cannot touch another household', () => {
  const { post, sheets } = load(guests);
  const res = post({
    action: 'save', name: 'Alex Sample',
    responses: [...both('no', 'no'), { first: 'Zoë', last: "O'Brien", attending: 'no' }]
  });
  assert.ok(res.ok);
  assert.strictEqual(sheets.Guests.rows[ZOE][ATT], '');
});

test('messages are trimmed, capped, and cannot become formulas', () => {
  const { post, sheets } = load(guests);
  post({ action: 'save', name: 'Alex Sample', responses: both('yes', 'yes'), message: '=HYPERLINK("x")' });
  assert.strictEqual(sheets.Guests.rows[ALEX][MSG], '\'=HYPERLINK("x")');
  post({ action: 'save', name: 'Alex Sample', responses: both('yes', 'yes'), message: 'a'.repeat(5000) });
  assert.strictEqual(sheets.Guests.rows[ALEX][MSG].length, 1000);
});

test('columns are found by header name, in any order, with extra columns', () => {
  const header = ['Notes', 'Last name', 'First name', 'Household', 'Message', 'Address', 'Attending', 'Last updated'];
  const { post, sheets } = load([['', 'Sample', 'Alex', 'H1', '', 'n/a', '', '']], header);
  assert.ok(post({
    action: 'save', name: 'Alex Sample', message: 'Hello',
    responses: [{ first: 'Alex', last: 'Sample', attending: 'yes' }]
  }).ok);
  const row = sheets.Guests.rows[1];
  assert.strictEqual(row[6], 'Yes');
  assert.strictEqual(row[4], 'Hello');
  assert.strictEqual(row[5], 'n/a');
  assert.ok(isDate(row[7]));
});

test('a missing column gives a friendly error; setUp adds it without disturbing others', () => {
  const old = ['Household', 'First name', 'Last name', 'Attending', 'Meal', 'Dietary notes', 'Last updated'];
  const { post, ctx, sheets } = load([['H1', 'Alex', 'Sample', 'Yes', 'Fish', '', '']], old);
  assert.match(post({ action: 'lookup', name: 'Alex Sample' }).error, /went wrong/);
  ctx.setUp();
  assert.deepStrictEqual(plain(sheets.Guests.rows[0]), [...old, 'Message']);
  const res = post({ action: 'lookup', name: 'Alex Sample' });
  assert.ok(res.ok, res.error);
  assert.strictEqual(res.members[0].attending, 'yes');
});

test('setUp builds a fresh Guests tab', () => {
  const { ctx, sheets } = load([]);
  delete sheets.Guests;
  ctx.setUp();
  assert.deepStrictEqual(plain(sheets.Guests.rows[0]), HEADER);
  assert.ok(sheets['Responses log']);
});

test('deadline blocks saving', () => {
  const { post, ctx } = load(guests);
  vm.runInContext("RSVP_DEADLINE = '2000-01-01'", ctx);
  assert.strictEqual(post({ action: 'lookup', name: 'Alex Sample' }).deadlinePassed, true);
  assert.match(post({ action: 'save', name: 'Alex Sample', responses: [] }).error, /deadline/);
});

test('bad JSON gets a friendly error', () => {
  const { ctx } = load(guests);
  const res = JSON.parse(ctx.doPost({ postData: { contents: '{nope' } }).body);
  assert.strictEqual(res.ok, false);
});

console.log(`\n${passed} tests passed`);
