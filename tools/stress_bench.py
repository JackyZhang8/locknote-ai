#!/usr/bin/env python3
"""Benchmark the running Locknote MCP HTTP/MCP endpoints against a stress DB.

The companion stress_seed.py fills a library with tens of thousands of notes;
this script measures how long the real Go service takes to answer the calls the
web UI makes on every refresh, plus MCP tool calls.

Usage:
    python3 tools/stress_bench.py --base http://127.0.0.1:7421 --repeat 5
    python3 tools/stress_bench.py --base http://127.0.0.1:7421 --repeat 5 \
        --mcp --include-export --json-out /tmp/stress_bench.json

Only http.client (stdlib) is used; no curl, no third-party packages.
"""

import argparse
import http.client
import json
import statistics
import sys
import time
from urllib.parse import urlencode, urlsplit


def request(base, method, path, body=None, headers=None, timeout=60):
    u = urlsplit(base)
    conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=timeout)
    payload = None
    hdrs = dict(headers or {})
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    hdrs.setdefault("Accept", "application/json, text/event-stream")
    t0 = time.perf_counter()
    conn.request(method, path, body=payload, headers=hdrs)
    resp = conn.getresponse()
    data = resp.read()
    elapsed = (time.perf_counter() - t0) * 1000.0
    status = resp.status
    conn.close()
    return status, elapsed, data


