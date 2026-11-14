/* Bounded note-list rendering and single-flight background refreshes. */
(function (root) {
  'use strict';
  function createModel(notes) {
    var pinned = [], others = [], items = [], positions = [], total = 0;
    notes.forEach(function (note) { (note.pinned ? pinned : others).push(note); });
    function add(item, height) {
      item.top = total; item.height = height; total += height; items.push(item);
    }
    function group(list, name) {
      if (!list.length) return;
      add({ kind: 'group', name: name, count: list.length }, 32);
      list.forEach(function (note) {
        positions.push(total);
        add({ kind: 'note', note: note }, 146);
      });
    }
    group(pinned, 'pinned'); group(others, pinned.length ? 'others' : 'notes');
    return {
      notes: pinned.concat(others), total: total,
      noteTop: function (index) { return positions[index]; },
      window: function (top, height) {
        var low = Math.max(0, top - 438), high = top + height + 438;
        var left = 0, right = items.length;
        while (left < right) {
          var mid = (left + right) >>> 1;
          if (items[mid].top + items[mid].height <= low) left = mid + 1;
          else right = mid;
        }
        var start = left, end = start;
        while (end < items.length && items[end].top < high) end++;
        var before = start < items.length ? items[start].top : total;
        var bottom = end > start ? items[end-1].top + items[end-1].height : before;
        return { items: items.slice(start,end), before: before, after: total-bottom };
      }
    };
  }
  function createQueue(run, schedule) {
    schedule = schedule || function (fn) { return setTimeout(fn, 250); };
    var pending = false, running = false, timer = null;
    function arm() {
      if (running || timer !== null || !pending) return;
      timer = schedule(function () {
        timer = null; pending = false; running = true;
        var result;
        try { result = run(); } catch (err) { result = Promise.reject(err); }
        Promise.resolve(result).catch(function () {}).then(function () {
          running = false; arm();
        });
      });
    }
    return function () { pending = true; arm(); };
  }
  var api = { createModel: createModel, createQueue: createQueue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LNListPerformance = api;
})(typeof window !== 'undefined' ? window : globalThis);
