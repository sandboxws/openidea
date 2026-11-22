# Copyright 2026 OpenIDEA fork contributors. Licensed under the Apache License 2.0.
"""Tests of the Python Tests helpers against real projects.

python -m unittest discover -s crates/ide-pyidea/helpers/tests   (pytest cases need pytest installed)
"""

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

HELPERS = Path(__file__).resolve().parent.parent

try:
    import pytest  # noqa: F401

    HAS_PYTEST = True
except ImportError:
    HAS_PYTEST = False


def write(root, files):
    for name, text in files.items():
        path = Path(root, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(text), encoding="utf-8")


def run_helper(args, cwd, events=None, env=None):
    environment = dict(os.environ)
    environment["PYTHONPATH"] = os.pathsep.join([str(HELPERS), str(Path(cwd, "src")), str(cwd)])
    environment.pop("PYTEST_ADDOPTS", None)
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    if events:
        environment["OPENIDEA_TEST_EVENTS"] = str(events)
    environment.update(env or {})
    return subprocess.run([sys.executable] + args, cwd=cwd, env=environment, capture_output=True, text=True, timeout=120)


def collect(project, framework, **request):
    request = dict(project=str(project), framework=framework, **request)
    req = Path(project, "request.json")
    out = Path(project, "out.json")
    req.write_text(json.dumps(request), encoding="utf-8")
    done = run_helper([str(HELPERS / "openidea_tests_collect.py"), str(req), str(out)], project)
    assert done.returncode == 0, done.stderr
    return json.loads(out.read_text(encoding="utf-8"))


def events(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line]


PROJECT = {
    "src/shop/__init__.py": "",
    "src/shop/price.py": '''
        def total(items):
            """Sum of prices.

            >>> total([1, 2])
            3
            """
            return sum(items)
        ''',
    "src/shop/unused.py": "VALUE = 1\n",
    "tests/__init__.py": "",
    "tests/test_price.py": '''
        import pytest
        from shop.price import total


        @pytest.mark.parametrize("items,expected", [([1, 2], 3), ([2, 2], 5)])
        def test_total(items, expected):
            assert total(items) == expected


        class TestEmpty:
            def test_zero(self):
                assert total([]) == 0
        ''',
}


@unittest.skipUnless(HAS_PYTEST, "pytest is not installed")
class PytestTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name).resolve()
        write(self.root, PROJECT)

    def tearDown(self):
        self.dir.cleanup()

    def test_collects_parameter_cases_and_the_import_graph(self):
        result = collect(self.root, "pytest", roots=[str(self.root / "src"), str(self.root)])
        ids = [t["id"] for t in result["tests"]]
        self.assertEqual(
            ids,
            [
                "tests/test_price.py::test_total[items0-3]",
                "tests/test_price.py::test_total[items1-5]",
                "tests/test_price.py::TestEmpty::test_zero",
            ],
        )
        self.assertEqual(result["tests"][1]["params"], {"items": "[2, 2]", "expected": "5"})
        self.assertEqual(result["tests"][2]["symbol"], "TestEmpty.test_zero")
        self.assertEqual(result["errors"], [])
        test_file = str(self.root / "tests/test_price.py")
        self.assertIn(str(self.root / "src/shop/price.py"), result["graph"][test_file])
        self.assertNotIn(str(self.root / "src/shop/unused.py"), result["graph"][test_file])

    def test_graph_mode_refreshes_only_the_graph(self):
        first = collect(self.root, "graph")
        self.assertEqual(first["tests"], [])
        again = collect(self.root, "graph", previous={"graph": first["graph"], "stamps": first["stamps"]})
        self.assertEqual(again["graph"], first["graph"])

    def test_reporter_reports_comparisons_snapshots_and_parameters(self):
        log = self.root / "events.jsonl"
        done = run_helper(["-m", "pytest", "-p", "openidea_pytest_reporter", "tests"], self.root, events=log)
        self.assertEqual(done.returncode, 1, done.stdout)
        got = events(log)
        self.assertEqual(got[0], {"event": "collected", "count": 3})
        results = {e["id"]: e for e in got if e["event"] == "result"}
        self.assertEqual(results["tests/test_price.py::test_total[items0-3]"]["outcome"], "passed")
        failed = results["tests/test_price.py::test_total[items1-5]"]
        self.assertEqual(failed["outcome"], "failed")
        self.assertEqual((failed["expected"], failed["actual"]), ("5", "4"))
        self.assertEqual(failed["params"], {"items": "[2, 2]", "expected": "5"})
        self.assertEqual(failed["location"]["line"], 8)
        snap = failed["snapshot"]
        self.assertEqual(snap["lines"][snap["line"] - snap["start"]].strip(), "assert total(items) == expected")
        self.assertEqual(got[-1], {"event": "finished", "exitstatus": 1})

    def test_reporter_reports_setup_errors_and_skips(self):
        write(
            self.root,
            {
                "tests/test_more.py": '''
                    import pytest

                    @pytest.fixture
                    def broken():
                        raise RuntimeError("no database")

                    def test_needs_db(broken):
                        pass

                    @pytest.mark.skip(reason="later")
                    def test_later():
                        pass
                    ''',
            },
        )
        log = self.root / "events.jsonl"
        run_helper(["-m", "pytest", "-p", "openidea_pytest_reporter", "tests/test_more.py"], self.root, events=log)
        results = {e["id"]: e for e in events(log) if e["event"] == "result"}
        self.assertEqual(results["tests/test_more.py::test_needs_db"]["outcome"], "error")
        self.assertEqual(results["tests/test_more.py::test_later"]["outcome"], "skipped")
        self.assertEqual(results["tests/test_more.py::test_later"]["message"], "later")


class UnittestTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name).resolve()
        write(
            self.root,
            {
                "pkg/__init__.py": "",
                "pkg/test_calc.py": '''
                    import unittest

                    class Calc(unittest.TestCase):
                        def test_ok(self):
                            self.assertEqual(1 + 1, 2)

                        def test_bad(self):
                            self.assertEqual(1 + 1, 3)

                        @unittest.skip("not yet")
                        def test_skip(self):
                            pass


                    def load_tests(loader, tests, pattern):
                        return loader.loadTestsFromTestCase(Calc)
                    ''',
            },
        )

    def tearDown(self):
        self.dir.cleanup()

    def test_collection_honours_load_tests(self):
        result = collect(self.root, "unittest", discovery=str(self.root))
        self.assertEqual(
            sorted(t["id"] for t in result["tests"]),
            ["pkg.test_calc.Calc.test_bad", "pkg.test_calc.Calc.test_ok", "pkg.test_calc.Calc.test_skip"],
        )

    def test_runner_reports_each_test(self):
        log = self.root / "events.jsonl"
        done = run_helper(["-m", "openidea_unittest_runner", "pkg.test_calc"], self.root, events=log)
        self.assertEqual(done.returncode, 1)
        results = {e["id"]: e for e in events(log) if e["event"] == "result"}
        self.assertEqual(results["pkg.test_calc.Calc.test_ok"]["outcome"], "passed")
        bad = results["pkg.test_calc.Calc.test_bad"]
        self.assertEqual(bad["outcome"], "failed")
        self.assertEqual(bad["location"]["line"], 9)
        self.assertIn("2 != 3", bad["message"])
        self.assertEqual(results["pkg.test_calc.Calc.test_skip"]["outcome"], "skipped")


class DoctestTests(unittest.TestCase):
    SOURCE = '''
        def area(width, height):
            """Rectangle area.

            >>> area(2, 3)
            6
            >>> area(1, 1)
            2
            """
            return width * height


        def broken():
            """
            >>> import missing_module_xyz
            >>> 1 + 1
            2
            """
        '''

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name).resolve()
        write(self.root, {"geometry.py": self.SOURCE})
        self.file = str(self.root / "geometry.py")

    def tearDown(self):
        self.dir.cleanup()

    def results(self, *args):
        log = self.root / "events.jsonl"
        if log.exists():
            log.unlink()
        run_helper(["-m", "openidea_doctest_runner", self.file] + list(args), self.root, events=log)
        return [e for e in events(log) if e["event"] == "result"]

    def test_collection_lists_docstring_owners(self):
        result = collect(self.root, "doctest", roots=[str(self.root)])
        self.assertEqual(sorted(t["id"] for t in result["tests"]), [self.file + "::area", self.file + "::broken"])

    def test_owner_run_reports_the_first_failing_example(self):
        (area,) = self.results("--owner", "area")
        self.assertEqual(area["outcome"], "failed")
        self.assertEqual((area["expected"], area["actual"]), ("2\n", "1\n"))
        self.assertEqual(area["location"]["line"], 7)

    def test_targets_name_whole_files_or_single_docstrings(self):
        ids = sorted(r["id"] for r in self.results())
        self.assertEqual(ids, [self.file + "::area", self.file + "::broken"])
        log = self.root / "events.jsonl"
        log.unlink()
        run_helper(["-m", "openidea_doctest_runner", self.file + "::broken"], self.root, events=log)
        self.assertEqual([e["id"] for e in events(log) if e["event"] == "result"], [self.file + "::broken"])

    def test_selected_example_replays_earlier_examples_as_setup(self):
        (first,) = self.results("--example", "5")
        self.assertEqual((first["id"], first["outcome"]), (self.file + "::area:5", "passed"))
        (second,) = self.results("--example", "7")
        self.assertEqual(second["outcome"], "failed")
        (after_setup_failure,) = self.results("--example", "16")
        self.assertEqual(after_setup_failure["outcome"], "failed")
        self.assertIn("failed during setup", after_setup_failure["longrepr"])
        self.assertEqual(after_setup_failure["location"]["line"], 15)


