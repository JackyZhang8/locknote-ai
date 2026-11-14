#!/usr/bin/env python3
"""Stress-test the web UI layout against a huge library in a real browser.

Companion to stress_seed.py / stress_bench.py. While stress_bench.py measures
the server, this script measures what a user actually sees: first paint with
3k sidebar tags and 200 notebooks, horizontal overflow from 140-char titles
and 4000-char unbroken strings, console errors, and the latency of search /
tag / editor interactions on a 30k-note library.

Usage:
    python3 tools/ui_layout_bench.py --base http://127.0.0.1:7431 \
        --shot-dir /tmp/locknote-ui --json-out /tmp/locknote-ui.json

Requires Python playwright and a local Chrome. Only stdlib + playwright.
"""

import argparse
import http.client
import json
import os
import sys
import time
from urllib.parse import urlsplit

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def check_service(base):
    u = urlsplit(base)
    c = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=10)
    c.request("GET", "/api/system")
    r = c.getresponse()
    data = json.loads(r.read().decode("utf-8", "replace"))
    c.close()
    return data.get("stats", {})


def js_metrics(page):
    """Collect DOM / layout facts in one round trip."""
    return page.evaluate("""() => {
      const q = (s) => document.querySelector(s);
      const rect = (el) => el ? el.getBoundingClientRect().toJSON() : null;
      const de = document.documentElement;
      const body = document.body;
      const rows = q('#rows');
      const tags = q('#tags');
      const folders = q('#folders');
      const dt = q('#docTitle');
      const sidebar = q('.sidebar') || q('#workspace') || q('aside');
      const overflowing = [];
      // Only scan the first few hundred elements: reading scrollWidth on every
      // offscreen content-visibility row forces a full layout and distorts timing.
      Array.from(document.querySelectorAll('.note .t, .navrow span, #docTitle'))
        .slice(0, 400).forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
          overflowing.push({
            cls: el.className || el.tagName,
            text: (el.textContent || '').slice(0, 60),
            scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
          });
        }
      });
      return {
        title: document.title,
        docScrollWidth: de.scrollWidth, docClientWidth: de.clientWidth,
        bodyScrollWidth: body.scrollWidth, bodyClientWidth: body.clientWidth,
        horizontalOverflow: de.scrollWidth > de.clientWidth + 2,
        nodeCount: document.getElementsByTagName('*').length,
        rowsChildren: rows ? rows.children.length : -1,
        tagsChildren: tags ? tags.children.length : -1,
        foldersChildren: folders ? folders.children.length : -1,
        rowsRect: rect(rows), sidebarRect: rect(sidebar),
        overflowingCount: overflowing.length,
        overflowingSamples: overflowing.slice(0, 8),
        listSubtitle: (q('#listSubtitle') || {}).textContent || '',
        tagsScrollHeight: tags ? tags.scrollHeight : -1,
        tagsClientHeight: tags ? tags.clientHeight : -1,
        // Layout regressions: a long CJK notebook name used to wrap into a
        // vertical column of single characters; a long note title used to grow
        // the editor textarea to six 29px lines. Both must stay bounded now.
        maxFolderRowHeight: (() => {
          const hs = Array.from(document.querySelectorAll('#folders .navrow'))
            .map((el) => el.getBoundingClientRect().height);
          return hs.length ? Math.round(Math.max(...hs)) : -1;
        })(),
        maxTagRowHeight: (() => {
          const hs = Array.from(document.querySelectorAll('#tags .navrow'))
            .map((el) => el.getBoundingClientRect().height);
          return hs.length ? Math.round(Math.max(...hs)) : -1;
        })(),
        docTitleHeight: dt ? Math.round(dt.getBoundingClientRect().height) : -1,
        docTitleScrollHeight: dt ? Math.round(dt.scrollHeight) : -1,
        bootOverlayPresent: !!q('#bootOverlay'),
        listMoreText: (q('#listMore') || {}).textContent || '',
      };
    }""")


