// Shared page behavior: the phone menu and the countdown.
(function () {
  'use strict';

  var button = document.querySelector('.menu-button');
  var nav = document.getElementById('site-nav');
  if (button && nav) {
    var setOpen = function (open) {
      nav.classList.toggle('open', open);
      button.setAttribute('aria-expanded', String(open));
      button.textContent = open ? '✕' : '☰';
      button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    button.addEventListener('click', function () {
      setOpen(!nav.classList.contains('open'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        setOpen(false);
        button.focus();
      }
    });
  }

  // <p class="countdown" data-date="YYYY-MM-DD" hidden> shows "N days to go!".
  var countdown = document.querySelector('.countdown[data-date]');
  if (countdown && /^\d{4}-\d{2}-\d{2}$/.test(countdown.dataset.date)) {
    var p = countdown.dataset.date.split('-');
    var day = new Date(+p[0], +p[1] - 1, +p[2]);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.round((day - today) / 86400000);
    if (days >= 0) {
      countdown.textContent = days === 0 ? 'Today’s the day!' : days === 1 ? '1 day to go!' : days + ' days to go!';
      countdown.hidden = false;
    }
  }
})();
