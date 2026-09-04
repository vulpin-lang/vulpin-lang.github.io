// Vulpin motion — no WebGL, no per-frame loop.
// Everything here is either a one-shot CSS transition triggered by an
// IntersectionObserver (fires once per element, then stops watching it)
// or a plain CSS keyframe animation the browser compositor handles on
// its own. There is no requestAnimationFrame loop in this file.
(function () {
  var REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Scroll reveal --------------------------------------------------
  var targets = document.querySelectorAll('.reveal');
  if (targets.length) {
    if (REDUCE_MOTION || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('reveal-visible'); });
    } else {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('reveal-visible');
              io.unobserve(entry.target); // one-shot: stop watching once shown
            }
          });
        },
        { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
      );
      targets.forEach(function (el) { io.observe(el); });
    }
  }

  // ---- Signature mark draw-in (homepage hero only) ---------------------
  var mark = document.querySelector('.hero-fox-mark');
  if (mark && !REDUCE_MOTION) {
    mark.classList.add('js-animate');
    // Double rAF: let the browser paint the "hidden" state first, then
    // flip to the "drawn" state so the transition actually animates.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        mark.classList.add('js-drawn');
      });
    });
  }
})();
