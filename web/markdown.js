/* Minimal, dependency-free Markdown renderer for the Locknote preview.
   Supports the subset an AI agent typically writes: headings, emphasis,
   lists, task lists, quotes, fenced code, tables, links, images, rules. */
(function () {
  'use strict';

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function diagramBlock(source, language, direction) {
    var en = window.LNI18N && window.LNI18N.lang === 'en-US';
    return '<div class="diagram-block svg-preview" data-diagram="' + language + '" data-direction="' + escapeHTML(direction || 'TD') + '">' +
      '<div class="diagram-tabs"><button type="button" data-diagram-mode="preview" aria-pressed="true">' + (en ? 'Preview' : '预览') + '</button>' +
      '<button type="button" data-diagram-mode="source" aria-pressed="false">' + (en ? 'Source' : '源码') + '</button></div>' +
      '<div class="diagram-output" aria-live="polite">' + (en ? 'Rendering…' : '正在绘制…') + '</div>' +
      '<pre class="diagram-source hidden"><code>' + escapeHTML(source) + '</code></pre></div>';
  }

  function inline(text) {
    var codes = [];
    var out = escapeHTML(text);

    out = out.replace(/`([^`]+)`/g, function (_, code) {
      codes.push('<code>' + code + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });

    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, src) {
      return '<img alt="' + alt + '" src="' + src + '">';
    });
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, href) {
      var safe = /^(https?:|mailto:|#|\/)/i.test(href) ? href : '#';
      return '<a href="' + safe + '" target="_blank" rel="noreferrer">' + label + '</a>';
    });
    out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/(^|[^_])__([^_]+)__/g, '$1<strong>$2</strong>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return out.replace(/\u0000(\d+)\u0000/g, function (_, i) { return codes[Number(i)]; });
  }

  function splitRow(line) {
    var s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    var cells = [];
    var cur = '';
    var inCode = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '`') inCode = !inCode;
      if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function isTableSeparator(line) {
    return /^\s*\|?[\s:-]*-[\s|:-]*$/.test(line) && line.indexOf('-') >= 0 && line.indexOf('|') >= 0;
  }

  function renderList(items) {
    // items: [{indent, ordered, text, task}]
    var html = '';
    var stack = [];
    var i = 0;
    while (i < items.length) {
      var it = items[i];
      var level = it.indent;
      while (stack.length && stack[stack.length - 1].indent > level) {
        html += '</li></' + stack.pop().tag + '>';
      }
      if (!stack.length || stack[stack.length - 1].indent < level) {
        var tag = it.ordered ? 'ol' : 'ul';
        html += '<' + tag + '>';
        stack.push({ indent: level, tag: tag });
      }
      var box = '';
      var body = it.text;
      var task = /^\[([ xX])\]\s+/.exec(body);
      if (task) {
        box = '<input type="checkbox" disabled' + (task[1].toLowerCase() === 'x' ? ' checked' : '') + '> ';
        body = body.replace(/^\[([ xX])\]\s+/, '');
      }
      html += '<li>' + box + inline(body);
      // close this li when the next item is not deeper
      var next = items[i + 1];
      if (!next || next.indent <= level) {
        html += '</li>';
      }
      i++;
    }
    while (stack.length) html += '</li></' + stack.pop().tag + '>';
    return html;
  }

  function render(md) {
    var lines = String(md == null ? '' : md).replace(/\r\n/g, '\n').split('\n');
    var html = '';
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (/^\s*$/.test(line)) { i++; continue; }

      // fenced code
      var fence = /^\s*```\s*([\w+-]*)(?:[ \t]+(TD|TB|BT|LR|RL))?\s*$/i.exec(line);
      if (fence) {
        var lang = fence[1];
        var buf = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        if (['svg', 'mermaid', 'flowchart'].indexOf(lang.toLowerCase()) >= 0) { html += diagramBlock(buf.join(String.fromCharCode(10)), lang.toLowerCase(), fence[2]); continue; }
        html += '<pre><code' + (lang ? ' class="language-' + escapeHTML(lang) + '"' : '') + '>' +
          escapeHTML(buf.join('\n')) + '</code></pre>';
        continue;
      }

      // Standalone SVG is collected before Markdown parses its contents.
      if (/^\s*<svg(?:\s|>)/i.test(line)) {
        var svgLines = [];
        do { svgLines.push(lines[i++]); } while (i < lines.length && !/<\/svg>\s*$/i.test(svgLines[svgLines.length - 1]));
        html += diagramBlock(svgLines.join(String.fromCharCode(10)), 'svg');
        continue;
      }

      // horizontal rule
      if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line) && line.replace(/[\s-*_]/g, '') === '') {
        html += '<hr>';
        i++;
        continue;
      }

      // heading
      var h = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        var lvl = Math.min(h[1].length + 1, 6);
        html += '<h' + lvl + '>' + inline(h[2].replace(/\s+#+\s*$/, '')) + '</h' + lvl + '>';
        i++;
        continue;
      }

      // table
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        var head = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && !/^\s*$/.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        html += '<table><thead><tr>';
        head.forEach(function (c) { html += '<th>' + inline(c) + '</th>'; });
        html += '</tr></thead><tbody>';
        rows.forEach(function (r) {
          html += '<tr>';
          for (var k = 0; k < head.length; k++) html += '<td>' + inline(r[k] || '') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table>';
        continue;
      }

      // blockquote
      if (/^\s*>/.test(line)) {
        var quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        html += '<blockquote>' + render(quote.join('\n')) + '</blockquote>';
        continue;
      }

      // list
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        var items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          var m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
          items.push({
            indent: Math.floor(m[1].replace(/\t/g, '  ').length / 2),
            ordered: /\d+\./.test(m[2]),
            text: m[3]
          });
          i++;
          // continuation lines (indented text belonging to the item)
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
            items[items.length - 1].text += ' ' + lines[i].trim();
            i++;
          }
        }
        html += renderList(items);
        continue;
      }

      // paragraph
      var para = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
        !/^\s*(#{1,6})\s+/.test(lines[i]) && !/^\s*```/.test(lines[i]) &&
        !/^\s*<svg(?:\s|>)/i.test(lines[i]) && !/^\s*>/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        para.push(lines[i]);
        i++;
        if (i < lines.length && lines[i].indexOf('|') >= 0 && isTableSeparator(lines[i])) break;
      }
      html += '<p>' + inline(para.join('\n')).replace(/\n/g, '<br>') + '</p>';
    }

    return html;
  }

  window.LNMarkdown = { render: render, escapeHTML: escapeHTML };
})();
