// Shared site behavior: navbar scroll state + active nav link.
// Loaded on every page so the scroll/collapse logic lives in one place.
(function () {
  var navbar = document.getElementById('mainNavbar');
  if (!navbar) return;

  function onScroll() {
    if (window.scrollY > 50) {
      navbar.classList.add('navbar-scrolled');
    } else {
      navbar.classList.remove('navbar-scrolled');
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Mark the current page's nav link as active.
  var here = (location.pathname.split('/').pop() || 'index.html');
  document.querySelectorAll('#mainNavbar .nav-link').forEach(function (link) {
    var href = (link.getAttribute('href') || '').split('/').pop();
    if (href === here) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });
})();
