/* Locknote MCP — workspace app */
export function startWorkspace() {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var icon = function (name) { return '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>'; };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var md = window.LNMarkdown;
  var i18n = window.LNI18N;
  var tr = i18n.tr;

  var DAY = 86400000;
  // 列表分批加载：首屏只取几十篇，滚动到底部附近再取下一批。
  var PAGE_SIZE = 40;
  var LOAD_AHEAD = 260;
  // 侧栏同样分批渲染：几千个标签一次性塞进 DOM 会拖慢首屏并制造超长滚动区。
  var SIDEBAR_PAGE = 60;
  // 侧栏与列表里允许显示的最大字数，超出用省略号；完整名称放在 title 上。
  var NAV_LABEL_CHARS = 24;
  var NOTE_TITLE_CHARS = 60;

  var clampChars = function (s, max) {
    var chars = Array.from(String(s == null ? '' : s));
    return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join('');
  };

  // 带占位符的翻译，避免把句子拆成难以维护的碎片短语。
  var fmt = function (text) {
    var out = tr(text);
    for (var i = 1; i < arguments.length; i++) {
      out = out.split('{' + (i - 1) + '}').join(String(arguments[i]));
    }
    return out;
  };

  var DEFAULT_PREFS = {
    theme: 'green', language: 'zh-CN', editorMode: 'auto',
    fontSize: 'medium', aiNotebook: '', showAiBadge: 'true'
  };

  var state = {
    scope: 'all',
    searchActive: false,
    notes: [],
    total: 0,
    hasMore: false,
    loadingMore: false,
    listToken: 0,
    listKey: '',
    stats: null,
    notebooks: [],
    tags: [],
    folderLimit: SIDEBAR_PAGE,
    tagLimit: SIDEBAR_PAGE,
    selectedId: null,
    note: null,
    query: '',
    sort: 'updated',
    multi: false,
    chosen: new Set(),
    preview: false,
    system: null,
    tab: 'connect',
    client: 'claude',
    loading: false,
    saveTimer: null,
    lastLocalEdit: 0,
    prefs: Object.assign({}, DEFAULT_PREFS),
    settingsTab: 'general'
  };

  /* ------------------------------------------------------------------ api */

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: {} };
    if (opts.signal) init.signal = opts.signal;
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch('/api' + path, init).then(function (res) {
      if (res.status === 204) return null;
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || (tr('请求失败 ') + res.status));
        return data;
      });
    });
  }

  function toast(msg, opts) {
    var el = $('toast');
    var canUndo = opts && opts.undo;
    var markup = (opts && opts.ai ? '<span class="ai-mark">' + icon('sparkles') + '</span>' : '') + '<span>' + esc(msg) + '</span>';
    if (canUndo) markup += '<button type="button" data-toast-undo>' + esc(tr('撤销')) + '</button>';
    window.LNReactUI.renderRegion(el, markup);
    if (canUndo) {
      var undo = el.querySelector('[data-toast-undo]');
      undo.onclick = function () {
        undo.disabled = true;
        Promise.all(opts.undo.map(function (id) { return api('/notes/' + id + '/restore', { method: 'POST' }); })).then(function () { el.classList.remove('show'); return refreshAll({ keepSelection: true }); }).catch(function (err) { undo.disabled = false; toast(err.message); });
      };
    }
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, opts && opts.ms ? opts.ms : 2600);
  }

  /* ------------------------------------------------------------ progress */

  function bootStep(pct, label) {
    var overlay = $('bootOverlay');
    if (!overlay || overlay.classList.contains('done')) return;
    var value = Math.max(0, Math.min(100, Math.round(pct)));
    $('bootBar').style.width = value + '%';
    $('bootPct').textContent = value + '%';
    if (label) $('bootLabel').textContent = label;
  }

  function finishBoot() {
    var overlay = $('bootOverlay');
    if (!overlay || overlay.classList.contains('done')) return;
    bootStep(100, tr('就绪'));
    overlay.classList.add('done');
    setTimeout(function () {
      overlay.classList.add('hidden');
    }, 420);
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // 整库导出：流式读取响应体，边下载边推进进度条，而不是立刻弹一个空白标签页。
  function exportBackup() {
    var overlay = $('exportOverlay');
    var bar = $('exportBar');
    var stage = $('exportStage');
    var pctEl = $('exportPct');
    var bytesEl = $('exportBytes');
    var cancelBtn = $('exportCancel');
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var track = overlay.querySelector('.progress-track');
    var cancelled = false;
    var closed = false;
    var started = Date.now();
    // 第一个字节到达前给出「仍在干活」的持续反馈，而不是一条静止的进度条。
    var ticker = setInterval(function () {
      if (!closed) bytesEl.textContent = fmt('已用时 {0}s', ((Date.now() - started) / 1000).toFixed(1));
    }, 200);

    function close() {
      if (closed) return;
      closed = true;
      clearInterval(ticker);
      track.classList.remove('pending');
      overlay.classList.remove('show');
      cancelBtn.removeEventListener('click', onCancel);
    }
    function onCancel() {
      cancelled = true;
      if (controller) controller.abort();
      close();
      toast(tr('已取消导出'));
    }
    function progress(value, bytes, text) {
      if (closed) return;
      var v = Math.max(0, Math.min(100, Math.round(value)));
      bar.style.width = v + '%';
      pctEl.textContent = v + '%';
      if (bytes != null) bytesEl.textContent = formatBytes(bytes);
      if (text) stage.textContent = text;
    }

    overlay.classList.add('show');
    bar.classList.remove('done');
    track.classList.add('pending');
    cancelBtn.addEventListener('click', onCancel);
    progress(6, 0, tr('正在读取笔记并打包…'));

    var init = controller ? { signal: controller.signal } : {};
    return fetch('/api/export?format=markdown', init).then(function (res) {
      if (!res.ok) throw new Error(fmt('导出失败 {0}', res.status));
      var disposition = res.headers.get('Content-Disposition') || '';
      var match = /filename="?([^";]+)"?/.exec(disposition);
      var filename = match ? match[1] : 'locknote-ai-backup.zip';
      var total = Number(res.headers.get('Content-Length')) || 0;
      var noteCount = Number(res.headers.get('X-Export-Notes')) || 0;
      clearInterval(ticker);
      track.classList.remove('pending');
      if (noteCount) stage.textContent = fmt('正在打包 {0} 篇笔记…', noteCount);

      function finishBlob(blob) {
        progress(100, blob.size, tr('打包完成，正在保存…'));
        bar.classList.add('done');
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        toast(fmt('已导出 {0}', filename));
        setTimeout(close, 900);
      }

      if (!res.body || !res.body.getReader) {
        return res.blob().then(finishBlob);
      }
      var reader = res.body.getReader();
      var chunks = [];
      var received = 0;
      function pump() {
        return reader.read().then(function (part) {
          if (cancelled) return;
          if (part.done) {
            finishBlob(new Blob(chunks, { type: 'application/zip' }));
            return;
          }
          chunks.push(part.value);
          received += part.value.length;
          // 服务端流式压缩没有 Content-Length 时用平滑曲线逼近，绝不提前到 100%。
          var value = total
            ? 8 + 87 * received / total
            : 8 + 84 * (1 - Math.exp(-received / (3 * 1024 * 1024)));
          progress(Math.min(95, value), received, tr('正在生成备份文件…'));
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      if (cancelled || (err && err.name === 'AbortError')) return;
      close();
      toast(err.message || tr('导出失败'));
    });
  }

  // 清空回收站：服务端逐篇独立事务 + NDJSON 进度流。取消只停止后续删除，
  // 已提交的删除保留，剩余笔记仍在回收站（这正是独立事务想要的效果）。
  function emptyTrashWithProgress() {
    var overlay = $('trashOverlay');
    var bar = $('trashBar');
    var stage = $('trashStage');
    var pctEl = $('trashPct');
    var metaEl = $('trashMeta');
    var cancelBtn = $('trashCancel');
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var cancelled = false, closed = false, finished = false, failed = false;
    var deleted = 0, total = 0;

    function close() {
      if (closed) return;
      closed = true;
      overlay.classList.remove('show');
      cancelBtn.removeEventListener('click', onCancel);
    }
    function progress(d, t, text) {
      deleted = d; total = t;
      var pct = finished ? 100 : (t > 0 ? Math.min(99, Math.round(d / t * 100)) : 0);
      bar.style.width = pct + '%';
      pctEl.textContent = pct + '%';
      metaEl.textContent = fmt('已清理 {0} / {1} 篇', d, t);
      if (text) stage.textContent = text;
    }
    function syncAfterTrash() {
      return refreshAll().then(function () { renderSettingsInfo(); }).catch(function () {});
    }
    function onCancel() {
      if (closed || finished) return;
      cancelled = true;
      if (controller) controller.abort();
      close();
      toast(fmt('已取消 · 已清理 {0} 篇，剩余 {1} 篇仍在回收站',
        deleted, Math.max(0, total - deleted)));
      // 服务端可能还在收尾当前这一篇，稍等再刷新列表。
      setTimeout(syncAfterTrash, 300);
    }
    function consume(line) {
      if (!line || !line.trim()) return;
      var p;
      try { p = JSON.parse(line); } catch (e) { return; }
      if (typeof p.total === 'number') total = p.total;
      if (typeof p.deleted === 'number') deleted = p.deleted;
      if (p.error) failed = true;
      if (p.done) finished = true;
      if (p.cancelled) cancelled = true;
      var text = p.error ? p.error
        : p.done ? tr('回收站已清空')
        : p.cancelled ? tr('已停止')
        : fmt('正在逐篇永久删除…（剩余 {0} 篇）',
          p.remaining == null ? Math.max(0, total - deleted) : p.remaining);
      progress(deleted, total, text);
    }
    function readStream(res) {
      if (!res.body || !res.body.getReader) {
        return res.text().then(function (text) { text.split('\n').forEach(consume); });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buf = '';
      function pump() {
        if (cancelled) return reader.cancel().catch(function () {});
        return reader.read().then(function (part) {
          if (cancelled) return;
          if (part.done) {
            if (buf.trim()) consume(buf);
            return;
          }
          buf += decoder.decode(part.value, { stream: true });
          var parts = buf.split('\n');
          buf = parts.pop();
          parts.forEach(consume);
          return pump();
        });
      }
      return pump();
    }

    overlay.classList.add('show');
    bar.classList.remove('done');
    cancelBtn.addEventListener('click', onCancel);
    progress(0, 0, tr('正在读取回收站…'));

    var init = { method: 'POST' };
    if (controller) init.signal = controller.signal;
    return fetch('/api/trash/empty-stream', init).then(function (res) {
      if (!res.ok) throw new Error(fmt('清空失败 {0}', res.status));
      return readStream(res);
    }).then(function () {
      if (cancelled) return;
      if (failed) {
        close();
        toast(tr('清空回收站失败'));
        return syncAfterTrash();
      }
      finished = true;
      progress(deleted, total || deleted, tr('回收站已清空'));
      bar.classList.add('done');
      toast(fmt('回收站已清空 · 共清理 {0} 篇', deleted));
      setTimeout(close, 700);
      return syncAfterTrash();
    }).catch(function (err) {
      if (cancelled || (err && err.name === 'AbortError')) return;
      close();
      toast(err.message || tr('清空回收站失败'));
      return syncAfterTrash();
    });
  }

  /* ------------------------------------------------------------ settings */

  function loadSettings(apply) {
    return api('/settings').then(function (res) {
      state.prefs = Object.assign({}, DEFAULT_PREFS, res.settings || {});
      if (apply !== false) i18n.applyPrefs(state.prefs);
      syncSettingControls();
      return state.prefs;
    }).catch(function () {
      // An older binary without /api/settings still runs with defaults.
      state.prefs = Object.assign({}, DEFAULT_PREFS);
      if (apply !== false) i18n.applyPrefs(state.prefs);
      syncSettingControls();
    });
  }

  function saveSetting(key, value) {
    var patch = {};
    patch[key] = value;
    return api('/settings', { method: 'PUT', body: patch }).then(function (res) {
      state.prefs = Object.assign({}, DEFAULT_PREFS, res.settings || {});
      if (key === 'theme') i18n.setTheme(value);
      else if (key === 'fontSize') i18n.setFontSize(value);
      else if (key === 'language') i18n.setLang(value); // fires ln:language -> refreshLanguage
      else if (key === 'showAiBadge') { renderList(); renderEditor(); }
      else if (key === 'editorMode') renderEditor();
      syncSettingControls();
      renderSettingsInfo();
      return state.prefs;
    }).catch(function (err) { toast(err.message); });
  }

  var settingControls = {
    language: 'setLanguage', editorMode: 'setEditorMode',
    fontSize: 'setFontSize', aiNotebook: 'setAiNotebook'
  };

  function syncSettingControls() {
    Object.keys(settingControls).forEach(function (key) {
      var el = $(settingControls[key]);
      if (el) el.value = state.prefs[key] || '';
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme-choice]'), function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === state.prefs.theme));
    });
    var badge = $('setAiBadge');
    if (badge) badge.checked = state.prefs.showAiBadge !== 'false';
  }

  function renderSettingsInfo() {
    var sys = state.system || {};
    $('setDbPath').textContent = sys.dbPath || '—';
    $('setStatus').textContent = sys.mcpUrl ? tr('运行中 · 本机监听') : tr('MCP 未连接');
    $('setEndpoint').textContent = sys.mcpUrl || '—';
    $('setProtocol').textContent = sys.protocolVersion || '2025-06-18';
    $('setToolCount').textContent = (sys.tools || []).length + tr(' 个工具');
    $('trashTotal').textContent = (state.stats && state.stats.trash || 0) + tr(' 篇笔记');
    window.LNReactUI.renderRegion($('settingsAbout'), i18n.aboutHTML(sys));

    var sel = $('setAiNotebook');
    var cur = state.prefs.aiNotebook || '';
    var names = state.notebooks.map(function (nb) { return nb.name; });
    if (cur && names.indexOf(cur) < 0) names.unshift(cur);
    window.LNReactUI.renderRegion(sel, '<option value="">' + tr('未指定（未分类）') + '</option>' +
      names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join(''));
    sel.value = cur;
  }

  function openSettings(tab) {
    if (hasUnsaved()) flushSave();
    closeDrawer();
    $('workspace').classList.remove('focus');
    setSettingsTab(tab || state.settingsTab || 'general');
    syncSettingControls();
    renderSettingsInfo();
    $('settingsPage').classList.remove('hidden');
    $('workspace').classList.add('settings-open');
    Array.prototype.forEach.call(document.querySelectorAll('.rail button'), function (button) {
      button.classList.toggle('active', button.id === 'settingsNav');
    });
    $('settingsTitle').setAttribute('tabindex', '-1');
    $('settingsTitle').focus();
  }
  function closeSettings() {
    var wasOpen = settingsOpen();
    $('settingsPage').classList.add('hidden');
    $('workspace').classList.remove('settings-open');
    $('settingsNav').classList.remove('active');
    renderLibrary();
    if (wasOpen) $('settingsNav').focus();
  }
  function settingsOpen() { return !$('settingsPage').classList.contains('hidden'); }

  function setSettingsTab(tab) {
    state.settingsTab = tab;
    Array.prototype.forEach.call($('settingsTabs').children, function (b) {
      b.classList.toggle('active', b.dataset.settingsTab === tab);
    });
    Array.prototype.forEach.call($('settingsPanels').children, function (p) {
      p.classList.toggle('hidden', p.dataset.panel !== tab);
    });
  }

  // Re-render every string that is produced at runtime when the language flips.
  function refreshLanguage() {
    i18n.apply(document);
    loadSystem();
    renderLibrary();
    renderList();
    renderEditor();
    renderSettingsInfo();
    syncSettingControls();
    if (state.tab === 'activity') loadActivity();
  }

  /* --------------------------------------------------------------- format */

  function dateLabel(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d)) return '';
    var now = new Date();
    // Compare local calendar dates, not elapsed 24-hour periods. Mapping each
    // local date to UTC midnight also avoids 23/25-hour daylight-saving days.
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var date = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    var days = Math.round((today - date) / DAY);
    var time = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (days === 0) return tr('今天 ') + time;
    if (days === 1) return tr('昨天') + ' ' + time;
    if (days < 0) return fullDate(ts);
    if (days < 7) return days + tr(' 天前');
    return (d.getMonth() + 1) + tr('月') + d.getDate() + tr('日');
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fullDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function scopeLabel() {
    var s = state.scope;
    if (s === 'all') return tr('全部笔记');
    if (s === 'pinned') return tr('置顶笔记');
    if (s === 'uncategorized') return tr('未分类');
    if (s === 'recent') return tr('最近编辑');
    if (s === 'ai') return tr('AI 写入');
    if (s === 'trash') return tr('回收站');
    if (s.indexOf('notebook:') === 0) {
      var nb = state.notebooks.filter(function (n) { return n.id === s.slice(9); })[0];
      return nb ? nb.name : tr('笔记本');
    }
    if (s.indexOf('tag:') === 0) return '#' + s.slice(4);
    return tr('笔记');
  }

  /* ---------------------------------------------------------------- load */

  function loadSystem() {
    return api('/system').then(function (sys) {
      state.system = sys;
      var pill = $('mcpStatus');
      if (sys && sys.mcpUrl) {
        pill.classList.remove('offline');
        $('mcpStatusText').textContent = tr('MCP 就绪 · ') + sys.tools.length + tr(' 个工具');
      } else {
        pill.classList.add('offline');
        $('mcpStatusText').textContent = tr('MCP 未连接');
      }
      $('footInfo').textContent = tr('本地明文存储 · ') + (sys.dbPath || '') + ' · ' + sys.tools.length + tr(' 个 MCP 工具');
      renderDrawerContent();
    }).catch(function () {
      $('mcpStatus').classList.add('offline');
      $('mcpStatusText').textContent = tr('MCP 未连接');
    });
  }

  function loadStats() {
    return api('/stats').then(function (st) {
      state.stats = st;
      renderLibrary();
    }).catch(function () {});
  }

  function loadMeta() {
    return Promise.all([api('/notebooks'), api('/tags')]).then(function (res) {
      state.notebooks = res[0].notebooks || [];
      state.tags = res[1].tags || [];
      renderLibrary();
    });
  }

  function listQuery(offset) {
    var p = new URLSearchParams();
    var s = state.scope;
    if (s.indexOf('notebook:') === 0) { p.set('scope', 'notebook'); p.set('notebook', s.slice(9)); }
    else if (s.indexOf('tag:') === 0) { p.set('scope', 'tag'); p.set('tag', s.slice(4)); }
    else p.set('scope', s);
    p.set('sort', state.sort);
    p.set('limit', String(PAGE_SIZE));
    if (offset) p.set('offset', String(offset));
    if (state.query) p.set('q', state.query);
    return p.toString();
  }

  function listKey() {
    return [state.scope, state.query, state.sort].join('\u0001');
  }

  function loadNotes(opts) {
    opts = opts || {};
    var token = ++state.listToken;
    var key = listKey();
    // 换分类/搜索/排序时回到顶部；普通的后台刷新保留阅读位置。
    var resetScroll = key !== state.listKey;
    if (resetScroll) keyboardIndex = -1;
    state.listKey = key;
    var previousScroll = resetScroll ? 0 : $('rows').scrollTop;
    state.loading = true;
    state.loadingMore = false;
    return api('/notes?' + listQuery(0)).then(function (res) {
      if (token !== state.listToken) return res; // 过滤条件已变化，丢弃过期响应
      state.notes = res.notes || [];
      state.total = res.total || 0;
      state.hasMore = state.notes.length < state.total;
      state.loading = false;
      renderList(previousScroll);
      if (!opts.keepSelection) {
        var stillThere = state.notes.some(function (n) { return n.id === state.selectedId; });
        if (!stillThere) {
          if (state.notes.length) selectNote(state.notes[0].id, { read: !state.note });
          else { state.selectedId = null; state.note = null; renderEditor(); }
        }
      }
      ensureFilled();
      return res;
    }).catch(function (err) {
      state.loading = false;
      toast(err.message);
    });
  }

  // 滚动接近底部时追加下一批；同一时刻只允许一个请求，且按 id 去重。
  function loadMoreNotes() {
    if (state.loading || state.loadingMore || !state.hasMore) return Promise.resolve(0);
    var token = state.listToken;
    var offset = state.notes.length;
    var scroll = $('rows').scrollTop;
    state.loadingMore = true;
    renderList();
    $('rows').scrollTop = scroll;
    return api('/notes?' + listQuery(offset)).then(function (res) {
      if (token !== state.listToken) return 0;
      state.loadingMore = false;
      var seen = Object.create(null);
      state.notes.forEach(function (n) { seen[n.id] = 1; });
      var added = 0;
      (res.notes || []).forEach(function (n) {
        if (!seen[n.id]) { seen[n.id] = 1; state.notes.push(n); added++; }
      });
      state.total = res.total || state.total;
      state.hasMore = added > 0 && state.notes.length < state.total;
      var keep = $('rows').scrollTop;
      renderList(keep);
      return added;
    }).catch(function (err) {
      if (token !== state.listToken) return 0;
      state.loadingMore = false;
      renderList();
      toast(err.message);
      return 0;
    });
  }

  // 首屏内容不足以撑满列表时自动补几批，避免滚动条不出现导致无法继续加载。
  function ensureFilled() {
    var rows = $('rows');
    if (!rows || !state.hasMore || state.loading || state.loadingMore) return;
    if (rows.scrollHeight > rows.clientHeight + LOAD_AHEAD) return;
    loadMoreNotes().then(function (added) {
      if (added) setTimeout(ensureFilled, 0);
    });
  }

  function refreshAll(opts) {
    opts = opts || {};
    var boot = !!opts.boot;
    if (boot) bootStep(36, tr('正在加载分类与标签…'));
    var tasks = [
      loadMeta().then(function () { if (boot) bootStep(52, tr('分类与标签已就绪')); }),
      loadNotes(opts).then(function () { if (boot) bootStep(76, tr('笔记已加载')); }),
      loadStats().then(function () { if (boot) bootStep(90, tr('正在整理统计…')); })
    ];
    return Promise.all(tasks).catch(function () {});
  }

  /* ------------------------------------------------------------- library */

  function navRow(scope, name, symbol, count, extraClass, attrs) {
    return '<button class="navrow ' + (state.scope === scope ? 'active' : '') + ' ' + (extraClass || '') + '" data-scope="' + esc(scope) + '" ' + (attrs || '') + '>' +
      symbol + '<span title="' + esc(name) + '">' + esc(clampChars(name, NAV_LABEL_CHARS)) + '</span>' +
      '<span class="count">' + (count == null ? '' : count) + '</span></button>';
  }

  function sidebarMore(kind, shown, total) {
    if (shown >= total) return '';
    return '<button class="list-more" data-sidebar-more="' + kind + '">' +
      esc(fmt('显示更多 · 已显示 {0} / {1}', shown, total)) + '</button>';
  }

  // 侧栏分批：滚动到底部或点击「显示更多」时再追加一批，避免首屏塞进几千个节点。
  function growSidebar(kind) {
    var lib = document.querySelector('.library');
    var scroll = lib ? lib.scrollTop : 0;
    var before = kind === 'tags' ? state.tagLimit : state.folderLimit;
    if (kind === 'tags') state.tagLimit = Math.min(state.tags.length, state.tagLimit + SIDEBAR_PAGE);
    else state.folderLimit = Math.min(state.notebooks.length, state.folderLimit + SIDEBAR_PAGE);
    var after = kind === 'tags' ? state.tagLimit : state.folderLimit;
    if (after === before) return false;
    renderLibrary();
    if (lib) lib.scrollTop = scroll;
    return true;
  }

  function renderLibrary() {
    var st = state.stats || {};
    var uncat = 0;
    (st.byNotebook || []).forEach(function (b) { if (b.label === '未分类') uncat = b.count; });

    // 当前选中的分类/标签即使排在后面也要渲染出来，否则高亮会丢失。
    if (state.scope.indexOf('notebook:') === 0) {
      var nbIdx = state.notebooks.findIndex(function (n) { return n.id === state.scope.slice(9); });
      if (nbIdx >= state.folderLimit) state.folderLimit = nbIdx + 1;
    }
    if (state.scope.indexOf('tag:') === 0) {
      var tagName = state.scope.slice(4);
      var tagIdx = state.tags.findIndex(function (t) { return t.name === tagName; });
      if (tagIdx >= state.tagLimit) state.tagLimit = tagIdx + 1;
    }

    window.LNReactUI.renderRegion($('smartNav'), navRow('all', tr('全部笔记'), icon('note'), st.notes == null ? state.total : st.notes) +
      navRow('pinned', tr('置顶笔记'), icon('pin'), st.pinned || 0) +
      navRow('uncategorized', tr('未分类'), icon('folder'), uncat) +
      navRow('ai', tr('AI 写入'), icon('sparkles'), st.fromAi || 0));

    var shownFolders = state.notebooks.slice(0, state.folderLimit);
    window.LNReactUI.renderRegion($('folders'), (shownFolders.map(function (nb) {
      var glyph = nb.pinned ? icon('pin') : icon(nb.icon === 'inbox' ? 'folder' : 'book');
      return navRow('notebook:' + nb.id, nb.name, glyph, nb.count, '',
        'data-kind="notebook" data-ref="' + esc(nb.id) + tr('" title="右击可置顶、改名或删除"'));
    }).join('') || tr('<div class="empty" style="padding:10px 12px;text-align:left;font-size:11.5px">还没有笔记本</div>')) +
      sidebarMore('folders', shownFolders.length, state.notebooks.length));

    var shownTags = state.tags.slice(0, state.tagLimit);
    window.LNReactUI.renderRegion($('tags'), (shownTags.map(function (t) {
      var glyph = t.pinned
        ? '<svg class="pinmark" aria-hidden="true" style="color:' + esc(t.color || '#b2a0c7') + '"><use href="#i-pin"/></svg>'
        : '<span class="dot" style="background:' + esc(t.color || '#b2a0c7') + '"></span>';
      return '<button class="navrow ' + (state.scope === 'tag:' + t.name ? 'active' : '') + '" data-scope="tag:' + esc(t.name) + '" ' +
        'data-kind="tag" data-ref="' + esc(t.id) + tr('" title="右击可置顶、改名或删除">') +
        glyph + '<span title="' + esc(t.name) + '">' + esc(clampChars(t.name, NAV_LABEL_CHARS)) +
        '</span><span class="count">' + t.count + '</span></button>';
    }).join('') || tr('<div class="empty" style="padding:10px 12px;text-align:left;font-size:11.5px">还没有标签，点 ＋ 新建一个</div>')) +
      sidebarMore('tags', shownTags.length, state.tags.length));

    var trashBtn = document.querySelector('[data-scope="trash"]');
    if (trashBtn) trashBtn.classList.toggle('active', state.scope === 'trash');
    $('trashCount').textContent = st.trash || 0;

    $('searchNav').classList.toggle('active', state.searchActive && !settingsOpen());
    $('notesNav').classList.toggle('active', !state.searchActive && ['all', 'pinned', 'uncategorized', 'trash'].indexOf(state.scope) >= 0 && !settingsOpen());
    $('recentNav').classList.toggle('active', !state.searchActive && state.scope === 'recent' && !settingsOpen());
    $('aiNav').classList.toggle('active', !state.searchActive && state.scope === 'ai' && !settingsOpen());

    var opts = tr('<option value="">移动到…</option><option value="__none">未分类</option>') +
      state.notebooks.map(function (nb) {
        return '<option value="' + esc(nb.id) + '" title="' + esc(nb.name) + '">' +
          esc(clampChars(nb.name, NAV_LABEL_CHARS)) + '</option>';
      }).join('');
    window.LNReactUI.renderRegion($('batchMove'), opts);
  }

  /* ---------------------------------------------------------------- list */

  function noteRow(n) {
    var checked = state.chosen.has(n.id) ? 'checked' : '';
    var tags = (n.tags || []).slice(0, 2).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
    var ai = (n.source !== 'web' && !(n.source || '').startsWith('plugin:') && state.prefs.showAiBadge !== 'false')
      ? '<span class="badge-ai">' + icon('sparkles') + 'AI</span>' : '';
    return '<div class="note ' + (state.selectedId === n.id ? 'active' : '') + '" role="button" tabindex="0" data-id="' + esc(n.id) + tr('" title="右击可置顶、移动或删除">') +
      '<div class="notetitle">' +
      (state.multi ? '<input type="checkbox" tabindex="-1" ' + checked + tr(' aria-label="选择">') : '') +
      (n.pinned ? icon('pin') : '') +
      '<span class="t" title="' + esc(n.title || tr('未命名笔记')) + '">' +
      esc(clampChars(n.title || tr('未命名笔记'), NOTE_TITLE_CHARS)) + '</span>' + ai +
      '</div>' +
      '<div class="excerpt">' + esc(n.excerpt || tr('还没有内容，写下第一个想法吧')) + '</div>' +
      '<div class="meta"><span>' + esc(n.notebook || tr('未分类')) + '</span>' + tags +
      '<time>' + esc(dateLabel(n.updatedAt)) + '</time></div>' +
      '</div>';
  }

  var virtualModel = window.LNListPerformance.createModel([]);
  var listFrame = null;
  var listWindowKey = null;
  var keyboardIndex = -1;

  function renderList(scrollTarget) {
    listWindowKey = null;
    $('listTitle').textContent = scopeLabel();
    var subtitle = state.total + tr(' 篇笔记');
    if (state.scope === 'recent') subtitle += tr(' · 最近 30 天');
    if (state.query) subtitle += tr(' · 匹配「') + state.query + tr('」');
    if (state.loading) subtitle = tr('加载中…');
    $('listSubtitle').textContent = subtitle;

    $('batch').classList.toggle('hidden', !state.multi);
    $('batchToggle').textContent = state.multi ? tr('完成') : tr('多选');
    $('selectionCount').textContent = tr('已选 ') + state.chosen.size + tr(' 篇');
    $('batchDelete').textContent = state.scope === 'trash' ? tr('恢复') : tr('删除');

    if (!state.notes.length) {
      virtualModel = window.LNListPerformance.createModel([]);
      keyboardIndex = -1;
      var msg;
      if (state.query) msg = tr('没有匹配的笔记<br>试试其他关键词，或切换到全部笔记。');
      else if (state.scope === 'trash') msg = tr('回收站是空的');
      else if (state.scope === 'ai') msg = tr('还没有 AI 写入的笔记<br>在 AI 客户端里让它保存一篇文档试试。');
      else if (state.scope === 'recent') msg = tr('最近 30 天还没有编辑记录');
      else msg = tr('这里还没有笔记<br>点击右上方「新建笔记」开始，或让 AI 写入。');
      window.LNReactUI.renderRegion($('rows'), '<div class="empty">' + msg + '</div>');
      return;
    }

    virtualModel = window.LNListPerformance.createModel(state.notes);
    renderListWindow(typeof scrollTarget === 'number' ? scrollTarget : $('rows').scrollTop);
  }

  function renderListWindow(scrollTarget) {
    if (!state.notes.length) return;
    var rows = $('rows');
    var top = typeof scrollTarget === 'number' ? scrollTarget : rows.scrollTop;
    var view = virtualModel.window(Math.max(0, top - 7), rows.clientHeight);
    var key = view.before + ':' + view.after + ':' + keyboardIndex + ':' + new Date().toDateString();
    if (key === listWindowKey) return;
    listWindowKey = key;
    var html = '<div class="virtual-spacer" aria-hidden="true" style="height:' + view.before + 'px"></div>';
    html += view.items.map(function (item) {
      if (item.kind === 'note') return noteRow(item.note);
      var label = item.name === 'pinned' ? tr('置顶') : item.name === 'others' ? tr('其他笔记') : tr('笔记');
      return '<div class="group">' + esc(label) + ' · ' + item.count + '</div>';
    }).join('');
    html += '<div class="virtual-spacer" aria-hidden="true" style="height:' + view.after + 'px"></div>' + listMoreMarkup();
    var focused = document.activeElement;
    var focusedId = focused && focused.matches('.note[data-id]') ? focused.dataset.id : null;
    window.LNReactUI.renderRegion(rows, html);
    rows.scrollTop = top;
    Array.prototype.forEach.call(rows.querySelectorAll('.note[data-id]'), function (row) {
      var keyNote = virtualModel.notes[keyboardIndex];
      row.classList.toggle('keyboard-active', !!keyNote && keyNote.id === row.dataset.id);
      if (focusedId === row.dataset.id) row.focus({ preventScroll: true });
    });
  }

  function queueListWindow() {
    if (listFrame !== null) return;
    listFrame = requestAnimationFrame(function () {
      listFrame = null;
      renderListWindow();
    });
  }

  function listMoreMarkup() {
    if (state.hasMore) {
      if (state.loadingMore) {
        return '<div class="list-more busy" id="listMore"><span class="spin"></span>' +
          tr('正在加载更多笔记…') + '</div>';
      }
      return '<div class="list-more" id="listMore">' +
        esc(fmt('已加载 {0} / {1} 篇 · 向下滚动或点击继续加载', state.notes.length, state.total)) +
        '</div>';
    }
    if (state.notes.length >= PAGE_SIZE) {
      return '<div class="list-more done" id="listMore">' +
        esc(fmt('已全部加载 · {0} 篇', state.total)) + '</div>';
    }
    return '';
  }

  /* -------------------------------------------------------------- editor */

  var sessionDrafts = new Set();
  function discardSessionDraft(exceptId) {
    var note = state.note;
    if (!note || note.id === exceptId || !sessionDrafts.has(note.id) || hasUnsaved()) return;
    if (window.LNHasPendingNoteChange && window.LNHasPendingNoteChange(note.id)) return;
    sessionDrafts.delete(note.id);
    if (note.title === '未命名笔记' && !note.content.trim() && !(note.tags || []).length && !note.pinned && note.version === 1) {
      return api('/notes/' + note.id + '/discard-placeholder', { method:'POST' }).then(function () { state.notes = state.notes.filter(function (item) { return item.id !== note.id; }); renderList(); loadMeta(); loadStats(); }).catch(function () {});
    }
  }
  function selectNote(id, opts) {
    closeTagPicker();
    if (saveInFlight || hasUnsaved()) return savedThen(function () { selectNote(id, opts); });
    discardSessionDraft(id);
    state.selectedId = id;
    state.preview = false;
    renderList();
    return api('/notes/' + encodeURIComponent(id)).then(function (note) {
      state.note = note;
      // 默认视图可在设置里改：auto = AI 笔记/首屏用阅读，edit/preview 强制。
      var mode = state.prefs.editorMode || 'auto';
      if (mode === 'preview') state.preview = true;
      else if (mode === 'edit') state.preview = false;
      else state.preview = (opts && opts.read) || (note.source !== 'web' && !(note.source || '').startsWith('plugin:'));
      renderEditor();
      renderLibrary();
    }).catch(function (err) {
      toast(err.message);
    });
  }

  function renderEditor() {
    var n = state.note;
    var has = !!n && n.id === state.selectedId;
    $('doc').classList.toggle('hidden', !has);
    $('editorEmpty').classList.toggle('hidden', has);
    $('formatbar').style.visibility = has ? 'visible' : 'hidden';
    $('pinNote').classList.toggle('on', !!(has && n.pinned));
    var deleteLabel = has && n.deletedAt ? tr('彻底删除') : tr('移到回收站');
    $('deleteNote').title = deleteLabel;
    $('deleteNote').setAttribute('aria-label', deleteLabel);
    $('deleteNote').setAttribute('data-i18n-title', has && n.deletedAt ? '彻底删除' : '移到回收站');
    $('deleteNote').setAttribute('data-i18n-aria', has && n.deletedAt ? '彻底删除' : '移到回收站');

    if (!has) {
      $('crumbTitle').textContent = '';
      $('crumb').textContent = scopeLabel();
      $('wordCount').textContent = '';
      $('docId').textContent = '';
      $('saveState').textContent = '';
      $('editorScrollbar').classList.add('hidden');
      $('document').scrollTop = 0;
      pluginEvent('note:selection', null);
      return;
    }

    $('docTitle').value = n.title || '';
    $('docBody').value = n.content || '';
    $('crumb').textContent = n.notebook || tr('未分类');
    $('crumbTitle').textContent = n.title || tr('未命名笔记');
    $('docNotebook').textContent = n.notebook || tr('未分类');
    $('docDate').textContent = dateLabel(n.updatedAt) + tr(' 编辑');
    $('docId').textContent = n.id;

    renderNoteTags();

    var isAI = n.source !== 'web' && !(n.source || '').startsWith('plugin:');
    $('docAi').classList.toggle('hidden', !isAI || state.prefs.showAiBadge === 'false');
    if (isAI) {
      window.LNReactUI.renderRegion($('docAi'), icon('sparkles') + 'AI' + (n.author ? ' · ' + esc(n.author) : ''));
    }

    var readOnly = !!n.deletedAt;
    $('docTitle').readOnly = readOnly;
    $('docBody').readOnly = readOnly;

    applyMode();
    autosize($('docTitle'));
    autosize($('docBody'));
    queueEditorScrollbarSync();
    updateWordCount();
    $('saveState').textContent = readOnly ? tr('回收站内只读') : (state.note ? tr('已保存 · ') + dateLabel(n.updatedAt) : '');
    pluginEvent('note:selection', currentPluginNote());
  }

  function applyMode() {
    var preview = state.preview;
    $('editMode').classList.toggle('active', !preview);
    $('previewMode').classList.toggle('active', preview);
    $('docBody').classList.toggle('hidden', preview);
    $('preview').classList.toggle('hidden', !preview);
    $('formatbar').classList.toggle('previewing', preview);
    if (preview && state.note) {
      window.LNReactUI.renderRegion($('preview'), md.render(state.note.content || ''));
      window.LNDiagrams.render($('preview'));
    } else {
      // 从预览切回编辑时，输入框刚恢复可见，需要按真实宽度重新计算高度。
      autosize($('docBody'));
    }
    queueEditorScrollbarSync();
  }

  function autosize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, el.classList.contains('doctitle') ? 40 : 300) + 'px';
  }

  var editorScrollFrame = 0;

  function syncEditorScrollbar() {
    var scroller = $('document');
    var bar = $('editorScrollbar');
    var thumb = $('editorScrollThumb');
    if (!scroller || !bar || !thumb) return;

    var maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (maxScroll <= 1) {
      bar.classList.add('hidden');
      return;
    }

    bar.classList.remove('hidden');
    var trackHeight = bar.clientHeight;
    if (!trackHeight) return;

    var thumbHeight = Math.max(32, Math.round(trackHeight * scroller.clientHeight / scroller.scrollHeight));
    var range = Math.max(0, trackHeight - thumbHeight);
    var offset = range ? Math.round(range * scroller.scrollTop / maxScroll) : 0;
    thumb.style.height = thumbHeight + 'px';
    thumb.style.transform = 'translateY(' + offset + 'px)';
  }

  function queueEditorScrollbarSync() {
    if (editorScrollFrame) return;
    editorScrollFrame = window.requestAnimationFrame(function () {
      editorScrollFrame = 0;
      syncEditorScrollbar();
    });
  }

  function updateWordCount() {
    var text = (state.note && state.note.content) || '';
    var chars = text.replace(/\s/g, '').length;
    var mode = state.scope === 'trash' ? tr('回收站内只读') : state.preview ? tr('阅读模式') : tr('编辑模式');
    $('wordCount').textContent = chars + tr(' 字 · ') + mode;
  }

  var savingNoteTags = false;

  function closeTagPicker() {
    $('noteTagPicker').classList.add('hidden');
    $('addNoteTag').setAttribute('aria-expanded', 'false');
  }

  function renderNoteTags() {
    var note = state.note;
    if (!note) return;
    var readOnly = !!note.deletedAt;
    $('noteTagControl').classList.toggle('hidden', readOnly);
    if (readOnly) closeTagPicker();
    $('addNoteTag').disabled = savingNoteTags;
    window.LNReactUI.renderRegion($('docTags'), (note.tags || []).map(function (name) {
      return '<span class="tag"># ' + esc(name) + (readOnly ? '' :
        '<button type="button" data-remove-note-tag="' + esc(name) + '" aria-label="' + esc(tr('移除标签') + ' ' + name) + '"' +
        (savingNoteTags ? ' disabled' : '') + '>×</button>') + '</span>';
    }).join(''));
    renderTagOptions();
  }

  function renderTagOptions() {
    var query = $('noteTagSearch').value.trim();
    var selected = state.note && state.note.tags || [];
    var names = state.tags.map(function (tag) { return tag.name; });
    selected.forEach(function (name) { if (names.indexOf(name) < 0) names.push(name); });
    var filtered = names.filter(function (name) { return name.toLowerCase().indexOf(query.toLowerCase()) >= 0; });
    var exact = names.some(function (name) { return name.toLowerCase() === query.toLowerCase(); });
    var options = filtered.map(function (name) {
      var checked = selected.indexOf(name) >= 0;
      return '<button type="button" data-toggle-note-tag="' + esc(name) + '" aria-pressed="' + checked + '"' +
        (savingNoteTags ? ' disabled' : '') + '><span># ' + esc(name) + '</span><span aria-hidden="true">' + (checked ? '✓' : '+') + '</span></button>';
    });
    if (query && !exact) options.push('<button type="button" data-toggle-note-tag="' + esc(query) + '"' +
      (savingNoteTags ? ' disabled' : '') + '>' + esc(tr('创建标签：') + query) + '</button>');
    window.LNReactUI.renderRegion($('noteTagOptions'), options.join('') || '<span class="note-tag-hint">' + esc(tr('暂无标签，输入名称即可创建。')) + '</span>');
  }

  function toggleNoteTag(name) {
    var note = state.note;
    if (!note || note.deletedAt || savingNoteTags) return;
    name = name.trim();
    if (!name || name.length > 80) return;
    var tags = (note.tags || []).slice();
    var index = tags.indexOf(name);
    if (index < 0) tags.push(name);
    else tags.splice(index, 1);
    savingNoteTags = true;
    renderNoteTags();
    // Flush pending text before changing metadata; never replace the editor DOM.
    flushSave().then(function () {
      return api('/notes/' + note.id, { method: 'PATCH', body: { tags: tags } });
    }).then(function (updated) {
      if (state.note && state.note.id === note.id) {
        state.note.tags = updated.tags;
        state.note.updatedAt = updated.updatedAt;
        state.note.version = updated.version;
      }
      var row = state.notes.find(function (item) { return item.id === note.id; });
      if (row) row.tags = updated.tags;
      $('noteTagSearch').value = '';
      renderList();
      return loadMeta();
    }).catch(function (err) { toast(err.message); }).then(function () {
      savingNoteTags = false;
      renderNoteTags();
    });
  }

  /* ---------------------------------------------------------------- save */

  function hasUnsaved() {
    if (!state.note || state.note.deletedAt) return false;
    return state.note.title !== $('docTitle').value || state.note.content !== $('docBody').value;
  }

  function scheduleSave() {
    if (!state.note || state.note.deletedAt) return;
    $('saveState').textContent = tr('未保存…');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () { flushSave().catch(function () {}); }, 650);
  }

  var saveInFlight = null;
  var historyWriteInFlight = null;
  var pendingPluginSource = null;
  function flushSave() {
    if (historyWriteInFlight) return historyWriteInFlight.then(flushSave, flushSave);
    if (saveInFlight) return saveInFlight.then(function () { return flushSave(); });
    saveInFlight = performSave().then(function () { saveInFlight = null; }, function (err) { saveInFlight = null; throw err; });
    return saveInFlight;
  }
  function savedThen(action) {
    return flushSave().then(function () { if (hasUnsaved()) return savedThen(action); return action(); }).catch(function () {});
  }
  function performSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    var n = state.note;
    if (!n || n.deletedAt) return Promise.resolve();
    var title = $('docTitle').value;
    var content = $('docBody').value;
    if (title === n.title && content === n.content) { pendingPluginSource = null; return Promise.resolve(); }

    state.lastLocalEdit = Date.now();
    $('saveState').textContent = tr('保存中…');

    var pluginEdit = pendingPluginSource;
    if (pluginEdit && pluginEdit.noteId !== n.id) return Promise.reject(new Error('插件编辑所属笔记已变化，请先处理保存冲突'));
    var pluginSource = pluginEdit && pluginEdit.pluginId;
    var operation = pluginSource
      ? pluginRequest(pluginSource, '/notes/' + encodeURIComponent(n.id), 'PATCH', { title: title, content: content, expectedVersion: pluginEdit.expectedVersion })
      : api('/notes/' + n.id, { method: 'PATCH', body: { title: title, content: content } });
    return operation
      .then(function (updated) {
        if (pendingPluginSource === pluginEdit) pendingPluginSource = null;
        if (!state.note || state.note.id !== n.id) return;
        state.note = updated;
        n.title = updated.title;
        n.content = updated.content;
        n.updatedAt = updated.updatedAt;
        n.excerpt = updated.excerpt;
        n.tags = updated.tags;
        n.notebook = updated.notebook;
        $('crumbTitle').textContent = updated.title;
        if ($('docTitle').value === title) $('docTitle').value = updated.title;
        $('saveState').textContent = tr('已保存 · ') + dateLabel(updated.updatedAt);
        updateWordCount();
        pluginEvent('note:change', { note: updated, source: updated.source, pluginId: pluginSource || undefined });
        // patch the row in place instead of a full reload
        var idx = state.notes.findIndex(function (x) { return x.id === updated.id; });
        if (idx >= 0) { state.notes[idx] = Object.assign({}, state.notes[idx], {
          title: updated.title, excerpt: updated.excerpt, updatedAt: updated.updatedAt, tags: updated.tags, notebook: updated.notebook
        }); }
        renderList();
      })
      .catch(function (err) {
        $('saveState').textContent = tr('保存失败');
        toast(tr('保存失败：') + err.message);
        throw err;
      });
  }

  /* ------------------------------------------------------------- actions */

  function newNote() {
    if (saveInFlight || hasUnsaved()) return savedThen(newNote);
    discardSessionDraft();
    closeSettings();
    var body = { title: '', content: '', tags: [] };
    if (state.scope.indexOf('notebook:') === 0) body.notebookId = state.scope.slice(9);
    if (state.scope.indexOf('tag:') === 0) body.tags = [state.scope.slice(4)];
    api('/notes', { method: 'POST', body: body }).then(function (note) {
      sessionDrafts.add(note.id);
      state.scope = body.notebookId ? state.scope : (state.scope === 'trash' ? 'all' : state.scope);
      state.query = '';
      $('search').value = '';
      state.multi = false;
      state.chosen.clear();
      state.selectedId = note.id;
      state.note = note;
      state.preview = false;
      return refreshAll({ keepSelection: true }).then(function () {
        renderEditor();
        $('docTitle').focus();
        toast(tr('已新建笔记') + (note.notebook ? ' · ' + note.notebook : ''));
      });
    }).catch(function (err) { toast(err.message); });
  }

  function deleteOrRestore(ids) {
    if (!ids.length) { toast(tr('请先选择笔记')); return; }
    var restoring = state.scope === 'trash';
    var jobs = ids.map(function (id) {
      if (restoring) return api('/notes/' + id + '/restore', { method: 'POST' });
      return api('/notes/' + id, { method: 'DELETE' });
    });
    Promise.all(jobs).then(function () {
      state.chosen.clear();
      state.multi = false;
      toast(restoring ? tr('已恢复 ') + ids.length + tr(' 篇笔记') : tr('已移到回收站，可前往恢复'), restoring ? {} : { ms: 8000, undo: ids.slice() });
      return refreshAll();
    }).catch(function (err) { toast(err.message); });
  }

  function togglePin() {
    var n = state.note;
    if (!n) return;
    api('/notes/' + n.id, { method: 'PATCH', body: { pinned: !n.pinned } }).then(function (updated) {
      state.note = updated;
      renderEditor();
      toast(updated.pinned ? tr('已置顶') : tr('已取消置顶'));
      return refreshAll({ keepSelection: true });
    }).catch(function (err) { toast(err.message); });
  }

  function insertMarkdown(kind) {
    if (!state.note || state.note.deletedAt) { toast(tr('请先选择一篇笔记')); return; }
    if (state.preview) { state.preview = false; applyMode(); }
    var ta = $('docBody');
    var start = ta.selectionStart, end = ta.selectionEnd;
    var value = ta.value;
    var selected = value.slice(start, end);
    var before = value.slice(0, start), after = value.slice(end);
    var block = { h2: '## ', bold: '**', italic: '*', ul: '- ', ol: '1. ', quote: '> ', code: '```\n', link: '[', table: '', hr: '' };
    var text = '';

    switch (kind) {
      case 'h2': text = '## ' + (selected || tr('新的小标题')) + '\n'; break;
      case 'bold': text = '**' + (selected || tr('重点内容')) + '**'; break;
      case 'italic': text = '*' + (selected || tr('强调')) + '*'; break;
      case 'ul': text = '- ' + (selected || tr('要点')) + '\n'; break;
      case 'ol': text = '1. ' + (selected || tr('步骤')) + '\n'; break;
      case 'quote': text = '> ' + (selected || tr('值得记住的一句话')) + '\n'; break;
      case 'code': text = '```\n' + (selected || '// code') + '\n```\n'; break;
      case 'link': text = '[' + (selected || tr('链接文字')) + '](https://)'; break;
      case 'table': text = tr('| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n'); break;
      case 'hr': text = '\n---\n'; break;
      default: return;
    }
    void block;
    ta.value = before + text + after;
    ta.focus();
    ta.selectionStart = ta.selectionEnd = before.length + text.length;
    autosize(ta);
    queueEditorScrollbarSync();
    scheduleSave();
  }

  /* --------------------------------------------------------------- drawer */

  function openDrawer(tab) {
    if (tab) setTab(tab);
    $('drawer').classList.add('show');
    $('drawerOverlay').classList.add('show');
    if (tab === 'activity') loadActivity();
  }
  function closeDrawer() {
    $('drawer').classList.remove('show');
    $('drawerOverlay').classList.remove('show');
  }

  function setTab(tab) {
    state.tab = tab;
    Array.prototype.forEach.call($('drawerTabs').children, function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    ['connect', 'tools', 'activity'].forEach(function (t) {
      $('panel-' + t).classList.toggle('hidden', t !== tab);
    });
    if (tab === 'activity') loadActivity();
  }

  function renderDrawerContent() {
    var sys = state.system;
    if (!sys) return;
    window.LNReactUI.renderRegion($('endpointBox'), esc(sys.mcpUrl) + tr('<button class="copy" data-copy="endpoint">复制</button>'));
    var token = sys.defaultToken || tr('(未生成)');
    window.LNReactUI.renderRegion($('tokenBox'), esc(token) + tr('<button class="copy" data-copy="token">复制</button>'));
    renderClientBox();
    renderTools();
  }

  function clientSnippet() {
    var sys = state.system || {};
    var url = sys.mcpUrl || 'http://127.0.0.1:7420/mcp';
    var token = sys.defaultToken || '<your-token>';
    switch (state.client) {
      case 'claude':
        return {
          text: 'claude mcp add --transport http locknote ' + url + ' \\\n  --header "Authorization: Bearer ' + token + '"',
          hint: tr('在终端执行一次即可。之后在 Claude Code 里说「把这份方案存到 Locknote」就会调用它。')
        };
      case 'desktop':
        return {
          text: JSON.stringify({
            mcpServers: {
              locknote: {
                command: 'locknote-mcp',
                args: ['stdio'],
                env: { LOCKNOTE_MCP_HOME: sys.dbPath ? sys.dbPath.replace(/\/[^/]+$/, '') : '~/.locknote-mcp' }
              }
            }
          }, null, 2),
          hint: tr('Claude Desktop 通过本地进程调用（stdio），需要 locknote-mcp 在 PATH 中。配置后重启客户端。')
        };
      case 'codex':
        return {
          text: '[mcp_servers.locknote]\nurl = ' + JSON.stringify(url) +
            '\n\n[mcp_servers.locknote.http_headers]\nAuthorization = ' + JSON.stringify('Bearer ' + token),
          hint: tr('将此配置加入 ~/.codex/config.toml，然后重新连接 Codex。')
        };
      default:
        return {
          text: JSON.stringify({
            mcpServers: {
              locknote: { type: 'streamable-http', url: url, headers: { Authorization: 'Bearer ' + token } }
            }
          }, null, 2),
          hint: tr('适用于任何支持 Streamable HTTP 的 MCP 客户端：填入 URL 与 Bearer 令牌即可。')
        };
    }
  }

  function renderClientBox() {
    var s = clientSnippet();
    window.LNReactUI.renderRegion($('clientBox'), esc(s.text) + tr('<button class="copy" data-copy="client">复制</button>'));
    $('clientHint').textContent = s.hint;
  }

  function renderTools() {
    var sys = state.system;
    if (!sys) return;
    var en = i18n.lang === 'en-US';
    var text = function (obj, field) {
      return en ? (obj[field + 'En'] || obj[field] || '') : (obj[field] || '');
    };
    $('toolCount').textContent = sys.tools.length + tr(' 个工具');
    window.LNReactUI.renderRegion($('toolList'), sys.tools.map(function (t) {
      return '<div class="tool-item"><div class="name">' + esc(t.name) +
        '<span class="tool-title">' + esc(text(t, 'title')) + '</span>' +
        (t.readOnly ? tr('<span class="ro">只读</span>') : '') + '</div>' +
        '<div class="desc">' + esc(text(t, 'description')) + '</div></div>';
    }).join(''));
    window.LNReactUI.renderRegion($('resourceList'), (sys.resources || []).map(function (r) {
      return '<div class="tool-item"><div class="name">' + esc(r.uriTemplate) + '</div>' +
        '<div class="desc">' + esc(text(r, 'description')) + '</div></div>';
    }).join(''));
    window.LNReactUI.renderRegion($('promptList'), (sys.prompts || []).map(function (p) {
      return '<div class="tool-item"><div class="name">' + esc(p.name) +
        '<span class="tool-title">' + esc(text(p, 'title')) + '</span></div>' +
        '<div class="desc">' + esc(text(p, 'description')) + '</div></div>';
    }).join(''));
  }

  function loadActivity() {
    api('/activity?limit=40').then(function (res) {
      var items = res.activity || [];
      window.LNReactUI.renderRegion($('activityList'), items.length ? items.map(function (a) {
        var isWeb = a.actor === 'web';
        return '<div class="activity-item"><span class="who ' + (isWeb ? 'web' : '') + '">' + esc(isWeb ? tr('网页') : a.actor) + '</span>' +
          '<span class="txt">' + activityText(a) + '</span>' +
          '<time>' + esc(dateLabel(a.createdAt)) + '</time></div>';
      }).join('') : tr('<div class="empty" style="padding:16px 0">还没有活动记录</div>'));
    }).catch(function () {});
  }

  function activityText(a) {
    var label = {
      'note.created': tr('创建了笔记'), 'note.updated': tr('更新'), 'note.appended': tr('追加'), 'note.moved': tr('移动'),
      'note.trashed': tr('移入回收站'), 'note.restored': tr('恢复'), 'note.deleted': tr('删除'), 'notebook.created': tr('创建了笔记本')
    }[a.kind] || a.kind;
    var title = a.noteTitle ? tr('《') + '<b>' + esc(a.noteTitle) + '</b>' + tr('》') : '';
    var tool = a.tool ? '<span style="color:#9aa593"> · ' + esc(a.tool) + '</span>' : '';
    return label + title + tool;
  }

  /* --------------------------------------------------- small form dialog */

  var formState = null;

  function closeForm() {
    var previousForm = formState;
    $('formOverlay').classList.remove('show');
    formState = null;
    if (previousForm && previousForm.onCancel) previousForm.onCancel();
  }

  // mode: 'input' (default) | 'select' | 'confirm'
  function openForm(opts) {
    formState = opts;
    var mode = opts.mode || 'input';
    $('formTitle').textContent = opts.title || '';
    $('formHint').textContent = opts.hint || '';
    $('formHint').classList.toggle('hidden', !opts.hint);
    $('formInputWrap').classList.toggle('hidden', mode !== 'input');
    $('formSelectWrap').classList.toggle('hidden', mode !== 'select');
    $('formError').classList.add('hidden');
    $('formError').textContent = '';
    $('formLabel').textContent = opts.label || '';
    $('formInput').value = opts.value || '';
    $('formInput').placeholder = opts.placeholder || '';
    if (mode === 'select') {
      $('formSelectLabel').textContent = opts.label || '';
      window.LNReactUI.renderRegion($('formSelect'), (opts.options || []).map(function (o) {
        return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>';
      }).join(''));
      $('formSelect').value = opts.value || '';
    }
    $('formConfirm').textContent = opts.confirmText || tr('确定');
    $('formConfirm').classList.toggle('danger', !!opts.danger);
    $('formOverlay').classList.add('show');
    setTimeout(function () {
      if (mode === 'input') { $('formInput').focus(); $('formInput').select(); }
      else if (mode === 'select') $('formSelect').focus();
      else $('formConfirm').focus();
    }, 30);
  }

  function showFormError(msg) {
    $('formError').textContent = msg;
    $('formError').classList.remove('hidden');
  }

  function submitForm() {
    if (!formState) return;
    var mode = formState.mode || 'input';
    var value = mode === 'input' ? $('formInput').value.trim()
      : mode === 'select' ? $('formSelect').value : true;
    if (mode === 'input' && !value) { showFormError(tr('名称不能为空')); return; }
    var btn = $('formConfirm');
    btn.disabled = true;
    Promise.resolve().then(function () { return formState.onSubmit(value); }).then(function () {
      btn.disabled = false;
    }).catch(function (err) {
      btn.disabled = false;
      showFormError(err && err.message ? err.message : tr('操作失败'));
    });
  }

  /* -------------------------------------------------------- context menu */

  var ctxItems = [];
  var ctxPoint = { x: 0, y: 0 };

  function closeCtxMenu() {
    $('ctxMenu').classList.add('hidden');
    ctxItems = [];
  }

  function showCtxMenu(head, items, x, y) {
    items = items.filter(Boolean);
    if (typeof x === 'number') ctxPoint = { x: x, y: y };
    ctxItems = items;
    $('ctxHead').textContent = head || '';
    window.LNReactUI.renderRegion($('ctxItems'), items.map(function (it, i) {
      if (it.sep) return '<div class="sep"></div>';
      return '<button type="button" role="menuitem" data-cmi="' + i + '" class="' +
        (it.danger ? 'danger ' : '') + (it.back ? 'back ' : '') + '">' +
        (it.icon ? icon(it.icon) : '') + '<span>' + esc(it.label) + '</span></button>';
    }).join(''));
    var m = $('ctxMenu');
    m.classList.remove('hidden');
    var r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(ctxPoint.x, window.innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(ctxPoint.y, window.innerHeight - r.height - 8)) + 'px';
  }

  function findBy(list, id) {
    return list.filter(function (x) { return x.id === id; })[0];
  }

  function openNotebookMenu(id, x, y) {
    var nb = findBy(state.notebooks, id);
    if (!nb) return;
    showCtxMenu(nb.name + ' · ' + nb.count + tr(' 篇'), [
      { label: nb.pinned ? tr('取消置顶') : tr('置顶'), icon: 'pin', action: function () { toggleNotebookPin(nb); } },
      { label: tr('修改名称'), icon: 'pencil', action: function () { renameNotebook(nb); } },
      { sep: true },
      { label: tr('删除'), icon: 'trash', danger: true, action: function () { deleteNotebook(nb); } },
      pluginMenuAction('notebook', nb, x, y)
    ], x, y);
  }

  function openTagMenu(id, x, y) {
    var t = findBy(state.tags, id);
    if (!t) return;
    showCtxMenu('# ' + t.name + ' · ' + t.count + tr(' 篇'), [
      { label: t.pinned ? tr('取消置顶') : tr('置顶'), icon: 'pin', action: function () { toggleTagPin(t); } },
      { label: tr('修改名称'), icon: 'pencil', action: function () { renameTag(t); } },
      { sep: true },
      { label: tr('删除'), icon: 'trash', danger: true, action: function () { deleteTag(t); } }
    ], x, y);
  }

  function openNoteMenu(id, x, y) {
    var n = findBy(state.notes, id);
    if (!n) return;
    var head = n.title || tr('未命名笔记');
    if (state.scope === 'trash') {
      showCtxMenu(head, [
        { label: tr('恢复'), icon: 'history', action: function () { closeCtxMenu(); deleteOrRestore([id]); } },
        { sep: true },
        { label: tr('彻底删除'), icon: 'trash', danger: true, action: function () { hardDeleteNote(n); } }
      ], x, y);
      return;
    }
    showCtxMenu(head, [
      { label: n.pinned ? tr('取消置顶') : tr('置顶'), icon: 'pin', action: function () { setNotePinned(n); } },
      { label: tr('移动'), icon: 'arrow', action: function () { openMoveMenu(id); } },
      { sep: true },
      { label: tr('删除'), icon: 'trash', danger: true, action: function () { confirmDeleteNotes([n]); } },
      pluginMenuAction('note', n, x, y)
    ], x, y);
  }

  function openMoveMenu(id) {
    var items = [
      { label: tr('← 返回'), back: true, action: function () { openNoteMenu(id); } },
      { sep: true },
      { label: tr('未分类'), icon: 'folder', action: function () { moveNote(id, '', tr('未分类')); } }
    ];
    state.notebooks.forEach(function (nb) {
      items.push({ label: nb.name, icon: 'book', action: function () { moveNote(id, nb.id, nb.name); } });
    });
    showCtxMenu(tr('移动到笔记本'), items);
  }

  /* ------------------------------------------------- notebook / tag actions */

  function metaChanged(msg) {
    toast(msg);
    return refreshAll({ keepSelection: true });
  }

  function createNotebook() {
    openForm({
      title: tr('新建笔记本'), label: tr('笔记本名称'), placeholder: tr('例如：产品设计'), confirmText: tr('创建'),
      onSubmit: function (name) {
        if (state.notebooks.some(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })) {
          return Promise.reject(new Error(tr('已存在同名笔记本')));
        }
        return api('/notebooks', { method: 'POST', body: { name: name } }).then(function (nb) {
          closeForm();
          state.scope = 'notebook:' + nb.id;
          state.query = ''; $('search').value = '';
          return metaChanged(tr('已创建「') + nb.name + tr('」'));
        });
      }
    });
  }

  function createTag() {
    openForm({
      title: tr('新增标签'), label: tr('标签名称'), placeholder: tr('例如：架构'), confirmText: tr('创建'),
      hint: tr('标签可以用来给笔记归类；AI 写入时带上同名标签，也会自动归到这一类。'),
      onSubmit: function (name) {
        if (state.tags.some(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })) {
          return Promise.reject(new Error(tr('已存在同名标签')));
        }
        return api('/tags', { method: 'POST', body: { name: name } }).then(function (tag) {
          closeForm();
          state.scope = 'tag:' + tag.name;
          state.query = ''; $('search').value = '';
          return metaChanged(tr('已新增标签「') + tag.name + tr('」'));
        });
      }
    });
  }

  function toggleNotebookPin(nb) {
    closeCtxMenu();
    return api('/notebooks/' + encodeURIComponent(nb.id), { method: 'PATCH', body: { pinned: !nb.pinned } })
      .then(function () { return metaChanged(nb.pinned ? tr('已取消置顶') : tr('已置顶「') + nb.name + tr('」')); })
      .catch(function (err) { toast(err.message); });
  }

  function renameNotebook(nb) {
    closeCtxMenu();
    openForm({
      title: tr('修改笔记本名称'), label: tr('新名称'), value: nb.name, confirmText: tr('保存'),
      onSubmit: function (name) {
        return api('/notebooks/' + encodeURIComponent(nb.id), { method: 'PATCH', body: { name: name } })
          .then(function (updated) { closeForm(); return metaChanged(tr('已重命名为「') + updated.name + tr('」')); });
      }
    });
  }

  function deleteNotebook(nb) {
    closeCtxMenu();
    openForm({
      title: tr('删除笔记本'), mode: 'confirm', danger: true, confirmText: tr('删除'),
      hint: tr('将删除「') + nb.name + tr('」。其中的 ') + nb.count + tr(' 篇笔记不会丢失，会变为「未分类」。'),
      onSubmit: function () {
        return api('/notebooks/' + encodeURIComponent(nb.id), { method: 'DELETE' }).then(function () {
          closeForm();
          if (state.scope === 'notebook:' + nb.id) state.scope = 'all';
          return metaChanged(tr('已删除笔记本「') + nb.name + tr('」'));
        });
      }
    });
  }

  function toggleTagPin(t) {
    closeCtxMenu();
    return api('/tags/' + encodeURIComponent(t.id), { method: 'PATCH', body: { pinned: !t.pinned } })
      .then(function () { return metaChanged(t.pinned ? tr('已取消置顶') : tr('已置顶 #') + t.name); })
      .catch(function (err) { toast(err.message); });
  }

  function renameTag(t) {
    closeCtxMenu();
    openForm({
      title: tr('修改标签名称'), label: tr('新名称'), value: t.name, confirmText: tr('保存'),
      hint: tr('改名后，使用这个标签的笔记会继续保留关联。'),
      onSubmit: function (name) {
        return api('/tags/' + encodeURIComponent(t.id), { method: 'PATCH', body: { name: name } })
          .then(function (updated) {
            closeForm();
            if (state.scope === 'tag:' + t.name) state.scope = 'tag:' + updated.name;
            return metaChanged(tr('已重命名为 #') + updated.name);
          });
      }
    });
  }

  function deleteTag(t) {
    closeCtxMenu();
    openForm({
      title: tr('删除标签'), mode: 'confirm', danger: true, confirmText: tr('删除'),
      hint: tr('「') + t.name + tr('」会从 ') + t.count + tr(' 篇笔记上移除，笔记本身不会删除。'),
      onSubmit: function () {
        return api('/tags/' + encodeURIComponent(t.id), { method: 'DELETE' }).then(function () {
          closeForm();
          if (state.scope === 'tag:' + t.name) state.scope = 'all';
          return metaChanged(tr('已删除标签「') + t.name + tr('」'));
        });
      }
    });
  }

  /* --------------------------------------------------------- note actions */

  function setNotePinned(n) {
    closeCtxMenu();
    return api('/notes/' + encodeURIComponent(n.id), { method: 'PATCH', body: { pinned: !n.pinned } })
      .then(function (updated) {
        if (state.note && state.note.id === n.id) { state.note = updated; renderEditor(); }
        return metaChanged(updated.pinned ? tr('已置顶') : tr('已取消置顶'));
      }).catch(function (err) { toast(err.message); });
  }

  function moveNote(id, notebookId, label) {
    closeCtxMenu();
    return api('/notes/' + encodeURIComponent(id), { method: 'PATCH', body: { notebookId: notebookId } })
      .then(function () {
        return refreshAll({ keepSelection: true }).then(function () {
          if (state.note && state.note.id === id) {
            return api('/notes/' + encodeURIComponent(id)).then(function (n) {
              state.note = n; renderEditor();
            });
          }
        });
      })
      .then(function () { toast(tr('已移动到「') + label + tr('」')); })
      .catch(function (err) { toast(err.message); });
  }

  function confirmDeleteNotes(notes) {
    closeCtxMenu();
    var ids = notes.map(function (n) { return n.id; });
    openForm({
      title: tr('删除笔记'), mode: 'confirm', danger: true, confirmText: tr('删除'),
      hint: ids.length === 1
        ? tr('「') + (notes[0].title || tr('未命名笔记')) + tr('」会被移到回收站，可以在回收站里恢复。')
        : tr('选中的 ') + ids.length + tr(' 篇笔记会被移到回收站，可以在回收站里恢复。'),
      onSubmit: function () { closeForm(); return deleteOrRestore(ids); }
    });
  }

  function hardDeleteNote(n) {
    closeCtxMenu();
    openForm({
      title: tr('彻底删除'), mode: 'confirm', danger: true, confirmText: tr('永久删除'),
      hint: tr('「') + (n.title || tr('未命名笔记')) + tr('」将被永久删除，无法恢复。'),
      onSubmit: function () {
        return api('/notes/' + encodeURIComponent(n.id) + '?hard=1', { method: 'DELETE' }).then(function () {
          closeForm(); toast(tr('已彻底删除')); return refreshAll();
        });
      }
    });
  }

  /* ------------------------------------------------------------ listeners */

  function bind() {
    $('addNoteTag').addEventListener('click', function () {
      var open = $('noteTagPicker').classList.contains('hidden');
      $('noteTagPicker').classList.toggle('hidden', !open);
      $('addNoteTag').setAttribute('aria-expanded', String(open));
      if (open) { $('noteTagSearch').value = ''; renderTagOptions(); $('noteTagSearch').focus(); }
    });
    $('noteTagSearch').addEventListener('input', renderTagOptions);
    $('noteTagSearch').addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        var name = event.target.value.trim();
        var existing = state.tags.find(function (tag) { return tag.name.toLowerCase() === name.toLowerCase(); });
        if (name) toggleNoteTag(existing ? existing.name : name);
      }
    });
    $('noteTagOptions').addEventListener('click', function (event) {
      var button = event.target.closest('[data-toggle-note-tag]');
      if (button) toggleNoteTag(button.dataset.toggleNoteTag);
    });
    $('docTags').addEventListener('click', function (event) {
      var button = event.target.closest('[data-remove-note-tag]');
      if (button) toggleNoteTag(button.dataset.removeNoteTag);
    });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('#noteTagControl')) closeTagPicker();
    });

    // 右键菜单：点别处、滚动、改窗口大小都收起
    document.addEventListener('click', function (e) {
      if (!ctxItems.length) return;
      if (e.target.closest('#ctxMenu')) return;
      closeCtxMenu();
    });
    $('ctxItems').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cmi]');
      if (!b) return;
      e.stopPropagation();
      var it = ctxItems[Number(b.dataset.cmi)];
      if (it && it.action) it.action();
    });
    document.addEventListener('contextmenu', function (e) {
      // 编辑器、正文、顶栏和空白区默认不弹右键菜单；
      // 只有下面三类列表对象保留项目自己的操作菜单。
      e.preventDefault();
      var nb = e.target.closest('[data-kind="notebook"]');
      if (nb) { openNotebookMenu(nb.dataset.ref, e.clientX, e.clientY); return; }
      var tg = e.target.closest('[data-kind="tag"]');
      if (tg) { openTagMenu(tg.dataset.ref, e.clientX, e.clientY); return; }
      var row = e.target.closest('.note[data-id]');
      if (row) { openNoteMenu(row.dataset.id, e.clientX, e.clientY); return; }
      closeCtxMenu();
    });
    window.addEventListener('resize', closeCtxMenu);
    window.addEventListener('scroll', function () { if (ctxItems.length) closeCtxMenu(); }, true);

    // 小对话框
    $('formCancel').addEventListener('click', closeForm);
    $('formConfirm').addEventListener('click', submitForm);
    $('formOverlay').addEventListener('click', function (e) {
      if (e.target === $('formOverlay')) closeForm();
    });
    $('formInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitForm(); }
    });
    $('formSelect').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitForm(); }
    });

    document.addEventListener('click', function (e) {
      var nav = e.target.closest('[data-scope]');
      if (nav) { navigate(nav.dataset.scope); return; }

      var row = e.target.closest('[data-id]');
      if (row) {
        var id = row.dataset.id;
        if (state.multi) {
          state.chosen.has(id) ? state.chosen.delete(id) : state.chosen.add(id);
          renderList();
        } else {
          selectNote(id);
        }
        return;
      }

      var copy = e.target.closest('[data-copy]');
      if (copy) {
        var text = copy.dataset.copy === 'endpoint' ? (state.system || {}).mcpUrl
          : copy.dataset.copy === 'token' ? (state.system || {}).defaultToken
            : clientSnippet().text;
        copyText(text || '');
        return;
      }

      var ins = e.target.closest('[data-insert]');
      if (ins) { insertMarkdown(ins.dataset.insert); return; }
    });

    document.addEventListener('keydown', function (e) {
      if (window.LNHistory && window.LNHistory.isOpen && window.LNHistory.isOpen()) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); closeSettings(); $('search').focus(); $('search').select(); return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); flushSave(); return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault(); newNote(); return;
      }
      if (e.key === 'Escape') {
        if (!$('noteTagPicker').classList.contains('hidden')) { closeTagPicker(); $('addNoteTag').focus(); return; }
        if (ctxItems.length) { closeCtxMenu(); return; }
        if ($('formOverlay').classList.contains('show')) { closeForm(); return; }
        if (settingsOpen()) { closeSettings(); return; }
        if ($('drawer').classList.contains('show')) { closeDrawer(); return; }
        if ($('exportOverlay').classList.contains('show')) { $('exportCancel').click(); return; }
        if ($('trashOverlay').classList.contains('show')) { $('trashCancel').click(); return; }
        if ($('dialogOverlay').classList.contains('show')) { closeDialog(); return; }
        $('workspace').classList.remove('focus');
        return;
      }
      // 键盘也能唤出右键菜单（macOS 上用 Shift+F10 或菜单键）
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        var target = e.target.closest && e.target.closest('[data-kind], .note[data-id]');
        if (target) {
          e.preventDefault();
          var r = target.getBoundingClientRect();
          var x = r.left + 12, y = r.top + 24;
          if (target.dataset.kind === 'notebook') openNotebookMenu(target.dataset.ref, x, y);
          else if (target.dataset.kind === 'tag') openTagMenu(target.dataset.ref, x, y);
          else openNoteMenu(target.dataset.id, x, y);
        }
        return;
      }
      var row = e.target.closest('[data-id]');
      if (row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault(); row.click();
      }
    });

    if (window.runtime && window.runtime.EventsOn) {
      window.runtime.EventsOn('locknote:before-close', function () {
        savedThen(function () { return Promise.resolve(discardSessionDraft()).then(function () { pluginEvent('workspace:closing', {}); window.runtime.EventsEmit('locknote:close-ready'); }); });
      });
    }
    window.addEventListener('beforeunload', function (event) {
      if (hasUnsaved() || saveInFlight) { event.preventDefault(); event.returnValue = ''; }
    });
    $('search').addEventListener('focus', function () { state.searchActive = true; renderLibrary(); });
    $('search').addEventListener('keydown', function (event) {
      if (event.isComposing) return;
      var notes = virtualModel.notes;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        keyboardIndex = Math.max(0, Math.min(notes.length - 1, keyboardIndex + (event.key === 'ArrowDown' ? 1 : -1)));
        if (notes[keyboardIndex]) {
          var top = virtualModel.noteTop(keyboardIndex) + 7;
          var rows = $('rows');
          if (top < rows.scrollTop) rows.scrollTop = top;
          else if (top + 146 > rows.scrollTop + rows.clientHeight) rows.scrollTop = top + 146 - rows.clientHeight;
          renderListWindow();
          if (keyboardIndex >= notes.length - 2) loadMoreNotes();
        }
      } else if (event.key === 'Enter' && notes.length) {
        event.preventDefault(); selectNote(notes[Math.max(0, Math.min(notes.length - 1, keyboardIndex))].id);
      } else if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); clearTimeout(searchTimer);
        keyboardIndex = -1; $('search').value = ''; state.query = ''; loadNotes({ keepSelection: true }); $('search').blur();
      }
    });
    var searchTimer;
    $('search').addEventListener('input', function (e) {
      clearTimeout(searchTimer);
      keyboardIndex = -1;
      var v = e.target.value;
      searchTimer = setTimeout(function () {
        state.query = v.trim();
        loadNotes({ keepSelection: true });
      }, 220);
    });

    $('sort').addEventListener('change', function (e) {
      state.sort = e.target.value;
      loadNotes({ keepSelection: true });
    });

    // 列表懒加载：滚动接近底部（或点击底部提示）时追加下一批。
    $('rows').addEventListener('scroll', function () {
      queueListWindow();
      var el = $('rows');
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_AHEAD) loadMoreNotes();
    }, { passive: true });
    $('rows').addEventListener('click', function (e) {
      if (e.target.closest('#listMore')) loadMoreNotes();
    });

    window.LNWindowControls.observeViewport($('rows'), function () {
      renderListWindow();
      syncEditorScrollbar();
    });

    // 侧栏分类/标签同样按批展开。
    var library = document.querySelector('.library');
    if (library) {
      library.addEventListener('scroll', function () {
        if (library.scrollTop + library.clientHeight < library.scrollHeight - LOAD_AHEAD) return;
        if (state.folderLimit < state.notebooks.length) growSidebar('folders');
        else if (state.tagLimit < state.tags.length) growSidebar('tags');
      }, { passive: true });
      library.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-sidebar-more]');
        if (btn) growSidebar(btn.dataset.sidebarMore);
      });
    }

    $('newNote').addEventListener('click', newNote);
    $('emptyNew').addEventListener('click', newNote);

    // 编辑区滚动条：跟随滚动位置和内容高度更新，并支持拖动和点击轨道跳转。
    (function bindEditorScrollbar() {
      var scroller = $('document');
      var bar = $('editorScrollbar');
      var thumb = $('editorScrollThumb');

      scroller.addEventListener('scroll', syncEditorScrollbar, { passive: true });
      if (window.ResizeObserver) {
        var observer = new ResizeObserver(syncEditorScrollbar);
        observer.observe(scroller);
        observer.observe($('doc'));
      }

      bar.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        var maxScroll = scroller.scrollHeight - scroller.clientHeight;
        if (maxScroll <= 0) return;
        e.preventDefault();

        var rect = bar.getBoundingClientRect();
        var thumbHeight = thumb.offsetHeight;
        var range = Math.max(1, rect.height - thumbHeight);
        if (e.target !== thumb) {
          var y = e.clientY - rect.top - thumbHeight / 2;
          scroller.scrollTop = Math.max(0, Math.min(1, y / range)) * maxScroll;
        }

        var startY = e.clientY;
        var startScroll = scroller.scrollTop;
        try { bar.setPointerCapture(e.pointerId); } catch (_) {}

        function onMove(moveEvent) {
          scroller.scrollTop = startScroll + (moveEvent.clientY - startY) / range * maxScroll;
        }
        function onEnd(endEvent) {
          bar.removeEventListener('pointermove', onMove);
          bar.removeEventListener('pointerup', onEnd);
          bar.removeEventListener('pointercancel', onEnd);
          try { bar.releasePointerCapture(endEvent.pointerId); } catch (_) {}
        }
        bar.addEventListener('pointermove', onMove);
        bar.addEventListener('pointerup', onEnd);
        bar.addEventListener('pointercancel', onEnd);
      });

      queueEditorScrollbarSync();
    })();

    $('docTitle').addEventListener('input', function () {
      autosize($('docTitle'));
      queueEditorScrollbarSync();
      scheduleSave();
    });
    $('docBody').addEventListener('input', function () {
      autosize($('docBody'));
      queueEditorScrollbarSync();
      updateWordCount();
      scheduleSave();
      pluginEvent('editor:change', currentPluginNote());
    });
    $('docBody').addEventListener('select', function () { pluginEvent('editor:selection', currentPluginNote()); });
    $('docBody').addEventListener('contextmenu', function (event) {
      if (!window.LNPluginHasMenus || !window.LNPluginHasMenus('editor')) return;
      event.preventDefault();
      pluginContextMenu('editor', currentPluginNote(), event.clientX, event.clientY);
    });
    $('docBody').addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var ta = e.target, s = ta.selectionStart;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = s + 2;
        scheduleSave();
      }
    });

    $('editMode').addEventListener('click', function () { state.preview = false; applyMode(); updateWordCount(); });
    $('previewMode').addEventListener('click', function () { state.preview = true; applyMode(); updateWordCount(); });

    $('pinNote').addEventListener('click', togglePin);
    $('deleteNote').addEventListener('click', function () {
      if (!state.note) return;
      if (state.note.deletedAt) hardDeleteNote(state.note);
      else confirmDeleteNotes([state.note]);
    });
    $('exportNote').addEventListener('click', function () {
      if (state.note) window.open('/api/notes/' + state.note.id + '/export', '_blank');
    });

    $('batchToggle').addEventListener('click', function () {
      state.multi = !state.multi;
      state.chosen.clear();
      renderList();
    });
    $('cancelBatch').addEventListener('click', function () {
      state.multi = false; state.chosen.clear(); renderList();
    });
    $('batchDelete').addEventListener('click', function () {
      var ids = Array.from(state.chosen);
      if (state.scope === 'trash') deleteOrRestore(ids);
      else {
        var notes = state.notes.filter(function (note) { return state.chosen.has(note.id); });
        if (!notes.length) { toast(tr('请先选择笔记')); return; }
        confirmDeleteNotes(notes);
      }
    });
    $('batchPin').addEventListener('click', function () {
      if (!state.chosen.size) { toast(tr('请先选择笔记')); return; }
      var ids = Array.from(state.chosen);
      Promise.all(ids.map(function (id) {
        return api('/notes/' + id, { method: 'PATCH', body: { pinned: true } });
      })).then(function () {
        state.multi = false; state.chosen.clear();
        toast(tr('已置顶 ') + ids.length + tr(' 篇'));
        return refreshAll();
      }).catch(function (err) { toast(err.message); });
    });
    $('batchMove').addEventListener('change', function (e) {
      if (!state.chosen.size) { toast(tr('请先选择笔记')); e.target.value = ''; return; }
      var v = e.target.value;
      if (!v) return;
      var ids = Array.from(state.chosen);
      var notebookId = v === '__none' ? '' : v;
      Promise.all(ids.map(function (id) {
        return api('/notes/' + id, { method: 'PATCH', body: { notebookId: notebookId, notebook: v === '__none' ? '' : undefined } });
      })).then(function () {
        state.multi = false; state.chosen.clear();
        toast(tr('已移动所选笔记'));
        return refreshAll();
      }).catch(function (err) { toast(err.message); });
    });

    $('newFolder').addEventListener('click', createNotebook);
    $('newTag').addEventListener('click', createTag);

    $('toggleLibrary').addEventListener('click', function () {
      $('workspace').classList.remove('focus');
      $('workspace').classList.toggle('collapsed');
    });
    $('focus').addEventListener('click', function () { $('workspace').classList.toggle('focus'); });

    $('notesNav').addEventListener('click', function () { navigate('all'); });
    $('recentNav').addEventListener('click', function () { navigate('recent'); });
    $('aiNav').addEventListener('click', function () { navigate('ai'); });
    $('searchNav').addEventListener('click', function () { navigate('all', true); $('search').focus(); });
    $('connectBtn').addEventListener('click', function () { openDrawer('connect'); });
    $('aboutNav').addEventListener('click', showAbout);
    $('settingsNav').addEventListener('click', function () { openSettings('general'); });

    $('drawerClose').addEventListener('click', closeDrawer);
    $('drawerOverlay').addEventListener('click', closeDrawer);

    $('drawerTabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (b) setTab(b.dataset.tab);
    });
    $('clientTabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-client]');
      if (!b) return;
      state.client = b.dataset.client;
      Array.prototype.forEach.call($('clientTabs').children, function (x) {
        x.classList.toggle('active', x === b);
      });
      renderClientBox();
    });
    $('rotateToken').addEventListener('click', function () {
      var button = $('rotateToken');
      button.disabled = true;
      api('/token/rotate', { method: 'POST' }).then(function (res) {
        state.system.defaultToken = res.plaintext;
        renderDrawerContent();
        toast(tr('令牌已更换，请更新客户端配置'));
      }).catch(function (err) { toast(err.message); }).then(function () {
        button.disabled = false;
      });
    });

    $('historyBtn').addEventListener('click', showHistory);
    $('dialogClose').addEventListener('click', closeDialog);
    $('dialogOverlay').addEventListener('click', function (e) {
      if (e.target === $('dialogOverlay')) closeDialog();
    });

    /* -------------------------------------------------------- settings UI */
    $('settingsClose').addEventListener('click', closeSettings);
    $('themeSwatches').addEventListener('click', function (e) {
      var button = e.target.closest('[data-theme-choice]');
      if (button) saveSetting('theme', button.dataset.themeChoice);
    });
    $('settingsTabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-settings-tab]');
      if (b) setSettingsTab(b.dataset.settingsTab);
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-setting]'), function (el) {
      el.addEventListener('change', function () {
        var key = el.dataset.setting;
        var value = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value;
        saveSetting(key, value);
      });
    });

    $('copyDbPath').addEventListener('click', function () {
      copyText((state.system || {}).dbPath || '');
    });
    $('exportMarkdown').addEventListener('click', exportBackup);
    $('importPick').addEventListener('click', function () { $('importFiles').click(); });
    $('importFiles').addEventListener('change', function (event) {
      importNoteFiles(Array.prototype.slice.call(event.target.files || []));
      event.target.value = '';
    });
    var dragDepth = 0;
    document.addEventListener('dragenter', function (event) {
      if (event.target.closest && event.target.closest('[data-plugin-drop]')) return;
      if (Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') < 0) return;
      event.preventDefault(); dragDepth++; document.body.classList.add('file-drop-active');
    });
    document.addEventListener('dragover', function (event) { if (Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') >= 0) event.preventDefault(); });
    document.addEventListener('dragleave', function () { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('file-drop-active'); } });
    document.addEventListener('drop', function (event) {
      if (event.target.closest && event.target.closest('[data-plugin-drop]')) { dragDepth = 0; document.body.classList.remove('file-drop-active'); return; }
      if (!event.dataTransfer.files.length) return;
      event.preventDefault(); dragDepth = 0; document.body.classList.remove('file-drop-active');
      importNoteFiles(Array.prototype.slice.call(event.dataTransfer.files));
    });
    $('emptyTrash').addEventListener('click', function () {
      openForm({
        title: tr('清空回收站'), mode: 'confirm', danger: true, confirmText: tr('清空'),
        hint: tr('该操作会永久删除回收站中的全部笔记，无法恢复。') + ' ' +
          tr('每篇笔记单独提交，中途取消不会回滚已删除的部分。'),
        onSubmit: function () {
          closeForm();
          // 不把慢操作挂在确认按钮的 promise 上：进度弹窗自己负责反馈。
          emptyTrashWithProgress();
          return Promise.resolve();
        }
      });
    });
    $('openConnect').addEventListener('click', function () {
      closeSettings();
      openDrawer('connect');
    });
    $('settingsReset').addEventListener('click', function () {
      openForm({
        title: tr('重置为默认'), mode: 'confirm', confirmText: tr('重置'),
        hint: tr('确定恢复默认设置吗？外观、语言和编辑器等偏好将重置，笔记和访问令牌不受影响。'),
        onSubmit: function () {
          return api('/settings', { method: 'PUT', body: DEFAULT_PREFS }).then(function (res) {
            state.prefs = Object.assign({}, DEFAULT_PREFS, res.settings || {});
            closeForm();
            i18n.applyPrefs(state.prefs);
            refreshLanguage();
            toast(tr('设置项已重置'));
          });
        }
      });
    });
  }

  var importingFiles = false;
  function importNoteFiles(files) {
    if (saveInFlight || hasUnsaved()) return savedThen(function () { importNoteFiles(files); });
    if (!files.length || importingFiles) return;
    if (files.some(function (file) { return !/\.(md|markdown|txt|zip)$/i.test(file.name); })) { toast(tr('只支持 Markdown 或 ZIP')); return; }
    importingFiles = true;
      var form = new FormData();
      files.forEach(function (file) { form.append('files', file, file.name); });
      $('importPick').disabled = true;
      $('importStatus').textContent = tr('正在导入…');
      fetch('/api/import?duplicates=' + encodeURIComponent($('importDuplicates').value), { method: 'POST', body: form }).then(function (res) {
        return res.json().then(function (data) { if (!res.ok) throw new Error(data.error || tr('导入失败')); return data; });
      }).then(function (res) {

        var msg = tr('已导入 ') + res.created + tr(' 篇笔记') + ' · ' + tr('更新') + ' ' + (res.updated || 0) + ' · ' + tr('跳过') + ' ' + res.skipped + ' · ' + tr('失败') + ' ' + (res.errors || []).length;
        $('importStatus').textContent = msg;
        toast(msg);
        return refreshAll({ keepSelection: true });
      }).then(function () {
        renderSettingsInfo();
      }).catch(function (err) {
        $('importStatus').textContent = tr('导入失败');
        toast(err.message || tr('导入失败'));
      }).then(function () { $('importPick').disabled = false; importingFiles = false; });
  }

  function navigate(scope, searchActive) {
    closeSettings();
    if (saveInFlight || hasUnsaved()) return savedThen(function () { navigate(scope, searchActive); });
    discardSessionDraft();
    state.scope = scope;
    state.searchActive = !!searchActive;
    state.multi = false;
    state.chosen.clear();
    state.query = '';
    $('search').value = '';
    renderLibrary();
    loadNotes();
  }

  function copyText(text) {
    if (!text) return;
    var done = function () { toast(tr('已复制到剪贴板')); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast(tr('复制失败，请手动选择')); }
    document.body.removeChild(ta);
  }

  /* ------------------------------------------------------------- dialogs */

  function showAbout() {
    $('dialogTitle').textContent = tr('关于 LockNote.app');
    window.LNReactUI.renderRegion($('dialogBody'), i18n.aboutHTML(state.system || {}));
    $('dialogOverlay').classList.add('show');
  }
  function closeDialog() { $('dialogOverlay').classList.remove('show'); }

  function showHistory() {
    if (!state.note) { toast(tr('请先选择一篇笔记')); return; }
    savedThen(function () {
      var noteId = state.note.id;
      function replaceCurrent(note, previous) {
        if (state.note && state.note.id === noteId) {
          // Do not regress a more recent notification or overwrite input typed after request.
          if (state.note.version <= note.version) {
            var title = $('docTitle').value, body = $('docBody').value;
            state.note = note;
            if (title === previous.title && body === previous.content) renderEditor();
            else {
              if (title === previous.title) $('docTitle').value = note.title;
              if (body === previous.content) $('docBody').value = note.content;
              scheduleSave();
            }
          }
        }
        return refreshAll({ keepSelection: true }).then(function () { return note; });
      }
      function checkEditor(expectedVersion) {
        if (!state.note || state.note.id !== noteId || hasUnsaved() || saveInFlight || historyWriteInFlight || state.note.version !== expectedVersion) {
          throw new Error(tr('笔记已变化，请关闭对比并重新打开后操作'));
        }
      }
      function writeHistory(path, options, previous) {
        historyWriteInFlight = api(path, options).then(function (note) { return replaceCurrent(note, previous); }).then(function (note) {
          historyWriteInFlight = null;
          return note;
        }, function (error) {
          historyWriteInFlight = null;
          throw error;
        });
        return historyWriteInFlight;
      }
      window.LNHistory.open({
        note: Object.assign({}, state.note),
        request: api,
        restore: function (revisionId, expectedVersion) {
          checkEditor(expectedVersion);
          var previous = currentPluginNote();
          return writeHistory('/notes/' + noteId + '/revisions/' + revisionId + '/restore', { method: 'POST', body: { expectedVersion: expectedVersion } }, previous);
        },
        undo: function (before, expectedVersion) {
          checkEditor(expectedVersion);
          var previous = currentPluginNote();
          return writeHistory('/notes/' + noteId + '?checkpoint=true', { method: 'PATCH', body: { title: before.title, content: before.content, expectedVersion: expectedVersion } }, previous);
        }
      });
    });
  }

  /* --------------------------------------------------------------- events */

  // 桌面窗口里 Wails 的 asset server 不支持流式响应，所以用 Wails 事件；
  // 浏览器里仍然用 SSE。
  var changedNoteIds = new Set();
  var importedNotesChanged = false;
  var latestAIChange = null;
  var pendingPluginChanges = new Map();
  var queueChangeRefresh = window.LNListPerformance.createQueue(function () {
    // Preserve notifications while typing; retry after the save has settled.
    if (state.saveTimer || saveInFlight || hasUnsaved()) {
      queueChangeRefresh();
      return Promise.resolve();
    }
    var ids = changedNoteIds;
    var imported = importedNotesChanged;
    var aiChange = latestAIChange;
    var pluginChanges = Array.from(pendingPluginChanges.values());
    latestAIChange = null;
    if (aiChange) toast(tr('AI 写入《') + aiChange.title + tr('》'), { ai: true });
    changedNoteIds = new Set();
    importedNotesChanged = false;
    return refreshAll({ keepSelection: true }).then(function () {
      var selected = state.note && state.note.id;
      if (selected && (imported || ids.has(selected))) {
        return api('/notes/' + selected).then(function (note) {
          if (state.note && state.note.id === selected && !hasUnsaved() && !saveInFlight) {
            state.note = note; renderEditor();
          }
        });
      }
    }).catch(function (err) { toast(err.message); }).then(function () {
      pluginChanges.forEach(function (change) {
        if (pendingPluginChanges.get(change.noteId) === change) {
          pendingPluginChanges.delete(change.noteId);
          pluginEvent('note:change', change);
        }
      });
    }).then(function () {
      if ($('drawer').classList.contains('show') && state.tab === 'activity') return loadActivity();
    });
  });

  function handleChange(data) {
    if (data.noteId) pendingPluginChanges.set(data.noteId, data);
    if (data.type === 'token.changed') { loadSystem(); return; }
    if (data.type === 'settings.changed') {
      loadSettings(true).then(function () { refreshLanguage(); });
      return;
    }
    if (data.noteId) changedNoteIds.add(data.noteId);
    if (data.noteId && data.source && data.source !== 'web' && !data.source.startsWith('plugin:')) latestAIChange = data;
    if (data.type === 'notes.imported') importedNotesChanged = true;
    queueChangeRefresh();
  }

  function connectEvents() {
    if (window.runtime && window.runtime.EventsOn) {
      $('mcpStatus').classList.remove('offline');
      window.runtime.EventsOn('locknote:change', function (data) {
        if (data) handleChange(data);
      });
      return;
    }
    if (!window.EventSource) return;
    var es = new EventSource('/api/events');
    es.addEventListener('ready', function () {
      $('mcpStatus').classList.remove('offline');
    });
    es.addEventListener('change', function (e) {
      var data;
      try { data = JSON.parse(e.data); } catch (err) { return; }
      handleChange(data);
    });
    es.onerror = function () {
      $('mcpStatus').classList.add('offline');
    };
  }

  /* ---------------------------------------------------------- plugin host */

  var recentPluginChanges = new Map();
  function pluginEvent(name, payload) {
    if (name === 'note:change' && payload) {
      var noteId = payload.noteId || (payload.note && payload.note.id);
      var version = payload.version || (payload.note && payload.note.version);
      if (noteId && Number.isInteger(version)) {
        var key = JSON.stringify([noteId, version, payload.type || 'note.updated', payload.source || '']);
        if (recentPluginChanges.has(key)) return;
        recentPluginChanges.set(key, true);
        if (recentPluginChanges.size > 512) recentPluginChanges.delete(recentPluginChanges.keys().next().value);
      }
    }
    if (window.dispatchEvent && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('locknote:plugin-event', { detail: { name: name, payload: payload } }));
    }
  }
  function currentPluginNote() {
    if (!state.note || state.note.id !== state.selectedId) return null;
    return Object.assign({}, state.note, {
      title: $('docTitle').value, content: $('docBody').value,
      tags: (state.note.tags || []).slice(), unsaved: hasUnsaved()
    });
  }
  function pluginRequest(pluginId, path, method, body) {
    if (!window.LNPluginTransport) return Promise.reject(new Error('插件仅在桌面应用中可用'));
    return window.LNPluginTransport.request(pluginId, path, method || 'GET', body);
  }
  function pluginContextMenu(kind, payload, x, y) {
    if (window.dispatchEvent && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('locknote:plugin-context', {
        detail: { context: kind, payload: payload, x: x, y: y }
      }));
    }
  }
  function pluginMenuAction(kind, payload, x, y) {
    if (!window.LNPluginHasMenus || !window.LNPluginHasMenus(kind)) return null;
    return { label: tr('插件操作'), icon: 'sparkles', action: function () {
      closeCtxMenu(); setTimeout(function () { pluginContextMenu(kind, payload, x, y); }, 0);
    } };
  }
  async function pluginEditSelection(text, pluginId, insert) {
    if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw new Error('插件插入内容过大或格式无效');
    if (!state.note || state.note.deletedAt) throw new Error('请先打开可编辑的笔记');
    var id = state.note.id;
    await flushSave();
    if (!state.note || state.note.id !== id) throw new Error('笔记已切换，请重试');
    var ta = $('docBody');
    state.preview = false; applyMode(); ta.focus();
    if (insert) ta.selectionEnd = ta.selectionStart;
    pendingPluginSource = { pluginId: pluginId, noteId: id, expectedVersion: state.note.version };
    var inserted = false;
    if (document.execCommand) inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    autosize(ta); updateWordCount();
    await flushSave();
    pluginEvent('editor:change', currentPluginNote());
  }

  window.LNPluginHost = {
    notes: {
      current: async function () { return currentPluginNote(); },
      list: async function (query, pluginId) {
        var params = new URLSearchParams();
        Object.keys(query || {}).forEach(function (key) { params.set(key, String(query[key])); });
        return pluginRequest(pluginId, '/notes?' + params.toString());
      },
      get: function (id, pluginId) { return pluginRequest(pluginId, '/notes/' + encodeURIComponent(id)); },
      create: async function (input, pluginId) {
        var note = await pluginRequest(pluginId, '/notes', 'POST', input);
        try { await refreshAll({ keepSelection: true }); } catch (error) { toast(tr('笔记已保存，列表刷新失败，请重新选择笔记')); }
        pluginEvent('note:change', { type: 'note.created', note: note, source: 'plugin:' + pluginId, pluginId: pluginId });
        return note;
      },
      update: async function (id, patch, pluginId) {
        if (state.note && state.note.id === id && (hasUnsaved() || saveInFlight)) {
          throw new Error('当前笔记有未保存编辑，请先保存后重试 / unsaved editor changes');
        }
        if (!patch || !Number.isInteger(patch.expectedVersion) || patch.expectedVersion < 1) {
          throw new Error('更新笔记必须提供读取时的 expectedVersion');
        }
        if (state.note && state.note.id === id && state.note.deletedAt) throw new Error('回收站笔记为只读');
        var previous = state.note && state.note.id === id ? currentPluginNote() : null;
        var note = await pluginRequest(pluginId, '/notes/' + encodeURIComponent(id), 'PATCH', patch);
        if (state.note && state.note.id === id) {
          var unchanged = !previous || ($('docTitle').value === previous.title && $('docBody').value === previous.content);
          state.note = note;
          if (unchanged) { try { renderEditor(); } catch (error) { toast(tr('笔记已保存，界面刷新失败，请重新选择笔记')); } }
          else { scheduleSave(); toast(tr('插件已更新笔记，保留你正在编辑的内容')); }
        }
        try { await refreshAll({ keepSelection: true }); } catch (error) { toast(tr('笔记已保存，列表刷新失败，请重新选择笔记')); }
        pluginEvent('note:change', { note: note, source: 'plugin:' + pluginId, pluginId: pluginId });
        return note;
      }
    },
    editor: {
      getSelection: async function () {
        var ta = $('docBody');
        return { noteId: state.note ? state.note.id : null, start: ta.selectionStart || 0, end: ta.selectionEnd || 0,
          text: ta.value.slice(ta.selectionStart || 0, ta.selectionEnd || 0) };
      },
      replaceSelection: function (text, pluginId) { return pluginEditSelection(text, pluginId, false); },
      insertText: function (text, pluginId) { return pluginEditSelection(text, pluginId, true); }
    },
    workspace: {
      openNote: async function (id) {
        await flushSave();
        closeSettings();
        if (window.dispatchEvent && typeof Event !== 'undefined') window.dispatchEvent(new Event('locknote:plugin-show-note'));
        return selectNote(id);
      },
      revealLine: function (line) {
        if (!state.note) return;
        var ta = $('docBody');
        if (window.dispatchEvent && typeof Event !== 'undefined') window.dispatchEvent(new Event('locknote:plugin-show-note'));
        state.preview = false; applyMode();
        var lines = ta.value.split('\n');
        var index = Math.max(0, Math.min(lines.length - 1, Math.floor(line) - 1));
        var offset = lines.slice(0, index).reduce(function (sum, value) { return sum + value.length + 1; }, 0);
        ta.focus(); ta.setSelectionRange(offset, offset + (lines[index] || '').length);
        $('document').scrollTop = Math.max(0, index * parseFloat(getComputedStyle(ta).lineHeight || '24'));
      }
    },
    ui: {
      notify: function (message) { toast(String(message)); },
      confirm: function (message) {
        return new Promise(function (resolve) {
          openForm({ title: tr('插件确认'), hint: String(message), mode: 'confirm',
            onCancel: function () { resolve(false); },
            onSubmit: function () { resolve(true); closeForm(); }
          });
        });
      }
    }
  };

  /* ----------------------------------------------------------------- init */

  function init() {
    // 桌面窗口里才显示顶部的交通灯留白（浏览器里这条带子高度为 0）。
    if (window.runtime) document.documentElement.classList.add('desktop');
    // Read persisted preferences before anything renders, so the first paint
    // already uses the saved theme / language / font size.
    bootStep(8, tr('正在读取偏好设置…'));
    loadSettings(true).then(function () {
      i18n.apply(document);
      window.addEventListener('ln:language', refreshLanguage);
      bind();
      if (window.runtime && window.runtime.EventsEmit) {
        window.runtime.EventsEmit('locknote:frontend-ready');
      }
      bootStep(24, tr('正在连接本地服务…'));
      return loadSystem();
    }).then(function () {
      return refreshAll({ boot: true });
    }).then(function () {
      renderSettingsInfo();
      var params = new URLSearchParams(location.search);
      var noteId = params.get('note');
      // 懒加载后首屏只有前几十篇，不能再靠「是否已在列表里」判断深链是否存在。
      if (noteId) selectNote(noteId);
      connectEvents();
      finishBoot();
      pluginEvent('workspace:ready', {});
    }).catch(function (err) {
      finishBoot();
      toast(tr('加载失败：') + err.message);
      pluginEvent('workspace:ready', {});
    });
  }

  init();
}
