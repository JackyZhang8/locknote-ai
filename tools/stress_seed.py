#!/usr/bin/env python3
"""Directly seed a Locknote MCP SQLite database with a huge, nasty library.

This script deliberately bypasses the Go application and writes rows straight
into SQLite. It is meant for stress-testing UI layout (very long titles,
thousands of sidebar rows, HTML-ish strings, orphan tags) and backend query
performance (30k notes, 3k tags, 100k+ note_tags links).

Schema, indexes, FTS and triggers are read verbatim from
internal/store/*.sql (the same files the Go app embeds), so a generated
library is indistinguishable from a real one. Triggers are dropped during the
bulk load and reinstalled afterwards by a single set-oriented rebuild of the
materialised inverted lists (notes.tags_text / tags.note_ids / counts) plus a
FTS5 'rebuild'. Otherwise per-row recomputation would be O(n^2).

All generated rows carry a `stress_*` id prefix, so `--purge` can undo the
whole thing without touching any real note. Writing to the default live
database requires an explicit `--allow-real-db` flag, and a timestamped backup
is taken by default before any write.

Usage:
    # 1) isolated stress library (safe default)
    python3 tools/stress_seed.py --notes 30000 --tags 3000 --notebooks 200
    python3 tools/stress_seed.py --db /tmp/locknote-stress/locknote.db --stats

    # 2) point the app at it (a fresh process, another port)
    LOCKNOTE_MCP_ADDR=127.0.0.1:7421 \
        /tmp/locknote-mcp serve -data /tmp/locknote-stress -addr 127.0.0.1:7421

    # 3) undo
    python3 tools/stress_seed.py --db /tmp/locknote-stress/locknote.db --purge

    # 4) (dangerous) write into the live library
    python3 tools/stress_seed.py --db ~/.locknote-mcp/locknote.db \
        --allow-real-db --notes 30000 --tags 3000
"""

import argparse
import os
import random
import re
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone

# The schema is shared verbatim with the Go application (go:embed in
# internal/store/indexes.go), so a library written straight into SQLite has
# exactly the same tables, indexes, FTS index and triggers as a real one.
SQL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "internal", "store")
SQL_FILES = ("schema_v3.sql", "indexes_v3.sql", "fts_v3.sql")
REBUILD_FILES = ("rebuild_v3.sql", "triggers_v3.sql", "fts_triggers_v3.sql")
SCHEMA_VERSION = 3

# Triggers must be off during a bulk load: each note_tags INSERT would otherwise
# recompute the whole tag->notes list, turning a linear load into O(n^2).
DROP_TRIGGERS = """
DROP TRIGGER IF EXISTS trg_note_tags_insert;
DROP TRIGGER IF EXISTS trg_note_tags_delete;
DROP TRIGGER IF EXISTS trg_tags_rename;
DROP TRIGGER IF EXISTS trg_notes_live_change;
DROP TRIGGER IF EXISTS trg_notes_insert_counts;
DROP TRIGGER IF EXISTS trg_notes_delete_counts;
DROP TRIGGER IF EXISTS trg_notes_fts_insert;
DROP TRIGGER IF EXISTS trg_notes_fts_delete;
DROP TRIGGER IF EXISTS trg_notes_fts_update;
"""


def read_sql(name):
    path = os.path.join(SQL_DIR, name)
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()

PALETTE = ["#a8bc8d", "#97b6c3", "#d4b989", "#b4a1c5", "#c3a6a0", "#8fae9b"]
TOPICS = [
    "项目复盘", "接口设计", "性能压测", "数据迁移", "需求评审", "线上故障", "读书摘录",
    "架构演进", "缓存策略", "监控告警", "发布计划", "竞品分析", "周会纪要", "客户反馈",
    "安全审计", "成本优化", "测试用例", "模型评估", "索引设计", "日志治理", "前端布局",
    "国际化", "权限模型", "灰度方案", "容量规划", "论文笔记", "灵感碎片", "待办清单",
]
TAGS = [
    "重要", "待整理", "后端", "前端", "数据库", "性能", "设计", "会议", "论文", "摘录",
    "想法", "风险", "阻塞", "已完成", "归档", "临时", "复盘", "调研", "指标", "故障",
    "优化", "文档", "测试", "发布", "需求", "客户", "安全", "成本", "监控", "缓存",
]
SOURCES = ["mcp", "claude-code", "cursor", "workbuddy"]

