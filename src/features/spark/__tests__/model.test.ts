import { describe, expect, it } from "vitest";
import {
  blankConnection,
  changesCatalog,
  isQuery,
  queryTitle,
  connectionProblems,
  connectRequest,
  parseConf,
  readConnections,
  ReplyParser,
  splitStatements,
  statementAt,
  toCsv,
} from "../model";

describe("Spark connections", () => {
  it("reads saved connections, skipping broken and duplicate ones", () => {
    const list = readConnections({
      connections: [
        { id: "a", name: "Local", kind: "local", master: "local[2]" },
        { id: "a", name: "Again" },
        { name: "no id" },
        "junk",
        { id: "b", kind: "connect", remote: "sc://h:15002", uiUrl: "https://ui" },
      ],
    });
    expect(list.map((c) => [c.id, c.name, c.kind, c.master, c.remote])).toEqual([
      ["a", "Local", "local", "local[2]", ""],
      ["b", "b", "connect", "local[*]", "sc://h:15002"],
    ]);
    expect(readConnections(null)).toEqual([]);
  });

  it("says what keeps a connection from being saved", () => {
    const a = { ...blankConnection("a"), name: "Local" };
    expect(connectionProblems(a, [a])).toEqual([]);
    expect(connectionProblems({ ...a, master: "local[two]" }, [])).toEqual(["master"]);
    expect(connectionProblems({ ...a, master: "spark://h:7077" }, [])).toEqual([]);
    const other = { ...blankConnection("b"), name: "Local" };
    expect(connectionProblems(a, [a, other])).toEqual(["name"]);
    expect(connectionProblems({ ...a, kind: "connect", remote: "http://h" }, [])).toEqual(["remote"]);
    expect(connectionProblems({ ...a, uiUrl: "ui", historyUrl: "https://h" }, [])).toEqual(["uiUrl"]);
  });

  it("parses Spark configuration lines", () => {
    expect(parseConf("# memory\nspark.driver.memory = 2g\n\nspark.x=a=b\nbad line\n=v")).toEqual({
      conf: { "spark.driver.memory": "2g", "spark.x": "a=b" },
      problems: [{ line: 5 }, { line: 6 }],
    });
  });

  it("builds the connect request", () => {
    const local = { ...blankConnection("a"), name: "L", master: " local[2] " };
    expect(connectRequest(local, { token: "t", conf: "k=v" })).toEqual({
      app: "OpenIDEA · L",
      master: "local[2]",
      conf: { k: "v" },
    });
    const remote = { ...local, kind: "connect" as const, remote: "sc://h:1" };
    expect(connectRequest(remote, { token: "t", conf: null })).toEqual({
      app: "OpenIDEA · L",
      remote: "sc://h:1",
      token: "t",
      conf: {},
    });
  });
});

describe("bridge replies", () => {
  it("separates replies from the program's output across chunks", () => {
    const p = new ReplyParser();
    expect(p.push('hello\n\x1e{"id": 1, "ok": tr')).toEqual({ output: "hello\n", messages: [] });
    expect(p.push("ue}\npartial")).toEqual({ output: "partial", messages: [{ id: 1, ok: true }] });
    expect(p.push(" line\n\x1enot json\n")).toEqual({ output: " line\nnot json\n", messages: [] });
  });
});

describe("Spark SQL statements", () => {
  const sql = "-- head\nSELECT ';' AS a;\n\nSELECT `x;y` FROM t -- trailing;\n;\n/* only */\n";
  it("splits at semicolons outside strings, names and comments", () => {
    expect(splitStatements(sql).map((s) => s.text)).toEqual([
      "-- head\nSELECT ';' AS a",
      "SELECT `x;y` FROM t -- trailing;",
    ]);
  });

  it("finds the statement at the caret", () => {
    const second = sql.indexOf("FROM");
    expect(statementAt(sql, second)?.text).toBe("SELECT `x;y` FROM t -- trailing;");
    expect(statementAt(sql, 2)?.text).toBe("-- head\nSELECT ';' AS a");
    expect(statementAt(sql, sql.length)?.text).toBe("SELECT `x;y` FROM t -- trailing;");
    expect(statementAt("", 0)).toBeNull();
  });
});

describe("statement kinds", () => {
  it("tells queries from commands, past leading comments", () => {
    expect(isQuery("-- top\n/* note */ WITH x AS (SELECT 1) SELECT * FROM x")).toBe(true);
    expect(isQuery("(SELECT 1)")).toBe(true);
    expect(isQuery("INSERT INTO t SELECT 1")).toBe(false);
    expect(changesCatalog("-- make it\nCREATE TEMP VIEW v AS SELECT 1")).toBe(true);
    expect(changesCatalog("SELECT 'create'")).toBe(false);
  });

  it("titles a result by its statement", () => {
    expect(queryTitle("-- buckets\nSELECT bucket,\n  count(*)\nFROM orders")).toBe(
      "SELECT bucket, count(*) FROM orders",
    );
    expect(queryTitle(`SELECT ${"x, ".repeat(20)}y`)).toHaveLength(40);
  });
});

describe("CSV export", () => {
  it("quotes what needs quoting and leaves nulls empty", () => {
    const csv = toCsv({
      columns: [
        { name: "a", type: "string" },
        { name: "b,c", type: "int" },
      ],
      rows: [
        ['say "hi"', null],
        ["x\ny", "1"],
      ],
      more: false,
      omittedColumns: 0,
    });
    expect(csv).toBe('a,"b,c"\n"say ""hi""",\n"x\ny",1\n');
  });
});
