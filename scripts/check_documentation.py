"""Check documentation presence for owned source/configuration files without executing the app.

Python ASTs identify modules/classes/functions; the installed TypeScript parser covers
named JS/TS contracts. JSON/generated/binary files are explained in FILE_GUIDE_FR.md.
This validates coverage, not the truth of prose: technical accuracy still needs review.
"""

import argparse
import ast
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IGNORED = {
    ".git", ".venv", "node_modules", "dist", "dist-ssr", ".output", ".tanstack",
    "data", "logs", "backups", "test-results", "playwright-report", "__pycache__",
    ".pytest_cache", ".ruff_cache", ".mypy_cache", ".nitro", ".vinxi",
    "htmlcov", "certs", "uploads", ".chroma", ".idea", ".vscode", "venv",
    "learn-serve-main", "supportdeflect-ai",
}
JS_EXTENSIONS = {".js", ".mjs", ".ts", ".tsx"}
JSON_FILENAMES = {".prettierrc"}
GENERATED = {"frontend/src/routeTree.gen.ts"}


def owned_files(root: Path):
    """Yield maintained files while excluding known private/runtime/dependency paths.

    Only public *.example environment templates are included. The generated route
    remains in the inventory but is excluded from manual inline edits. This filter
    is a documentation scope, not a secret scanner or a replacement for Git review.
    """
    for directory, children, files in os.walk(root):
        children[:] = sorted(name for name in children if name not in IGNORED)
        for name in sorted(files):
            if (
                (name.startswith(".env") and not name.endswith(".example"))
                or name.endswith(".env") or name.startswith(".coverage")
                or name.endswith((".local", ".pyc", ".db", ".sqlite", ".db-shm", ".db-wal", ".tsbuildinfo"))
                or name in {"supportdeflect-worker-heartbeat", "supportdeflect-mailer-heartbeat"}
            ):
                continue
            yield Path(directory) / name


def python_documentation(path: Path) -> tuple[int, list[str]]:
    """Count every named Python contract and report absent module/declaration docstrings.

    Nested helpers are included; expressions/lambdas belong to their documented
    enclosing workflow because they cannot carry a true Python function docstring.
    """
    tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
    missing = []
    if ast.get_docstring(tree) is None:
        missing.append("1:<module>")
    declarations = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            declarations += 1
            if ast.get_docstring(node) is None:
                missing.append(f"{node.lineno}:{node.name}")
    return declarations, missing


def needs_hash_header(path: Path) -> bool:
    """Identify maintained shell/env/infra/config formats that safely accept # comments."""
    return (
        path.suffix in {".sh", ".yml", ".yaml", ".toml", ".ini"}
        or path.name in {"Dockerfile", ".gitignore", ".dockerignore", ".gitattributes", ".prettierignore"}
        or path.name.startswith(".env.")
        or path.name.startswith("requirements")
    )


def check_sources(paths: list[Path], node: str) -> dict:
    """Validate owned source headers/declarations and adjacent inventory entries.

    The Node subprocess parses source only; it never starts the frontend or fetches
    a provider. Missing tool prerequisites fail explicitly instead of being silently
    counted as documented coverage. Pass the filtered owned_files list as paths.
    """
    guide = (ROOT / "docs/FILE_GUIDE_FR.md").read_text(encoding="utf-8")
    failures = []
    js_paths = []
    python_count = 0
    for path in paths:
        relative = path.relative_to(ROOT).as_posix()
        if f"`{relative}`" not in guide:
            failures.append(f"{relative}: inventory explanation missing")
        if relative in GENERATED:
            continue
        if path.suffix == ".py":
            count, missing = python_documentation(path)
            python_count += count
            failures.extend(f"{relative}:{item}: missing docstring" for item in missing)
        elif path.suffix in JS_EXTENSIONS:
            js_paths.append(relative)
        elif relative == "frontend/tsconfig.json":
            # TypeScript configuration is JSONC: its compiler accepts existing comments.
            js_paths.append(relative)
        elif path.suffix == ".json" or path.name in JSON_FILENAMES:
            # JSON grammar forbids comments; parsing plus adjacent prose is intentional.
            json.loads(path.read_text(encoding="utf-8"))
        elif needs_hash_header(path):
            text = path.read_text(encoding="utf-8-sig")
            lines = [line for line in text.splitlines()[:12] if not line.startswith("#!")]
            if not any(line.lstrip().startswith("#") for line in lines):
                failures.append(f"{relative}: explanatory header missing")
        elif path.suffix == ".css":
            if not path.read_text(encoding="utf-8-sig").lstrip().startswith("/*"):
                failures.append(f"{relative}: CSS module header missing")
        elif path.suffix == ".html":
            if "<!--" not in path.read_text(encoding="utf-8-sig")[:1000]:
                failures.append(f"{relative}: HTML purpose comment missing")
        elif path.suffix == ".bat":
            if not re.search(r"(?im)^\s*(?:@?rem\s|::)", path.read_text(encoding="utf-8-sig")[:1000]):
                failures.append(f"{relative}: launcher purpose comment missing")
    result = subprocess.run(
        [node, str(ROOT / "scripts/check_documentation.mjs")], input=json.dumps(js_paths),
        cwd=ROOT, text=True, capture_output=True, check=True, timeout=60,
    )
    js_results = json.loads(result.stdout)
    for item in js_results:
        failures.extend(
            f"{item['file']}:{missing['line']}:{missing['name']}: missing comment"
            for missing in item["missing"]
        )
    return {
        "files": len(paths), "python_declarations": python_count,
        "javascript_typescript_declarations": sum(item["declarations"] for item in js_results),
        "missing": failures,
    }


def main() -> int:
    """Run the read-only checker and return nonzero when coverage or prerequisites fail."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--node", default=shutil.which("node"), help="Node executable with access to installed TypeScript"
    )
    parser.add_argument("--json", action="store_true", help="Emit the complete machine-readable coverage result")
    args = parser.parse_args()
    if not args.node:
        parser.error("Node is required; install frontend dependencies and provide --node when necessary")
    result = check_sources(list(owned_files(ROOT)), args.node)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Owned files: {result['files']}; Python declarations: {result['python_declarations']}; "
              f"JS/TS declarations: {result['javascript_typescript_declarations']}")
        print("\n".join(result["missing"]) if result["missing"] else "Documentation presence checks passed.")
    return 1 if result["missing"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