PREFIX_NOTE = "stress_note_"
PREFIX_TAG = "stress_tag_"
PREFIX_NB = "stress_nb_"
PREFIX_REV = "stress_rev_"
PREFIX_ACT = "stress_act_"


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def default_db():
    return "/tmp/locknote-stress/locknote.db"


def live_dbs():
    out = {os.path.abspath(os.path.expanduser("~/.locknote-mcp/locknote.db"))}
    home = os.environ.get("LOCKNOTE_MCP_HOME", "").strip()
    if home:
        out.add(os.path.abspath(os.path.join(os.path.expanduser(home), "locknote.db")))
    return out


def backup(db):
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dst = db + ".stress-backup-" + stamp
    copies = []
    if os.path.exists(db):
        shutil.copy2(db, dst)
        copies.append(dst)
        for suffix in ("-wal", "-shm"):
            src = db + suffix
            if os.path.exists(src):
                shutil.copy2(src, dst + suffix)
                copies.append(dst + suffix)
    return copies


MATERIALISED_COLUMNS = (
    ("notebooks", "note_count", "INTEGER NOT NULL DEFAULT 0"),
    ("notes", "tags_text", "TEXT NOT NULL DEFAULT ''"),
    ("tags", "note_ids", "TEXT NOT NULL DEFAULT ''"),
    ("tags", "note_count", "INTEGER NOT NULL DEFAULT 0"),
)


def ensure_columns(conn):
    """Patch a pre-v3 library so the shared DDL still applies."""
    for table, column, ddl in MATERIALISED_COLUMNS:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(%s)" % table)]
        if column not in cols:
            conn.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, column, ddl))


def connect(db, fresh):
    os.makedirs(os.path.dirname(os.path.abspath(db)), exist_ok=True)
    conn = sqlite3.connect(db)
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    # Bulk load only; the app reopens with its own synchronous=NORMAL setting.
    conn.execute("PRAGMA synchronous = OFF")
    conn.executescript(read_sql("schema_v3.sql"))
    ensure_columns(conn)
    # Indexes and the FTS table reference the materialised columns, so they
    # must come after the ALTER TABLE patch above.
    for name in SQL_FILES[1:]:
        conn.executescript(read_sql(name))
    # Drop triggers before touching any rows. Each note_tags INSERT would
    # otherwise recompute the entire tag->notes list, i.e. O(n^2) on 90k links.
    conn.executescript(DROP_TRIGGERS)
    # Force the application to treat this as a fresh v3 library if the loader
    # is interrupted before finalise().
    conn.execute("PRAGMA user_version = 2")
    conn.commit()
    if fresh:
        seed_basics(conn)
    return conn


def finalise(conn):
    """Rebuild the materialised inverted lists + FTS index, then reinstall
    triggers. Called once after the bulk load (or after a purge)."""
    # Triggers must be off while the set-oriented rebuild UPDATEs run, or each
    # of the 30k rows would fire a correlated FTS reindex.
    conn.executescript(DROP_TRIGGERS)
    conn.executescript(read_sql("rebuild_v3.sql"))
    conn.execute("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')")
    conn.executescript(read_sql("triggers_v3.sql"))
    conn.executescript(read_sql("fts_triggers_v3.sql"))
    conn.execute("PRAGMA user_version = %d" % SCHEMA_VERSION)
    conn.execute("ANALYZE")
    conn.commit()


def seed_basics(conn):
    """Mimic the app's first-run seed so the library looks like a real one."""
    now = datetime.now(timezone.utc)
    t = iso(now)
    basics = [
        ("nb_default_inbox", "收集箱", "inbox", "#97b6c3", "随手记下还没整理的想法"),
        ("nb_default_work", "工作项目", "book", "#a8bc8d", "正在推进的事情"),
        ("nb_default_read", "学习与阅读", "book", "#d4b989", "读书、课程与长期积累"),
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO notebooks "
        "(id,name,icon,color,description,sort_order,pinned,created_at,updated_at) "
        "VALUES (?,?,?,?,?,?,0,?,?)",
        [(a, b, c, d, e, i, t, t) for i, (a, b, c, d, e) in enumerate(basics)],
    )
    conn.executemany(
        "INSERT OR IGNORE INTO notes "
        "(id,title,content,notebook_id,pinned,source,author,external_id,version,"
        " word_count,created_at,updated_at,deleted_at) "
        "VALUES (?,?,?,?,0,'web','','',1,?,?,?,NULL)",
        [
            ("note_default_welcome", "欢迎使用 Locknote", "# 欢迎\n\n这是压测库的初始笔记。",
             "nb_default_inbox", 12, t, t),
            ("note_default_guide", "使用指南", "## 说明\n\n可以直接用 MCP 工具写入笔记。",
             "nb_default_read", 10, t, t),
        ],
    )
    conn.commit()


