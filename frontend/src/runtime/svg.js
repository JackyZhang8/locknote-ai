/* Static SVG preview: rebuild allowed nodes and display in isolated image context. */
(function () {
  'use strict';
  function sanitize(source) {
    if (source.length > 500000 || /<!DOCTYPE|<!ENTITY/i.test(source)) return '';
    var doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') return '';
    var ns = 'http://www.w3.org/2000/svg';
    var tags = 'svg g defs title desc path rect circle ellipse line polyline polygon text tspan linearGradient radialGradient stop clipPath mask marker'.split(' ');
    var attrs = 'id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray opacity transform preserveAspectRatio font-family font-size font-weight text-anchor dominant-baseline dx dy offset stop-color stop-opacity gradientUnits gradientTransform fx fy clip-path mask marker-start marker-mid marker-end markerWidth markerHeight refX refY orient markerUnits'.split(' ');
    var count = 0;
    function clean(node, depth) {
      if (++count > 3000 || depth > 40) throw new Error('SVG too complex');
      if (node.nodeType === 3) return doc.createTextNode(node.textContent);
      if (node.nodeType !== 1 || (node.namespaceURI && node.namespaceURI !== ns) || tags.indexOf(node.localName) < 0) return null;
      var copy = doc.createElementNS(ns, node.localName);
      Array.prototype.forEach.call(node.attributes, function (attr) {
        if (attr.namespaceURI || attrs.indexOf(attr.name) < 0) return;
        if (/^url\(#[A-Za-z_][A-Za-z0-9_.-]*\)$/.test(attr.value) && ['fill', 'stroke', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end'].indexOf(attr.name) >= 0) { copy.setAttribute(attr.name, attr.value); return; }
        if (/[\\<>]/.test(attr.value) || /url|https?:|data:|javascript:|@|expression/i.test(attr.value)) return;
        copy.setAttribute(attr.name, attr.value);
      });
      Array.prototype.forEach.call(node.childNodes, function (child) {
        var safe = clean(child, depth + 1); if (safe) copy.appendChild(safe);
      });
      return copy;
    }
    try { return new XMLSerializer().serializeToString(clean(doc.documentElement, 0)); } catch (err) { return ''; }
  }
  window.LNSVG = { sanitize: sanitize };
})();
