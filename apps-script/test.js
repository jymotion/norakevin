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
    getRange(r, c, nr, nc) {
      const sheet = this;
      return {
        getValues() {
          return sheet.rows.slice(r - 1, r - 1 + nr).map(row => {
            const out = row.slice(c - 1, c - 1 + nc);
            while (out.length < nc) out.push('');
            return out;
          });
        },
        setValues(vals) {
          vals.forEach((v, i) => {
            const row = sheet.rows[r - 1 + i] || (sheet.rows[r - 1 + i] = []);
            v.forEach((x, j) => { row[c - 1 + j] = x; });
          });
          return this;
        },
        setFontWeight() { return this; }
      };
    },
    appendRow(v) { this.rows.push(v); },
    setFrozenRows() {}
  };
}

function load(guestRows) {
  const sheets = {
    Guests: fakeSheet([['Household', 'First name', 'Last name', 'Attending', 'Meal', 'Dietary notes', 'Last updated'], ...guestRows.map(r => r.slice())])
  };
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
  ['H1', 'Alex', 'Sample', '', '', '', ''],
  ['H1', 'Jordan', 'Sample', '', '', '', ''],
  ['H2', 'Zoë', "O'Brien", '', '', '', ''],
  ['H3', 'Sam', 'Twin', '', '', '', ''],
  ['H4', 'Sam', 'Twin', '', '', '', ''],
  ['H5', 'Pat Sr', 'Example', '', '', '', ''],
  ['H5', 'Pat Jr', 'Example', '', '', '', '']
];

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

test('lookup returns the whole household', () => {
  const { post } = load(guests);
  const res = post({ action: 'lookup', name: '  alex   SAMPLE ' });
  assert.ok(res.ok);
  assert.deepStrictEqual(res.members.map(m => m.first), ['Alex', 'Jordan']);
  assert.deepStrictEqual(res.meals, ['Chicken', 'Fish', 'Vegetarian']);
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
    action: 'save', name: 'Pat Example', responses: [
      { first: 'Pat Sr', last: 'Example', attending: 'yes', meal: 'Fish' },
      { first: 'Pat Jr', last: 'Example', attending: 'no' }
    ]
  }).ok);
  assert.deepStrictEqual(sheets.Guests.rows.slice(6).map(r => r[3]), ['Yes', 'No']);
});

test('honeypot blocks bots', () => {
  const { post } = load(guests);
  assert.strictEqual(post({ action: 'lookup', name: 'Alex Sample', website: 'x' }).ok, false);
});

test('save writes every household member and logs it', () => {
  const { post, sheets } = load(guests);
  const res = post({
    action: 'save', name: 'Alex Sample', responses: [
      { first: 'Alex', last: 'Sample', attending: 'yes', meal: 'Fish', dietary: 'No nuts' },
      { first: 'Jordan', last: 'Sample', attending: 'no', meal: 'Chicken', dietary: 'ignored' }
    ]
  });
  assert.ok(res.ok, res.error);
  const rows = sheets.Guests.rows;
  assert.deepStrictEqual(rows[1].slice(3, 6), ['Yes', 'Fish', 'No nuts']);
  assert.deepStrictEqual(rows[2].slice(3, 6), ['No', '', '']);
  assert.strictEqual(Object.prototype.toString.call(rows[1][6]), '[object Date]');
  assert.strictEqual(sheets['Responses log'].rows.length, 3);
  // Other households untouched.
  assert.strictEqual(rows[3][3], '');
  // Lookup now returns saved answers for editing.
  const again = post({ action: 'lookup', name: 'Jordan Sample' });
  assert.deepStrictEqual(again.members.map(m => m.attending), ['yes', 'no']);
});

test('save rejects missing members, bad meals, and missing answers without writing', () => {
  const { post, sheets } = load(guests);
  const alex = { first: 'Alex', last: 'Sample', attending: 'yes', meal: 'Fish', dietary: '' };
  assert.match(post({ action: 'save', name: 'Alex Sample', responses: [alex] }).error, /Jordan Sample/);
  assert.match(post({
    action: 'save', name: 'Alex Sample',
    responses: [alex, { first: 'Jordan', last: 'Sample', attending: 'yes', meal: 'Steak' }]
  }).error, /meal for Jordan/);
  assert.match(post({
    action: 'save', name: 'Alex Sample',
    responses: [alex, { first: 'Jordan', last: 'Sample', attending: '' }]
  }).error, /whether Jordan/);
  assert.strictEqual(sheets.Guests.rows[1][3], '');
  assert.strictEqual(sheets['Responses log'], undefined);
});

test('save cannot touch another household', () => {
  const { post, sheets } = load(guests);
  const res = post({
    action: 'save', name: 'Alex Sample', responses: [
      { first: 'Alex', last: 'Sample', attending: 'no' },
      { first: 'Jordan', last: 'Sample', attending: 'no' },
      { first: 'Zoë', last: "O'Brien", attending: 'no' }
    ]
  });
  assert.ok(res.ok);
  assert.strictEqual(sheets.Guests.rows[3][3], '');
});

test('notes are trimmed, capped, and cannot become formulas', () => {
  const { post, sheets } = load(guests);
  post({
    action: 'save', name: 'Alex Sample', responses: [
      { first: 'Alex', last: 'Sample', attending: 'yes', meal: 'Fish', dietary: '=HYPERLINK("x")' },
      { first: 'Jordan', last: 'Sample', attending: 'yes', meal: 'Fish', dietary: 'a'.repeat(1000) }
    ]
  });
  assert.strictEqual(sheets.Guests.rows[1][5], '\'=HYPERLINK("x")');
  assert.strictEqual(sheets.Guests.rows[2][5].length, 300);
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