def word_count(text):
    # Close enough to textutil.WordCount: CJK chars + latin/number/underscore runs.
    return len(re.findall(r"[\u3400-\u9fff]|[A-Za-z0-9_]+", text))


def notebook_name(rng, i):
    base = "压测分类 %04d · %s" % (i, rng.choice(TOPICS))
    if i % 89 == 0:
        return "超长分类名_" + ("分类" * 60) + "_%04d" % i  # ~180 CJK chars
    if i % 137 == 0:
        return '特殊分类 <b>& "\' %04d' % i
    if i % 199 == 0:
        return "CASE-%04d" % i  # case-only twin below
    if i % 199 == 1:
        return "case-%04d" % (i - 1)  # collides case-insensitively in the app
    if i % 251 == 0:
        return "🚀 分类 / emoji / العربية %04d" % i
    return base


def tag_name(rng, i):
    base = "压测标签-%s-%04d" % (rng.choice(TAGS), i)
    if i % 97 == 0:
        return "超长标签_" + ("长" * 90) + "_%04d" % i
    if i % 151 == 0:
        return '<script>alert("xss")</script> & \'引号\' %04d' % i
    if i % 211 == 0:
        return "#带井号标签-%04d" % i
    if i % 313 == 0:
        return "🏷️ emoji_tag_%04d" % i
    return base


def note_title(rng, i):
    base = "压测笔记 %06d · %s" % (i, rng.choice(TOPICS))
    if i % 53 == 0:
        return "超长标题_" + ("标题" * 70) + "_%06d" % i
    if i % 97 == 0:
        return '<img src=x onerror=alert(1)> "引号" & <b>粗体</b> %06d' % i
    if i % 127 == 0:
        return "换行标题\n第二行 🚀 external_id / save_notes %06d" % i
    if i % 211 == 0:
        return "同名笔记 - 用于测试跨分类重名 %06d" % (i % 17)
    return base


def note_body(rng, i, target, now_str):
    head = (
        "# 压测笔记 %06d\n\n" % i
        + "这是一篇用于压力测试的笔记，混合中文、English words、external_id、save_notes、"
        "update_note 等标识符，用来检验摘要与搜索高亮。\n\n"
        + "## 要点\n\n- 分类、标签、笔记本数量都远超正常使用场景\n"
        + "- 包含 Markdown 表格、代码块、长字符串与特殊字符\n"
        + "- 写入时间：%s\n\n" % now_str
        + "| 列 A | 列 B | 列 C |\n| --- | --- | --- |\n| 值 1 | 值 2 | 值 3 |\n\n"
        + "```go\nfunc Stress(i int) string { return fmt.Sprintf(\"note_%06d\", i) }\n```\n\n"
    )
    filler = (
        "段落内容：项目推进过程中需要不断复盘指标、跟踪风险、同步排期，"
        "同时保留 enough English words for word_count and layout checks. "
    )
    body = head
    while len(body) < target:
        body += filler
    if i % 499 == 0:
        body += "\n\n超长无空格字符串（检验横向溢出）：" + ("W" * 4000) + "\n"
    if i % 997 == 0:
        body += "\n\n<script>alert('xss')</script>\n"
    return body


def chunks(seq, size):
    buf = []
    for item in seq:
        buf.append(item)
        if len(buf) >= size:
            yield buf
            buf = []
    if buf:
        yield buf


