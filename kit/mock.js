// design-driven-development kit: optional helpers for mocks. Draws the stand-in keyboard (.keyboard) and lets
// ?theme=dark|light on a mock's URL force a theme. A mock must still look right without it.
(function () {
  var theme = new URLSearchParams(location.search).get('theme');
  if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);

  function key(label, cls) {
    var k = document.createElement('span');
    k.className = 'kb-key' + (cls ? ' ' + cls : '');
    k.textContent = label;
    return k;
  }
  function row(keys) {
    var r = document.createElement('div');
    r.className = 'kb-row';
    keys.forEach(function (k) { r.appendChild(typeof k === 'string' ? key(k) : key(k[0], k[1])); });
    return r;
  }
  function draw() {
    document.querySelectorAll('.keyboard:empty').forEach(function (kb) {
      var ret = kb.getAttribute('data-return');
      if (kb.getAttribute('data-layout') === 'azerty') {
        kb.appendChild(row('azertyuiop'.split('')));
        kb.appendChild(row('qsdfghjklm'.split('')));
        kb.appendChild(row([['⇧', 'wide']].concat('wxcvbn'.split('')).concat([["'", ''], ['⌫', 'wide']])));
        kb.appendChild(row([['123', 'wide'], ['🌐', 'wide'], ['espace', 'space'], [ret || 'retour', 'ret']]));
      } else {
        kb.appendChild(row('qwertyuiop'.split('')));
        kb.appendChild(row('asdfghjkl'.split('')));
        kb.appendChild(row([['⇧', 'wide']].concat('zxcvbnm'.split('')).concat([['⌫', 'wide']])));
        kb.appendChild(row([['123', 'wide'], ['🌐', 'wide'], ['space', 'space'], [ret || 'return', 'ret']]));
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', draw);
  else draw();
})();
