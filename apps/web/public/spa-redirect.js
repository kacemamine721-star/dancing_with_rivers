// GitHub Pages SPA fallback, part 2: restore the deep link that 404.html stashed in ?p=
// (external file so the CSP can stay script-src 'self').
(function (l) {
  var q = new URLSearchParams(l.search);
  var p = q.get('p');
  if (!p) return;
  q.delete('p');
  var rest = q.toString();
  var path = p.charAt(0) === '/' ? p : '/' + p;
  window.history.replaceState(null, '', path + (rest ? (path.indexOf('?') >= 0 ? '&' : '?') + rest : '') + l.hash);
})(window.location);