def purge(conn):
    # Refuse to remove a stress notebook that a real note still points at:
    # ON DELETE SET NULL would silently detach somebody's data.
    rows = conn.execute(
        "SELECT COUNT(*) FROM notes n JOIN notebooks nb ON nb.id = n.notebook_id "
        "WHERE nb.id GLOB 'stress_nb_*' AND n.id NOT GLOB 'stress_note_*'"
    ).fetchone()[0]
    if rows:
        raise SystemExit(
            "purge aborted: %d non-stress notes still reference stress notebooks. "
            "Move them first." % rows
        )
    cur = conn.cursor()
    deleted = {}
    for label, sql in [
        ("note_tags", "DELETE FROM note_tags WHERE note_id GLOB 'stress_note_*' "
                      "OR tag_id GLOB 'stress_tag_*'"),
        ("note_revisions", "DELETE FROM note_revisions WHERE note_id GLOB 'stress_note_*' "
                           "OR id GLOB 'stress_rev_*'"),
        ("activity", "DELETE FROM activity WHERE note_id GLOB 'stress_note_*' "
                     "OR id GLOB 'stress_act_*'"),
        ("notes", "DELETE FROM notes WHERE id GLOB 'stress_note_*'"),
        ("tags", "DELETE FROM tags WHERE id GLOB 'stress_tag_*'"),
        ("notebooks", "DELETE FROM notebooks WHERE id GLOB 'stress_nb_*'"),
    ]:
        deleted[label] = cur.execute(sql).rowcount
    conn.commit()
    conn.execute("VACUUM")
    return deleted