def measure(label, fn, repeat, warmup):
    for _ in range(warmup):
        try:
            fn()
        except Exception:
            pass
    times, sizes, statuses = [], 0, set()
    last_error = None
    for _ in range(repeat):
        try:
            status, ms, data = fn()
            times.append(ms)
            sizes = len(data)
            statuses.add(status)
        except Exception as exc:  # surface the failure instead of hiding it
            last_error = "%s: %s" % (type(exc).__name__, exc)
    if not times:
        return {"label": label, "error": last_error or "no successful call"}
    times.sort()
    return {
        "label": label,
        "status": "/".join(str(s) for s in sorted(statuses)),
        "bytes": sizes,
        "min_ms": round(times[0], 1),
        "median_ms": round(statistics.median(times), 1),
        "avg_ms": round(statistics.mean(times), 1),
        "p95_ms": round(times[min(len(times) - 1, int(len(times) * 0.95))], 1),
        "max_ms": round(times[-1], 1),
        "n": len(times),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", default="http://127.0.0.1:7421", help="服务地址")
    p.add_argument("--repeat", type=int, default=3, help="每个端点重复次数")
    p.add_argument("--warmup", type=int, default=1, help="预热次数")
    p.add_argument("--timeout", type=int, default=120, help="单次请求超时秒数")
    p.add_argument("--slow-ms", type=float, default=500, help="慢请求阈值（毫秒）")
    p.add_argument("--mcp", action="store_true", help="同时压 MCP tools/call")
    p.add_argument("--token", help="MCP 访问令牌；不传则从 /api/system 自动获取")
    p.add_argument("--include-export", action="store_true",
                   help="包含整库 Markdown 导出（可能非常大）")
    p.add_argument("--json-out", help="把结果写成 JSON 文件")
    args = p.parse_args()

    # Sanity check + discover a real hot tag name for the tag-filter endpoint.
    try:
        status, _, data = request(args.base, "GET", "/api/tags", timeout=args.timeout)
        tags = json.loads(data.decode("utf-8", "replace")).get("tags", [])
        hot_tag = tags[0]["name"] if tags else "压测标签"
    except Exception as exc:
        print("无法连接 %s：%s" % (args.base, exc))
        print("先启动服务（注意指向压测库）：")
        print("  LOCKNOTE_MCP_ADDR=127.0.0.1:7421 /tmp/locknote-mcp serve "
              "-data /tmp/locknote-stress -addr 127.0.0.1:7421")
        return 2
    print("base=%s  tags=%d  hot_tag=%r  repeat=%d" % (
        args.base, len(tags), hot_tag, args.repeat), flush=True)

    get = lambda path: request(args.base, "GET", path, timeout=args.timeout)
    cases = [
        ("UI 首屏 /", lambda: get("/")),
        # UI 现在按批懒加载，首批只取 40 篇；400 篇是旧版的整页请求，留作回归对照。
        ("GET /api/notes limit=40 (UI 首批)", lambda: get(
            "/api/notes?" + urlencode({"scope": "all", "sort": "updated", "limit": 40}))),
        ("GET /api/notes limit=40 第二批", lambda: get(
            "/api/notes?" + urlencode({"scope": "all", "sort": "updated", "limit": 40, "offset": 40}))),
        ("GET /api/notes limit=400 (旧版整页)", lambda: get(
            "/api/notes?" + urlencode({"scope": "all", "sort": "updated", "limit": 400}))),
        ("GET /api/notes sort=title", lambda: get(
            "/api/notes?" + urlencode({"scope": "all", "sort": "title", "limit": 400}))),
        ("GET /api/notes sort=words", lambda: get(
            "/api/notes?" + urlencode({"scope": "all", "sort": "words", "limit": 400}))),
        ("GET /api/notes offset=20000", lambda: get(
            "/api/notes?" + urlencode({"scope": "all", "limit": 400, "offset": 20000}))),
        ("GET /api/notes q=性能", lambda: get(
            "/api/notes?" + urlencode({"scope": "all", "q": "性能", "limit": 400}))),
        ("GET /api/notes tag=<hot>", lambda: get(
            "/api/notes?" + urlencode({"scope": "tag", "tag": hot_tag, "limit": 400}))),
        ("GET /api/notes scope=trash", lambda: get(
            "/api/notes?" + urlencode({"scope": "trash", "limit": 400}))),
        ("GET /api/tags", lambda: get("/api/tags")),
        ("GET /api/notebooks", lambda: get("/api/notebooks")),
        ("GET /api/stats", lambda: get("/api/stats")),
        ("GET /api/activity", lambda: get("/api/activity?limit=40")),
        ("GET /api/system", lambda: get("/api/system")),
    ]
    if args.include_export:
        cases.append(("GET /api/export (整库)", lambda: get("/api/export")))

    if args.mcp:
        token = args.token
        if not token:
            try:
                _, _, sysdata = request(args.base, "GET", "/api/system", timeout=args.timeout)
                token = json.loads(sysdata.decode("utf-8", "replace")).get("defaultToken", "")
            except Exception as exc:
                print("读取 /api/system 令牌失败：%s" % exc)
        mcp_headers = {"Authorization": "Bearer " + token} if token else {}
        print("MCP token: %s" % ("auto" if token else "none (expect 401)"), flush=True)

        def mcp_post(body):
            return request(args.base, "POST", "/mcp", body,
                           headers=mcp_headers, timeout=args.timeout)

        try:
            mcp_post({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                      "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                                 "clientInfo": {"name": "stress-bench", "version": "1"}}})
            mcp_post({"jsonrpc": "2.0", "method": "notifications/initialized"})
        except Exception as exc:
            print("MCP initialize 失败（继续尝试 tools/call）：%s" % exc)

        def mcp_call(name, arguments):
            body = {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": {"name": name, "arguments": arguments}}
            return mcp_post(body)

        cases += [
            ("MCP workspace_overview", lambda: mcp_call("workspace_overview", {})),
            ("MCP list_notes limit=50", lambda: mcp_call("list_notes", {"limit": 50})),
            ("MCP list_tags", lambda: mcp_call("list_tags", {})),
            ("MCP search_notes", lambda: mcp_call("search_notes", {"query": "压测", "limit": 20})),
        ]

    results = []
    print("\n%-42s %8s %8s %8s %9s  %s" % (
        "ENDPOINT", "min", "median", "p95", "bytes", "status"))
    print("-" * 92)
    for label, fn in cases:
        r = measure(label, fn, args.repeat, args.warmup)
        results.append(r)
        if "error" in r:
            print("%-42s  ERROR  %s" % (label, r["error"]))
            continue
        flag = "  <== SLOW" if r["median_ms"] > args.slow_ms else ""
        print("%-42s %8.1f %8.1f %8.1f %9d  %s%s" % (
            label, r["min_ms"], r["median_ms"], r["p95_ms"], r["bytes"],
            r["status"], flag), flush=True)

    slow = [r for r in results if r.get("median_ms", 0) > args.slow_ms]
    failed = [r for r in results if "error" in r]
    print("\nsummary: %d endpoints, %d slow (>%.0fms), %d failed" % (
        len(results), len(slow), args.slow_ms, len(failed)))
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            json.dump({"base": args.base, "results": results}, fh,
                      ensure_ascii=False, indent=2)
        print("wrote %s" % args.json_out)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
