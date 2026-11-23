# Copyright 2026 OpenIDEA fork contributors. Licensed under the Apache License 2.0.
"""The IDE's Spark session process: one per connection, holding a SparkSession (local or
Spark Connect) and a Python namespace that the SQL editor and the Spark console share.

Reads one JSON request per stdin line ({"id", "op", ...}) and answers each with a line
``\\x1e{"id", "ok", ...}``; other output is the program's own. Requests run one at a time,
each under its own job group (or Connect tag) so ``cancel`` can stop it. Data crossing over
is bounded: 1,000 rows, 200 columns, 4 KiB per cell, 8 MiB per message.
"""

import ast
import contextlib
import io
import json
import os
import queue
import re
import sys
import threading
import traceback

RS = "\x1e"
DEFAULT_ROWS = 100
MAX_ROWS = 1000
MAX_COLUMNS = 200
MAX_CELL = 4096
MAX_MESSAGE = 8 * 1024 * 1024
CONNECT_TIMEOUT = 60

_out = sys.stdout
_lock = threading.Lock()
spark = None
connect = False
namespace = {"__name__": "__spark_console__"}
last_df = None
current_tag = None


def send(message):
    text = json.dumps(message, default=str)
    if len(text) > MAX_MESSAGE and "rows" in message:
        # Drop rows from the end until the message fits; say so.
        rows = message["rows"]
        while rows and len(text) > MAX_MESSAGE:
            del rows[len(rows) // 2 :]
            message["truncated"] = True
            text = json.dumps(message, default=str)
    with _lock:
        _out.write(RS + text + "\n")
        _out.flush()


def cell(value):
    if value is None:
        return None
    text = str(value)
    return text if len(text) <= MAX_CELL else text[: MAX_CELL - 1] + "…"


def preview(df, limit=None):
    limit = max(1, min(int(limit or DEFAULT_ROWS), MAX_ROWS))
    columns = df.columns
    omitted = max(0, len(columns) - MAX_COLUMNS)
    if omitted:
        df = df.select(columns[:MAX_COLUMNS])
    schema = [{"name": f.name, "type": f.dataType.simpleString()} for f in df.schema.fields]
    rows = df.limit(limit + 1).collect()
    more = len(rows) > limit
    return {
        "columns": schema,
        "rows": [[cell(v) for v in row] for row in rows[:limit]],
        "more": more,
        "omittedColumns": omitted,
    }


def source(spec):
    kind, name = spec.get("kind"), spec.get("name")
    if kind == "table":
        return spark.table(name)
    if kind == "sql":
        return spark.sql(spec["text"])
    if kind == "variable":
        value = namespace.get(name)
        if value is None or not hasattr(value, "schema"):
            raise ValueError("%s is not a DataFrame in the console" % name)
        return value
    if last_df is None:
        raise ValueError("Run a query first")
    return last_df


def transformed(df, request):
    if request.get("filter"):
        df = df.filter(request["filter"])
    sort = request.get("sort")
    if sort:
        from pyspark.sql import functions as F

        column = F.col(sort["column"])
        df = df.orderBy(column.desc() if sort.get("descending") else column.asc())
    return df


def captured(fn):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        result = fn()
    return result, out.getvalue(), err.getvalue()


def connected(builder, endpoint):
    """A Spark Connect session that answered within CONNECT_TIMEOUT (its client otherwise retries
    for minutes). `endpoint` is shown without the token."""
    box = {}

    def probe():
        try:
            session = builder.getOrCreate()
            box["version"] = session.version
            box["session"] = session
        except Exception as error:
            box["error"] = error

    thread = threading.Thread(target=probe, name="openidea-spark-connect", daemon=True)
    thread.start()
    thread.join(CONNECT_TIMEOUT)
    if thread.is_alive():
        raise TimeoutError("%s didn't answer within %d s" % (endpoint, CONNECT_TIMEOUT))
    if "error" in box:
        raise box["error"]
    return box["session"]


def op_connect(request):
    global spark, connect
    from pyspark.sql import SparkSession

    builder = SparkSession.builder.appName(request.get("app") or "OpenIDEA")
    conf = dict(request.get("conf") or {})
    remote = request.get("remote")
    if not remote:
        # A local driver on loopback: a host name that doesn't resolve fails the context.
        conf.setdefault("spark.driver.host", "127.0.0.1")
        conf.setdefault("spark.driver.bindAddress", "127.0.0.1")
    for key, value in conf.items():
        builder = builder.config(key, value)
    if remote:
        token = request.get("token")
        if token:
            # sc://host:port/;param=value;…: the token is one more parameter.
            remote = remote + (";" if "/;" in remote else "/;") + "token=" + token
        builder = builder.remote(remote)
        connect = True
        spark = connected(builder, request["remote"])
    else:
        builder = builder.master(request.get("master") or "local[*]")
        spark = builder.getOrCreate()
    namespace["spark"] = spark
    ui = None
    if not connect:
        try:
            ui = spark.sparkContext.uiWebUrl
        except Exception:
            ui = None
    return {"version": spark.version, "connect": connect, "ui": ui}


def op_sql(request):
    global last_df
    df = spark.sql(request["text"])
    last_df = df
    if not df.columns:
        df.collect()  # a command (DDL, SET…) without rows
        return {"columns": [], "rows": [], "more": False, "omittedColumns": 0}
    return preview(df, request.get("limit"))


def op_explain(request):
    df = spark.sql(request["text"])
    mode = request.get("mode") or "formatted"
    _, out, _ = captured(lambda: df.explain(mode=mode))
    return {"plan": out}


def op_python(request):
    global last_df
    code = request["code"]
    tree = ast.parse(code, "<spark console>")
    last = tree.body[-1] if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    body = tree.body[:-1] if last is not None else tree.body

    def run():
        exec(compile(ast.Module(body=body, type_ignores=[]), "<spark console>", "exec"), namespace)
        if last is not None:
            return eval(compile(ast.Expression(last.value), "<spark console>", "eval"), namespace)
        return None

    try:
        value, out, err = captured(run)
    except Exception:
        return {"output": "", "error": traceback.format_exc(limit=8)}
    if value is not None and hasattr(value, "schema") and hasattr(value, "limit"):
        last_df = value  # previewed on request only: collecting runs a Spark job
    return {"output": out + err, "value": None if value is None else cell(repr(value))}


def op_catalog(request):
    databases = []
    for db in spark.catalog.listDatabases():
        databases.append({"name": db.name, "tables": []})
    current = spark.catalog.currentDatabase()
    tables = []
    for t in spark.catalog.listTables():
        tables.append({"name": t.name, "database": t.database, "type": t.tableType, "temporary": t.isTemporary})
    frames = sorted(name for name, value in namespace.items() if not name.startswith("_") and hasattr(value, "schema") and hasattr(value, "limit"))
    return {"current": current, "databases": [d["name"] for d in databases], "tables": tables, "dataFrames": frames}


def op_columns(request):
    name = request["table"]
    return {"columns": [{"name": c.name, "type": c.dataType, "nullable": c.nullable} for c in spark.catalog.listColumns(name)]}


def op_preview(request):
    df = transformed(source(request.get("source") or {}), request)
    return preview(df, request.get("limit"))


def op_count(request):
    df = transformed(source(request.get("source") or {}), request)
    return {"count": df.count()}


OPS = {
    "connect": op_connect,
    "sql": op_sql,
    "explain": op_explain,
    "python": op_python,
    "catalog": op_catalog,
    "columns": op_columns,
    "preview": op_preview,
    "count": op_count,
}


def describe(error):
    """The error's message; for a JVM error, its root cause rather than the Py4J wrapper."""
    java = getattr(error, "java_exception", None)
    if java is not None:
        try:
            cause = java
            while cause.getCause() is not None:
                cause = cause.getCause()
            return cause.toString()
        except Exception:
            pass
    text = str(error).strip()
    # A gRPC failure (Spark Connect) prints its status and details on the lines after the first.
    status = re.search(r"status = StatusCode\.(\w+)", text)
    details = re.search(r'details = "([^"]*)"', text)
    if status or details:
        return "%s: %s" % (status.group(1) if status else type(error).__name__, details.group(1) if details else "")
    lines = [line for line in text.splitlines() if line.strip()]
    return "%s: %s" % (type(error).__name__, lines[0] if lines else "")


def tag_of(request):
    return "openidea-%s" % request["id"]


def cancel(tag):
    if spark is None or not tag:
        return
    try:
        if connect:
            spark.interruptTag(tag)
        else:
            spark.sparkContext.cancelJobGroup(tag)
    except Exception as error:
        sys.stderr.write("openidea: cancel failed: %s\n" % error)


def run(request):
    global current_tag
    op = OPS.get(request.get("op"))
    if op is None:
        send({"id": request.get("id"), "ok": False, "error": "unknown request %r" % request.get("op")})
        return
    if request["op"] != "connect" and spark is None:
        send({"id": request["id"], "ok": False, "error": "Not connected"})
        return
    tag = tag_of(request)
    current_tag = tag
    try:
        if spark is not None:
            if connect:
                spark.addTag(tag)
            else:
                spark.sparkContext.setJobGroup(tag, request["op"], interruptOnCancel=True)
        result = op(request)
        send(dict(result, id=request["id"], ok=True))
    except Exception as error:
        send({"id": request["id"], "ok": False, "error": describe(error)})
    finally:
        current_tag = None
        if spark is not None and connect:
            try:
                spark.removeTag(tag)
            except Exception:
                pass


def main():
    requests = queue.Queue()

    def reader():
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except ValueError:
                continue
            if request.get("op") == "cancel":
                cancel(tag_of({"id": request.get("target")}) if request.get("target") is not None else current_tag)
                send({"id": request.get("id"), "ok": True})
            else:
                requests.put(request)
        # Input ended: the IDE went away. Stop what runs and leave, even if Spark doesn't let go.
        cancel(current_tag)
        requests.put(None)
        threading.Timer(5, lambda: os._exit(0)).start()

    send({"event": "ready", "python": sys.version.split()[0]})
    threading.Thread(target=reader, name="openidea-spark-reader", daemon=True).start()
    while True:
        request = requests.get()
        if request is None or request.get("op") == "close":
            break
        run(request)
    if spark is not None:
        try:
            spark.stop()
        except Exception:
            pass
    # A Spark Connect client still retrying (a connect that timed out) would hold up the exit.
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