def stats(conn):
    out = {}
    for table in ("notebooks", "notes", "tags", "note_tags", "note_revisions", "activity"):
        out[table] = conn.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
    out["indexes"] = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").fetchone()[0]
    out["triggers"] = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'").fetchone()[0]
    out["user_version"] = conn.execute("PRAGMA user_version").fetchone()[0]
    out["tags_text_filled"] = conn.execute(
        "SELECT COUNT(*) FROM notes WHERE tags_text <> ''").fetchone()[0]
    out["note_ids_filled"] = conn.execute(
        "SELECT COUNT(*) FROM tags WHERE note_ids <> ''").fetchone()[0]
    try:
        # Trigram needs >= 3 characters; the 2-char word "压测" would always
        # return 0 and look like a broken index. Use a real 4-char phrase.
        out["fts_rows"] = conn.execute(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH '\"项目复盘\"'").fetchone()[0]
    except sqlite3.Error as exc:
        out["fts_rows"] = "ERR %s" % exc
    out["live_notes"] = conn.execute(
        "SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL").fetchone()[0]
    out["trash_notes"] = conn.execute(
        "SELECT COUNT(*) FROM notes WHERE deleted_at IS NOT NULL").fetchone()[0]
    out["orphan_tags"] = conn.execute(
        "SELECT COUNT(*) FROM tags t WHERE NOT EXISTS "
        "(SELECT 1 FROM note_tags nt WHERE nt.tag_id = t.id)").fetchone()[0]
    row = conn.execute("PRAGMA database_list").fetchall()
    main = row[0][2] if row else ""
    total = 0
    for path in (main, main + "-wal", main + "-shm"):
        if path and os.path.exists(path):
            total += os.path.getsize(path)
    out["db_bytes"] = total
    return out


def seed(conn, args, rng):
    now = datetime.now(timezone.utc)
    t0 = time.time()

    def stamp(days):
        return iso(now - timedelta(days=days, seconds=rng.randrange(0, 86400)))

    # ---- notebooks -------------------------------------------------------
    nb_ids = []
    nb_rows = []
    for i in range(args.notebooks):
        nid = "%s%06d" % (PREFIX_NB, i)
        nb_ids.append(nid)
        nb_rows.append((
            nid, notebook_name(rng, i), "book", PALETTE[i % len(PALETTE)],
            "压测分类说明 %04d" % i, i, 1 if i % 41 == 0 else 0,
            stamp(rng.randrange(0, 730)), stamp(rng.randrange(0, 30)),
        ))
    conn.executemany(
        "INSERT INTO notebooks "
        "(id,name,icon,color,description,sort_order,pinned,created_at,updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?)", nb_rows)
    print("  notebooks: %d" % len(nb_rows), flush=True)

    # ---- tags ------------------------------------------------------------
    tag_ids = []
    tag_rows = []
    orphan_start = int(args.tags * (1 - args.orphan_tag_pct / 100.0))
    for i in range(args.tags):
        tid = "%s%06d" % (PREFIX_TAG, i)
        tag_ids.append(tid)
        tag_rows.append((
            tid, tag_name(rng, i), PALETTE[(i * 3) % len(PALETTE)],
            1 if i % 173 == 0 else 0, stamp(rng.randrange(0, 730)),
        ))
    conn.executemany(
        "INSERT INTO tags (id,name,color,pinned,created_at) VALUES (?,?,?,?,?)", tag_rows)
    print("  tags: %d (of which %d have no notes)" % (len(tag_rows), args.tags - orphan_start), flush=True)

    # ---- notes -----------------------------------------------------------
    assignable = max(1, orphan_start)
    hot = max(1, int(assignable * 0.1))
    note_rows = []
    link_rows = []
    rev_rows = []
    for i in range(args.notes):
        nid = "%s%06d" % (PREFIX_NOTE, i)
        created = stamp(rng.randrange(0, 730))
        updated = stamp(rng.randrange(0, 30))
        trashed = rng.random() < args.trash_pct / 100.0
        deleted = stamp(rng.randrange(0, 30)) if trashed else None
        size = args.body_size
        if i % 503 == 0:
            size = args.body_size * 60  # a few very long bodies for the editor
        else:
            size = int(size * rng.uniform(0.4, 1.8))
        body = note_body(rng, i, size, updated)
        source = rng.choice(SOURCES) if rng.random() < args.ai_pct / 100.0 else "web"
        nb_id = nb_ids[rng.randrange(len(nb_ids))] if nb_ids else None
        if i % 23 == 0:  # uncategorized notes
            nb_id = None
        note_rows.append((
            nid, note_title(rng, i), body, nb_id,
            1 if rng.random() < args.pinned_pct / 100.0 else 0,
            source, "stress-bot",
            "stress-ext-%06d" % i if i % 311 == 0 else "",
            rng.randint(1, 4), word_count(body), created, updated, deleted,
        ))

        # Zipf-ish tag popularity: a small set of tags is very hot, the rest
        # is uniform. This makes the sidebar counts realistically skewed.
        k = rng.randint(0, min(6, args.tags_per_note * 2))
        chosen = set()
        for _ in range(k):
            tid = tag_ids[rng.randrange(hot) if rng.random() < 0.7
                          else rng.randrange(assignable)]
            chosen.add(tid)
        for tid in chosen:
            link_rows.append((nid, tid))

        if i % 97 == 0:
            rev_rows.append((
                "%s%06d" % (PREFIX_REV, i), nid, "历史版本 %06d" % i,
                body[:300], source, 1, created,
            ))

    for batch in chunks(note_rows, 2000):
        conn.executemany(
            "INSERT INTO notes "
            "(id,title,content,notebook_id,pinned,source,author,external_id,version,"
            " word_count,created_at,updated_at,deleted_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
    print("  notes: %d (body ~%.1f MB)" % (
        len(note_rows), sum(len(r[2]) for r in note_rows) / 1024.0 / 1024.0), flush=True)

    for batch in chunks(link_rows, 10000):
        conn.executemany(
            "INSERT OR IGNORE INTO note_tags (note_id,tag_id) VALUES (?,?)", batch)
    print("  note_tags: %d" % len(link_rows), flush=True)

    if rev_rows:
        conn.executemany(
            "INSERT INTO note_revisions "
            "(id,note_id,title,content,source,version,created_at) VALUES (?,?,?,?,?,?,?)",
            rev_rows)
        print("  note_revisions: %d" % len(rev_rows), flush=True)

    # ---- activity --------------------------------------------------------
    act_rows = []
    for i in range(args.activity):
        act_rows.append((
            "%s%06d" % (PREFIX_ACT, i),
            rng.choice(["note.created", "note.updated", "note.trashed"]),
            rng.choice(["save_note", "save_notes", "append_to_note"]),
            "%s%06d" % (PREFIX_NOTE, rng.randrange(args.notes)),
            "压测活动标题 %06d" % i,
            "STRESS 压测活动记录 %06d" % i,
            "stress-bot", stamp(rng.randrange(0, 30)),
        ))
    conn.executemany(
        "INSERT INTO activity "
        "(id,kind,tool,note_id,note_title,detail,actor,created_at) "
        "VALUES (?,?,?,?,?,?,?,?)", act_rows)
    print("  activity: %d" % len(act_rows), flush=True)

    conn.commit()
    conn.execute("ANALYZE")
    conn.commit()
    print("  committed in %.1fs" % (time.time() - t0), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", default=default_db(), help="SQLite 文件路径")
    p.add_argument("--notes", type=int, default=30000, help="笔记数（默认 30000）")
    p.add_argument("--tags", type=int, default=3000, help="标签数（默认 3000）")
    p.add_argument("--notebooks", type=int, default=200, help="分类/笔记本数（默认 200）")
    p.add_argument("--tags-per-note", type=int, default=3, help="每篇笔记平均标签数（默认 3）")
    p.add_argument("--body-size", type=int, default=800, help="正文平均字符数（默认 800）")
    p.add_argument("--trash-pct", type=float, default=5, help="回收站占比 %%")
    p.add_argument("--pinned-pct", type=float, default=2, help="置顶占比 %%")
    p.add_argument("--ai-pct", type=float, default=12, help="AI 来源占比 %%")
    p.add_argument("--orphan-tag-pct", type=float, default=12, help="空标签占比 %%")
    p.add_argument("--activity", type=int, default=300, help="活动记录条数")
    p.add_argument("--seed", type=int, default=42, help="随机种子")
    p.add_argument("--purge", action="store_true", help="只清除压测数据，不写入")
    p.add_argument("--reset", action="store_true", help="先 purge 再写入")
    p.add_argument("--stats", action="store_true", help="只打印库内统计，不写入")
    p.add_argument("--allow-real-db", action="store_true",
                   help="允许写入默认真实笔记库（危险，需显式指定）")
    p.add_argument("--no-backup", action="store_true", help="跳过写入前备份")
    p.add_argument("--dry-run", action="store_true", help="只打印将要执行的计划")
    args = p.parse_args()

    db = os.path.abspath(os.path.expanduser(args.db))
    is_live = db in live_dbs()
    if is_live and not args.allow_real_db and not (args.stats or args.dry_run):
        p.error("拒绝直接写入真实笔记库 %s。请先用独立的 --db，或显式加 --allow-real-db。" % db)
    if any(v < 0 for v in (args.notes, args.tags, args.notebooks, args.activity)):
        p.error("数量不能为负")

    if args.dry_run:
        print("plan: db=%s notes=%d tags=%d notebooks=%d tags/note=%d body=%d "
              "trash=%.1f%% pinned=%.1f%% ai=%.1f%% orphan_tags=%.1f%% seed=%d" % (
                  db, args.notes, args.tags, args.notebooks, args.tags_per_note,
                  args.body_size, args.trash_pct, args.pinned_pct, args.ai_pct,
                  args.orphan_tag_pct, args.seed))
        print("live db: %s" % ("YES (needs --allow-real-db)" if is_live else "no"))
        return

    fresh = not os.path.exists(db)
    if args.stats:
        if fresh:
            print("数据库不存在：%s" % db)
            return
        conn = sqlite3.connect(db)
        for k, v in stats(conn).items():
            print("  %-16s %s" % (k, v))
        conn.close()
        return

    if not (fresh or args.no_backup):
        copies = backup(db)
        print("backup: %s" % (", ".join(copies) if copies else "(empty db, skipped)"))

    conn = connect(db, fresh)
    print("db: %s%s" % (db, "  [LIVE]" if is_live else ""), flush=True)
    try:
        if args.purge or args.reset:
            removed = purge(conn)
            print("purged: " + ", ".join("%s=%d" % kv for kv in removed.items()), flush=True)
            if args.purge:
                finalise(conn)
                print("rebuilt inverted lists, FTS index and triggers", flush=True)
                return
        existing = conn.execute(
            "SELECT COUNT(*) FROM notes WHERE id GLOB 'stress_note_*'").fetchone()[0]
        if existing:
            raise SystemExit(
                "库里已有 %d 篇压测笔记，直接再跑会撞主键。请先 --purge，或用 --reset 重灌。" % existing)
        rng = random.Random(args.seed)
        seed(conn, args, rng)
        print("finalising inverted lists / FTS / triggers ...", flush=True)
        finalise(conn)
        print("stats:")
        for k, v in stats(conn).items():
            print("  %-16s %s" % (k, v))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
