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
    var playing = video.play();
    // If the browser refuses (e.g. iPhone Low Power Mode), the poster stays.
    if (playing && playing.catch) playing.catch(function () {});
  }
})();