def timed(page, label, fn):
    t0 = time.perf_counter()
    try:
        value = fn()
        dt = (time.perf_counter() - t0) * 1000.0
        return {"label": label, "ms": round(dt, 1), "ok": True, "value": value}
    except Exception as exc:
        dt = (time.perf_counter() - t0) * 1000.0
        return {"label": label, "ms": round(dt, 1), "ok": False,
                "error": "%s: %s" % (type(exc).__name__, exc)}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://127.0.0.1:7431")
    ap.add_argument("--chrome", default=CHROME)
    ap.add_argument("--shot-dir", default="/tmp/locknote-ui")
    ap.add_argument("--json-out", default="/tmp/locknote-ui.json")
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--timeout", type=int, default=60)
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    if not os.path.exists(args.chrome):
        print("Chrome not found: %s" % args.chrome)
        return 2
    os.makedirs(args.shot_dir, exist_ok=True)
    try:
        stats = check_service(args.base)
        print("service stats: notes=%s tags=%s notebooks=%s" % (
            stats.get("notes"), stats.get("tags"), stats.get("notebooks")), flush=True)
    except Exception as exc:
        print("service unreachable at %s: %s" % (args.base, exc))
        return 2

    errors = []
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=args.chrome,
                                    args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = browser.new_page(viewport={"width": args.width, "height": args.height},
                                device_scale_factor=1)
        page.set_default_timeout(args.timeout * 1000)
        page.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        page.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
                if m.type == "error" else None)

        def boot_shot():
            """Capture the centered boot progress bar in a throttled page so the
            main first-paint timing stays comparable with the old baseline."""
            bp = browser.new_page(viewport={"width": args.width, "height": args.height},
                                  device_scale_factor=1)
            cdp = bp.context.new_cdp_session(bp)
            cdp.send("Network.enable")
            cdp.send("Network.emulateNetworkConditions", {
                "offline": False, "latency": 700,
                "downloadThroughput": 120 * 1024, "uploadThroughput": 120 * 1024,
            })
            bp.goto(args.base + "/", wait_until="domcontentloaded",
                    timeout=args.timeout * 1000)
            bp.wait_for_selector("#bootOverlay", timeout=15000)
            width = bp.locator("#bootBar").evaluate("(el) => el.style.width")
            label = bp.locator("#bootLabel").inner_text()
            bp.screenshot(path=os.path.join(args.shot_dir, "00-boot-progress.png"),
                          full_page=False)
            bp.close()
            return {"barWidth": width, "label": label}

        results.append(timed(page, "启动进度条", boot_shot))

        def load():
            page.goto(args.base + "/", wait_until="domcontentloaded",
                      timeout=args.timeout * 1000)
            # Wait until the sidebar, the note list and the boot fade-out are done.
            page.wait_for_function(
                "() => document.querySelectorAll('#tags .navrow').length > 0 "
                "&& document.querySelectorAll('#rows .note').length > 0 "
                "&& !document.getElementById('bootOverlay')",
                timeout=args.timeout * 1000)
            return js_metrics(page)

        r = timed(page, "首屏渲染（含 3k 标签侧栏）", load)
        results.append(r)
        metrics = r.get("value") or {}
        print("\nfirst paint metrics:", json.dumps(metrics, ensure_ascii=False)[:1200], flush=True)

        try:
            page.screenshot(path=os.path.join(args.shot_dir, "01-first-paint.png"),
                            full_page=False)
        except Exception as exc:
            errors.append("screenshot first paint: %s" % exc)

        # Lazy loading: scroll to the bottom and confirm another batch arrives.
        def load_next_batch():
            before = page.locator("#rows .note").count()
            page.locator("#rows").evaluate("(el) => { el.scrollTop = el.scrollHeight; }")
            page.wait_for_function(
                "(n) => document.querySelectorAll('#rows .note').length > n",
                arg=before, timeout=args.timeout * 1000)
            page.wait_for_timeout(250)
            after = page.locator("#rows .note").count()
            return {"before": before, "after": after,
                    "moreText": page.locator("#listMore").inner_text()}

        results.append(timed(page, "滚动加载下一批笔记", load_next_batch))

        # Search a short Chinese word (LIKE fallback) and a long one (FTS).
        def search(q):
            page.fill("#search", q)
            page.wait_for_timeout(700)
            return {"subtitle": page.locator("#listSubtitle").inner_text(),
                    "rows": page.locator("#rows .note").count()}

        for q in ("性能", "项目复盘", "external_id"):
            results.append(timed(page, "搜索 %s" % q, lambda q=q: search(q)))

        # Switch to a tag filter (thousands of sidebar buttons) and back.
        def tag_filter():
            page.locator('#tags .navrow').first.click()
            page.wait_for_timeout(600)
            return {"subtitle": page.locator("#listSubtitle").inner_text(),
                    "rows": page.locator("#rows .note").count()}

        results.append(timed(page, "标签筛选（3k 按钮）", tag_filter))

        # Open the longest note body to exercise the editor/preview layout.
        def open_long_note():
            page.fill("#search", "")
            page.wait_for_timeout(500)
            page.locator("#rows .note").first.click()
            page.wait_for_timeout(800)
            m = js_metrics(page)
            return {"nodeCount": m["nodeCount"],
                    "horizontalOverflow": m["horizontalOverflow"],
                    "overflowingCount": m["overflowingCount"],
                    "docTitleHeight": m["docTitleHeight"],
                    "docTitleScrollHeight": m["docTitleScrollHeight"],
                    "docTitle": (page.locator("#docTitle").inner_text()
                                 if page.locator("#docTitle").count() else "")[:80]}

        results.append(timed(page, "打开长正文笔记", open_long_note))
        try:
            page.screenshot(path=os.path.join(args.shot_dir, "02-long-note.png"),
                            full_page=False)
        except Exception as exc:
            errors.append("screenshot note: %s" % exc)

        # Narrow viewport: check for horizontal overflow / broken columns.
        page.set_viewport_size({"width": 900, "height": 760})
        page.wait_for_timeout(500)
        narrow = js_metrics(page)
        results.append({"label": "窄视口 900px 布局", "ms": 0, "ok": True,
                        "value": {"horizontalOverflow": narrow["horizontalOverflow"],
                                  "docScrollWidth": narrow["docScrollWidth"],
                                  "docClientWidth": narrow["docClientWidth"],
                                  "overflowingCount": narrow["overflowingCount"]}})
        try:
            page.screenshot(path=os.path.join(args.shot_dir, "03-narrow-900.png"),
                            full_page=False)
        except Exception as exc:
            errors.append("screenshot narrow: %s" % exc)

        # Export progress dialog: open Settings > Data & backup, start an export,
        # confirm the progress bar appears, then cancel without downloading.
        def export_progress():
            page.locator("#settingsNav").click()
            page.locator('#settingsTabs [data-settings-tab="data"]').click()
            page.wait_for_selector("#exportMarkdown", state="visible")
            page.locator("#exportMarkdown").click()
            page.wait_for_function(
                "() => document.getElementById('exportOverlay').classList.contains('show')",
                timeout=15000)
            # Wait for real streamed bytes: a motionless bar means the server
            # is still buffering the whole archive.
            page.wait_for_function(
                "() => parseInt(document.getElementById('exportPct').textContent, 10) > 6",
                timeout=30000)
            shown = page.locator("#exportPct").inner_text()
            stage = page.locator("#exportStage").inner_text()
            streamed = page.locator("#exportBytes").inner_text()
            page.screenshot(path=os.path.join(args.shot_dir, "04-export-progress.png"),
                            full_page=False)
            page.locator("#exportCancel").click()
            page.wait_for_function(
                "() => !document.getElementById('exportOverlay').classList.contains('show')",
                timeout=10000)
            return {"percent": shown, "stage": stage, "bytes": streamed, "cancelled": True}

        results.append(timed(page, "导出备份进度条", export_progress))

        browser.close()

    print("\n%-34s %10s  %s" % ("CHECK", "ms", "RESULT"))
    print("-" * 92)
    for r in results:
        short = json.dumps(r.get("value"), ensure_ascii=False)[:180] if r.get("ok") else r.get("error", "")
        print("%-34s %10.1f  %s" % (r["label"], r["ms"], short))
    print("\nconsole/page errors: %d" % len(errors))
    for e in errors[:12]:
        print("  " + e)

    fatal = [e for e in errors if e.startswith("pageerror")]
    checks = {
        "首屏无横向溢出": not metrics.get("horizontalOverflow", True),
        "窄视口无横向溢出": not narrow.get("horizontalOverflow", True),
        "启动遮罩已淡出": not metrics.get("bootOverlayPresent", True),
        "笔记首屏分批加载（≤ 60 行）": 0 < metrics.get("rowsChildren", 9999) <= 60,
        "侧栏标签分批渲染（≤ 100 行）": 0 < metrics.get("tagsChildren", 9999) <= 100,
        "侧栏分类分批渲染（≤ 100 行）": 0 < metrics.get("foldersChildren", 9999) <= 100,
        "标签滚动区域显著收敛": 0 < metrics.get("tagsScrollHeight", 10 ** 9) < 10000,
        "侧栏分类名不超过两行": 0 < metrics.get("maxFolderRowHeight", 9999) <= 60,
        "侧栏标签名不超过两行": 0 < metrics.get("maxTagRowHeight", 9999) <= 60,
        "编辑器标题不超过三行": 0 < narrow.get("docTitleHeight", 9999) <= 132,
        "启动进度条可见": any(r.get("label") == "启动进度条" and r.get("ok") for r in results),
        "导出进度条有流式推进": any(r.get("label") == "导出备份进度条" and r.get("ok") for r in results),
        "无 JS 运行时错误": not fatal,
    }
    print("\nlayout / UX checks:")
    for name, ok in checks.items():
        print("  %-4s  %s" % ("PASS" if ok else "FAIL", name))

    payload = {"base": args.base, "viewport": [args.width, args.height],
               "metrics": metrics, "narrow": narrow,
               "results": results, "errors": errors, "checks": checks,
               "shots": sorted(os.listdir(args.shot_dir))}
    with open(args.json_out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print("wrote %s" % args.json_out)
    print("shots in %s" % args.shot_dir)
    return 1 if fatal or any(not v for v in checks.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
