// RSVP page. Talks to the Google Apps Script web app in apps-script/Code.gs.
// Without ENDPOINT (or with ?demo in the URL) the page runs in demo mode with made-up guests.
(function () {
  'use strict';

  // The web app URL from Deploy > Manage deployments (ends in /exec).
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbwAtKmCJWp4bNxXAGjoBt3RAMbzHJZa6_z9no35ycB9EyyZc2pJugaFBhi0-7uNbg65WA/exec';

  // Add ?demo to the URL to try the page with made-up guests.
  var demo = !ENDPOINT || /[?&]demo\b/.test(location.search);
  var $ = function (id) { return document.getElementById(id); };
  var lookupForm = $('lookup-form');
  var householdForm = $('household-form');
  var people = $('people');
  var message = $('message');
  var done = $('done');

  // Name the guest searched with; the server re-checks it on save, and their
  // message is stored on their row of the Sheet.
  var currentName = '';

  // ---- Server ----

  // Give up on a request that never answers, so the page can't hang. Saving
  // again is safe: it overwrites the same rows.
  var TIMEOUT_MS = 30000;

  function call(payload) {
    if (demo) return demoCall(payload);
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    // text/plain keeps this a "simple" request, which Apps Script accepts cross-origin.
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
      .then(function (res) { return res.json(); })
      .then(function (data) { clearTimeout(timer); return data; },
        function (err) { clearTimeout(timer); throw err; });
  }

  // ---- Screens ----

  function show(el) {
    [lookupForm, householdForm, done].forEach(function (s) { s.hidden = s !== el; });
  }

  function say(text, kind) {
    message.textContent = text;
    message.className = 'message ' + (kind || 'error');
    message.hidden = !text;
    if (text) message.scrollIntoView({ block: 'nearest' });
  }

  function busy(form, on) {
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = on;
    if (on) btn.dataset.label = btn.textContent;
    btn.textContent = on ? 'One moment…' : btn.dataset.label || btn.textContent;
  }

  function lookup(name) {
    busy(lookupForm, true);
    say('');
    return call({ action: 'lookup', name: name, website: $('website').value })
      .then(function (res) {
        if (!res.ok) return say(res.error);
        currentName = name;
        renderHousehold(res.members, res.message, res.deadlinePassed);
        show(householdForm);
        householdForm.querySelector('input').focus();
      })
      .catch(function () { say("We couldn't reach the RSVP system. Please try again, or text or call us."); })
      .then(function () { busy(lookupForm, false); });
  }

  function renderHousehold(members, note, deadlinePassed) {
    people.textContent = '';
    $('note').value = note || '';
    var answered = members.some(function (m) { return m.attending; });
    $('household-intro').textContent = deadlinePassed
      ? 'The RSVP deadline has passed. Here is what we have; text or call us to make changes.'
      : answered
        ? "Here's your current RSVP. Change anything you like and send it again."
        : members.length > 1
          ? 'Please answer for everyone in your party.'
          : 'Please let us know if you can make it.';
    members.forEach(function (m, i) { people.appendChild(personFields(m, i)); });
    householdForm.querySelector('button[type="submit"]').hidden = !!deadlinePassed;
    Array.prototype.forEach.call(householdForm.elements, function (el) {
      if (el.id !== 'start-over') el.disabled = !!deadlinePassed;
    });
  }

  function personFields(m, i) {
    var fs = el('fieldset', { className: 'person' });
    fs.dataset.first = m.first;
    fs.dataset.last = m.last;
    fs.appendChild(el('legend', { textContent: m.first + ' ' + m.last }));

    var choices = el('div', { className: 'choices', role: 'radiogroup' });
    choices.setAttribute('aria-label', 'Will ' + m.first + ' attend?');
    [['yes', 'Joyfully accepts'], ['no', 'Regretfully declines']].forEach(function (opt) {
      var input = el('input', { type: 'radio', name: 'attending-' + i, value: opt[0], required: true });
      input.checked = m.attending === opt[0];
      var label = el('label');
      label.appendChild(input);
      label.appendChild(document.createTextNode(opt[1]));
      choices.appendChild(label);
    });
    fs.appendChild(choices);
    return fs;
  }

  function el(tag, props) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { node[k] = props[k]; });
    return node;
  }

  function collect() {
    return Array.prototype.map.call(people.querySelectorAll('.person'), function (fs) {
      var checked = fs.querySelector('input[type="radio"]:checked');
      return {
        first: fs.dataset.first,
        last: fs.dataset.last,
        attending: checked ? checked.value : ''
      };
    });
  }

  // ---- Events ----

  lookupForm.addEventListener('submit', function (e) {
    e.preventDefault();
    lookup($('name').value.trim());
  });

  householdForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var responses = collect();
    busy(householdForm, true);
    say('');
    call({ action: 'save', name: currentName, responses: responses, message: $('note').value })
      .then(function (res) {
        if (!res.ok) return say(res.error);
        var coming = responses.filter(function (r) { return r.attending === 'yes'; }).length;
        say(coming
          ? 'Thank you! Your RSVP is saved. We can’t wait to celebrate with you.'
          : 'Thank you for letting us know. You’ll be missed!', 'success');
        show(done);
      })
      .catch(function () { say("We couldn't save your RSVP. Please try again, or text or call us."); })
      .then(function () { busy(householdForm, false); });
  });

  $('start-over').addEventListener('click', function () {
    say('');
    $('name').value = '';
    show(lookupForm);
    $('name').focus();
  });

  $('edit-again').addEventListener('click', function () {
    lookup(currentName);
  });

  // ---- Demo backend (made-up guests, kept in memory only) ----

  var demoGuests = [
    { household: 'demo-1', first: 'Alex', last: 'Sample', attending: '', message: '' },
    { household: 'demo-1', first: 'Jordan', last: 'Sample', attending: '', message: '' },
    { household: 'demo-1', first: 'Riley', last: 'Sample', attending: '', message: '' },
    { household: 'demo-2', first: 'Pat', last: 'Example', attending: '', message: '' }
  ];

  function demoCall(req) {
    var norm = function (s) { return String(s).toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim(); };
    var match = demoGuests.filter(function (g) { return norm(g.first + ' ' + g.last) === norm(req.name); })[0];
    var res;
    if (norm(req.name).split(' ').length < 2) {
      res = { ok: false, error: 'Please enter your first and last name.' };
    } else if (!match) {
      res = { ok: false, error: "We couldn't find that name. Try the name on your invitation, or text or call us." };
    } else {
      var household = demoGuests.filter(function (g) { return g.household === match.household; });
      if (req.action === 'lookup') {
        res = {
          ok: true,
          message: match.message,
          members: household.map(function (g) { return { first: g.first, last: g.last, attending: g.attending }; })
        };
      } else {
        res = { ok: true };
        household.forEach(function (g) {
          var r = req.responses.filter(function (x) { return x.first === g.first && x.last === g.last; })[0];
          if (!r || !r.attending) res = { ok: false, error: 'Please say whether ' + g.first + ' ' + g.last + ' will attend.' };
        });
        if (res.ok) {
          household.forEach(function (g) {
            g.attending = req.responses.filter(function (x) { return x.first === g.first && x.last === g.last; })[0].attending;
          });
          match.message = String(req.message || '').trim();
        }
      }
    }
    return new Promise(function (resolve) { setTimeout(function () { resolve(res); }, 400); });
  }

  // ---- Start ----

  $('demo-banner').hidden = !demo;
  show(lookupForm);
})();
