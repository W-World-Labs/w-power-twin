#!/usr/bin/env python3
"""Download the assets, models and datasets listed in data/sources.json into assets/.

Only entries with "fetch": true are downloaded unless --id selects others.
Existing files are kept. A lock file records size and SHA256 per item.
Sketchfab models use the API when SKETCHFAB_API_TOKEN is set; otherwise they
come as GLB from the Objaverse mirror on Hugging Face ("objaverse" path).
Models with neither are reported as pending and do not fail the run.
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "data" / "sources.json"
ASSETS = ROOT / "assets"
LOCK = ASSETS / "sources.lock.json"
TIMEOUT_S = 60
ATTEMPTS = 3
USER_AGENT = "w-power-twin-fetch/1"
OBJAVERSE = "https://huggingface.co/datasets/allenai/objaverse/resolve/main/"


class Pending(Exception):
    pass


def request(url: str, headers: dict | None = None) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})


def get_json(url: str, headers: dict | None = None) -> dict:
    last_error = None
    for _ in range(ATTEMPTS):
        try:
            with urllib.request.urlopen(request(url, headers), timeout=TIMEOUT_S) as resp:
                return json.load(resp)
        except OSError as exc:
            last_error = exc
    raise RuntimeError(f"{url}: {last_error}")


def download(url: str, dest: Path, md5: str | None = None) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    last_error = None
    for _ in range(ATTEMPTS):
        try:
            with urllib.request.urlopen(request(url), timeout=TIMEOUT_S) as resp, tmp.open("wb") as out:
                while chunk := resp.read(1 << 20):
                    out.write(chunk)
            if md5 and digest(tmp, "md5") != md5:
                raise OSError("md5 mismatch")
            tmp.replace(dest)
            return
        except OSError as exc:
            last_error = exc
    tmp.unlink(missing_ok=True)
    raise RuntimeError(f"{url}: {last_error}")


def digest(path: Path, algo: str) -> str:
    h = hashlib.new(algo)
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def tree_digest(root: Path) -> tuple[int, str]:
    h = hashlib.sha256()
    total = 0
    for f in sorted(p for p in root.rglob("*") if p.is_file()):
        total += f.stat().st_size
        h.update(str(f.relative_to(root)).encode())
        h.update(digest(f, "sha256").encode())
    return total, h.hexdigest()


def fetch_polyhaven_model(item: dict, target: Path) -> None:
    gltf = get_json(f"https://api.polyhaven.com/files/{item['ref']}")["gltf"]["1k"]["gltf"]
    for rel, inc in gltf.get("include", {}).items():
        download(inc["url"], target / rel, inc.get("md5"))
    download(gltf["url"], target / f"{item['ref']}.gltf", gltf.get("md5"))


def fetch_sketchfab_model(item: dict, target: Path) -> None:
    token = os.environ.get("SKETCHFAB_API_TOKEN")
    if not token:
        if not item.get("objaverse"):
            raise Pending("not mirrored; needs SKETCHFAB_API_TOKEN")
        download(OBJAVERSE + item["objaverse"], target / "model.glb")
        return
    info = get_json(
        f"https://api.sketchfab.com/v3/models/{item['ref']}/download",
        {"Authorization": f"Token {token}"},
    )
    archive = target.with_suffix(".zip")
    download(info["gltf"]["url"], archive)
    with zipfile.ZipFile(archive) as z:
        z.extractall(target)
    archive.unlink()


def fetch_file(item: dict, target: Path) -> Path:
    is_zip_dir = item["url"].endswith(".zip") and target.suffix == ""
    archive = target.with_suffix(".zip") if is_zip_dir else target
    download(item["url"], archive, item.get("md5"))
    if is_zip_dir:
        with zipfile.ZipFile(archive) as z:
            z.extractall(target)
    return archive


def fetch(item: dict, lock: dict) -> None:
    target = ASSETS / item["path"]
    provider = item.get("provider")
    is_dir = provider is not None or (item["url"].endswith(".zip") and target.suffix == "")
    if (target.is_dir() and any(target.iterdir())) if is_dir else target.is_file():
        print(f"keep  {item['id']}")
    else:
        print(f"fetch {item['id']}")
        if provider == "polyhaven":
            fetch_polyhaven_model(item, target)
        elif provider == "sketchfab":
            fetch_sketchfab_model(item, target)
        else:
            fetch_file(item, target)

    entry = {"licence": item["licence"], "source": item.get("page") or item.get("url")}
    if item.get("author"):
        entry["author"] = item["author"]
    if provider is None and not is_dir:
        entry.update(path=item["path"], bytes=target.stat().st_size, sha256=digest(target, "sha256"))
    elif provider is None:
        archive = target.with_suffix(".zip")
        entry.update(path=str(archive.relative_to(ASSETS)), bytes=archive.stat().st_size, sha256=digest(archive, "sha256"))
    else:
        total, tree = tree_digest(target)
        entry.update(path=item["path"], bytes=total, tree_sha256=tree)
    lock[item["id"]] = entry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", action="append", help="fetch only these ids (repeatable)")
    args = parser.parse_args()

    sources = json.loads(SOURCES.read_text())
    items = sources["assets"] + sources.get("models", []) + sources["datasets"]
    if args.id:
        items = [i for i in items if i["id"] in args.id]
        missing = set(args.id) - {i["id"] for i in items}
        if missing:
            print(f"unknown ids: {', '.join(sorted(missing))}", file=sys.stderr)
            return 2
    else:
        items = [i for i in items if i.get("fetch")]

    lock = json.loads(LOCK.read_text()) if LOCK.is_file() else {}
    failures, pending = [], []
    for item in items:
        try:
            fetch(item, lock)
        except Pending as exc:
            pending.append(item["id"])
            print(f"wait  {item['id']}: {exc}")
        except Exception as exc:  # report every failure, keep going
            failures.append(item["id"])
            print(f"FAIL  {item['id']}: {exc}", file=sys.stderr)
    ASSETS.mkdir(exist_ok=True)
    LOCK.write_text(json.dumps(lock, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    print(f"done: {len(lock)} locked, {len(pending)} pending, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
