/**
 * Shared Mercantec Games navbar
 * Absolute paths — works with <base href="/Pong/">
 */
(function () {
  if (document.querySelector('.arena-nav')) return;

  var path = window.location.pathname || '';
  var active =
    /\/Bomberman/i.test(path) ? 'bomber' :
    /\/Wizard/i.test(path) ? 'wizard' :
    /\/Tetris/i.test(path) ? 'tetris' :
    /\/Pong/i.test(path) ? 'pong' :
    /\/guide/i.test(path) ? 'guide' :
    /\/status/i.test(path) ? 'status' :
    'select';

  function cls(key) {
    return key === active ? ' class="active"' : '';
  }

  var nav = document.createElement('header');
  nav.className = 'arena-nav';
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', 'Mercantec Games');
  nav.innerHTML =
    '<a class="arena-nav-brand" href="/">' +
      '<span class="arena-nav-mark">MERCANTEC</span>' +
      '<span class="arena-nav-sub">GAMES · EST. ARENA</span>' +
    '</a>' +
    '<nav class="arena-nav-links">' +
      '<a href="/"' + cls('select') + '>SELECT</a>' +
      '<a href="/guide"' + cls('guide') + '>GUIDE</a>' +
      '<a href="/status"' + cls('status') + '>STATUS</a>' +
      '<a href="/Bomberman/"' + cls('bomber') + '>BOMBER</a>' +
      '<a href="/Wizard/"' + cls('wizard') + '>WIZARD</a>' +
      '<a href="/Tetris/"' + cls('tetris') + '>TETRIS</a>' +
      '<a href="/Pong/"' + cls('pong') + '>PONG</a>' +
    '</nav>';

  document.body.insertBefore(nav, document.body.firstChild);
})();
