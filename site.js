// Shared page behavior: the phone menu and the home page video.
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

  // Home page video: starts silently and loops. Visitors whose device asks
  // for reduced motion see the still poster image instead.
  var video = document.querySelector('.hero-video');
  if (video && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    video.muted = true;
    // Some browsers refuse to start video until the visitor has interacted with
    // the page (strict autoplay settings, iPhone Low Power Mode). The poster
    // shows meanwhile, and the first tap, click or key press starts it.
    var events = ['pointerdown', 'touchstart', 'keydown'];
    var stopListening = function () {
      events.forEach(function (t) { document.removeEventListener(t, tryPlay, true); });
    };
    var tryPlay = function () {
      var playing = video.play();
      if (playing && playing.then) playing.then(stopListening, function () {});
    };
    events.forEach(function (t) { document.addEventListener(t, tryPlay, true); });
    tryPlay();
    // Backup for the loop attribute: if a browser stops at the end, restart.
    video.addEventListener('ended', function () {
      video.currentTime = 0;
      tryPlay();
    });
  }
})();