class WebDiscoveryTests(unittest.TestCase):
    def test_finds_apps_factories_and_django_without_importing_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            write(
                root,
                {
                    "webapp/app.py": """
                        from flask import Flask
                        raise SystemExit("must not be imported")
                        app = Flask(__name__)
                        """,
                    "services/api/src/api/__init__.py": "",
                    "services/api/src/api/main.py": """
                        import fastapi

                        def create_app():
                            application = fastapi.FastAPI()
                            return application
                        """,
                    "site/manage.py": "import os\nos.environ.setdefault('DJANGO_SETTINGS_MODULE', 'site.settings')\n",
                    "lib/not_an_app.py": "def create_app():\n    return 1\n",
                    "pyproject.toml": "[tool.fastapi]\nentrypoint = 'svc.main:app'\n",
                },
            )
            out = root / "out.json"
            done = run_helper([str(HELPERS / "openidea_web_discover.py"), str(root), str(out)], root)
            self.assertEqual(done.returncode, 0, done.stderr)
            apps = json.loads(out.read_text(encoding="utf-8"))["apps"]
            got = [(a["framework"], a["target"], a["factory"], a["directory"]) for a in apps]
            self.assertIn(("django", str(root / "site/manage.py"), False, str(root / "site")), got)
            self.assertIn(("flask", "app:app", False, str(root / "webapp")), got)
            self.assertIn(("fastapi", "api.main:create_app", True, str(root / "services/api")), got)
            self.assertIn(("fastapi", "svc.main:app", False, str(root)), got)
            fastapi = next(a for a in apps if a["target"] == "api.main:create_app")
            self.assertEqual(fastapi["pythonPath"], str(root / "services/api/src"))
            self.assertFalse(any("not_an_app" in a["file"] for a in apps))


class ScienceTests(unittest.TestCase):
    def test_profiles_a_script_into_cpuprofiles_that_keep_its_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            write(
                root,
                {
                    "work.py": """
                        import threading, sys
                        def fib(n):
                            return n if n < 2 else fib(n - 1) + fib(n - 2)
                        def worker():
                            fib(18)
                        t = threading.Thread(target=worker, name="worker-1")
                        t.start()
                        fib(19)
                        t.join()
                        print("args", sys.argv[1:])
                        """
                },
            )
            out = root / "out"
            done = run_helper([str(HELPERS / "openidea_science_profile.py"), str(out), "work.py", "--flag"], root)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertIn("args ['--flag']", done.stdout)
            profiles = sorted(out.glob("*.cpuprofile"))
            self.assertTrue(profiles)
            names = set()
            for path in profiles:
                data = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(len(data["samples"]), len(data["timeDeltas"]))
                ids = {n["id"] for n in data["nodes"]}
                self.assertTrue(all(c in ids for n in data["nodes"] for c in n.get("children", [])))
                names |= {n["callFrame"]["functionName"] for n in data["nodes"]}
            self.assertIn("fib", names)
            self.assertIn("worker", names)
            self.assertNotIn("run_path", names, "runpy's frames are left out")

    def test_captures_matplotlib_figures(self):
        try:
            import matplotlib  # noqa: F401
        except ImportError:
            self.skipTest("Matplotlib isn't installed")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            write(
                root,
                {
                    "plot.py": """
                        import matplotlib.pyplot as plt
                        plt.plot([1, 2, 3]); plt.title("Line"); plt.show()
                        plt.figure(); plt.bar(["a"], [1])
                        """
                },
            )
            plots = root / "plots"
            env = {"MPLBACKEND": "module://openidea_mpl_backend", "OPENIDEA_PLOTS_DIR": str(plots), "PYTHONPATH": str(HELPERS)}
            done = run_helper(["plot.py"], root, env=env)
            self.assertEqual(done.returncode, 0, done.stderr)
            entries = [json.loads(l) for l in (plots / "plots.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual([(e["title"], e["reason"]) for e in entries], [("Line", "show"), ("", "exit")])
            self.assertTrue(all((plots / e["file"]).is_file() for e in entries))


if __name__ == "__main__":
    unittest.main()
