# Bundled TOML schemas

JSON schemas for `pyproject.toml`, `uv.toml` and `ruff.toml` / `.ruff.toml`, from PyIdea's TOML
Workbench. They give taplo completion, hover documentation and diagnostics without network access
(`src/features/toml-workbench`, `ide_pyidea::toml::schemas`).

`sources.json` records each file's upstream URL at a pinned revision, the upstream file's SHA-256 and
the SHA-256 of the file as committed here (PyIdea's adaptation, formatted by the repository's
formatter; the JSON content is PyIdea's). `pyproject.json` composes the others with relative `$ref`s;
the IDE writes a self-contained copy for taplo, whose hover and completion don't follow references to
other files.

| File                           | Upstream                                                                | License                                                                     |
| ------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `uv.json`                      | [astral-sh/uv](https://github.com/astral-sh/uv)                         | MIT (`uv-LICENSE-MIT.txt`)                                                  |
| `ruff.json`                    | [astral-sh/ruff](https://github.com/astral-sh/ruff)                     | MIT (`ruff-LICENSE.txt`)                                                    |
| `pyproject.json`               | [validate-pyproject](https://github.com/abravalheri/validate-pyproject) | MPL-2.0 (`validate-pyproject-LICENSE.txt`, `validate-pyproject-NOTICE.txt`) |
| `project_metadata.schema.json` | [validate-pyproject](https://github.com/abravalheri/validate-pyproject) | MPL-2.0 (`validate-pyproject-LICENSE.txt`, `validate-pyproject-NOTICE.txt`) |
