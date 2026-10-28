"""Prepare an exact, clean upstream checkout without shared GitHub credentials."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
from urllib.parse import urlsplit


def git(directory, *args, binary=False):
    environment = os.environ.copy()
    environment.update(GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never")
    result = subprocess.run(
        ["git", "-c", "credential.helper=", "-c", "core.askPass=",
         "-c", "core.autocrlf=false", *args], cwd=directory,
        env=environment, capture_output=True, text=not binary,
    )
    if result.returncode:
        raise ValueError(f"Git {args[0]} failed; no existing work was overwritten.")
    return result.stdout if binary else result.stdout.strip()


def validate_repository(repository):
    if not isinstance(repository, str) or not repository:
        raise ValueError("A repository URL or local fixture path is required.")
    if Path(repository).is_absolute():
        if repository.startswith("\\\\") or not Path(repository).is_dir():
            raise ValueError("A local fixture repository must be an existing local directory.")
        return
    parsed = urlsplit(repository)
    if parsed.scheme:
        if parsed.scheme != "https" or parsed.hostname != "github.com" or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Only unauthenticated HTTPS GitHub repository URLs are supported.")
    else:
        raise ValueError("A local fixture repository must be an existing absolute directory.")


def validate_lock(lock):
    validate_repository(lock.get("repository"))
    if not re.fullmatch(r"[0-9a-f]{40}", str(lock.get("commit", ""))):
        raise ValueError("The commit must be a full lowercase 40-character SHA.")
    if not re.fullmatch(r"[0-9a-f]{64}", str(lock.get("license_sha256", ""))):
        raise ValueError("The license SHA-256 must be recorded.")
    if not isinstance(lock.get("submodules"), list):
        raise ValueError("The submodule revision list must be recorded.")
    paths = set()
    for submodule in lock["submodules"]:
        path = submodule.get("path", "")
        parts = PurePosixPath(path).parts
        if not parts or PurePosixPath(path).is_absolute() or any(part in (".", "..", ".git") for part in parts) or "\\" in path or ":" in path or path in paths:
            raise ValueError("Invalid or duplicate submodule path.")
        paths.add(path)
        validate_repository(submodule.get("repository"))
        if not re.fullmatch(r"[0-9a-f]{40}", str(submodule.get("commit", ""))):
            raise ValueError("Each submodule commit must be pinned.")


def verify_checkout(root, lock):
    if git(root, "remote", "get-url", "origin") != lock["repository"]:
        raise ValueError("The destination belongs to a different repository.")
    if git(root, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("The destination is dirty; preserve local work before preparing it.")
    if git(root, "rev-parse", "HEAD") != lock["commit"]:
        raise ValueError("The destination has a different commit; use a new isolated folder.")
    license_path = root / "LICENSE"
    license_blob = git(root, "show", f"{lock['commit']}:LICENSE", binary=True)
    if not license_path.is_file() or hashlib.sha256(license_blob).hexdigest() != lock["license_sha256"]:
        raise ValueError("The upstream license does not match the lock.")
    actual = {}
    for line in git(root, "ls-tree", "-r", lock["commit"]).splitlines():
        metadata, path = line.split("\t", 1)
        mode, _, revision = metadata.split()
        if mode == "160000":
            actual[path] = revision
    expected = {submodule["path"]: submodule["commit"] for submodule in lock["submodules"]}
    if actual != expected:
        raise ValueError("The source submodule revisions do not match the lock.")
    for submodule in lock["submodules"]:
        directory = root / submodule["path"]
        if directory.is_symlink() or not (directory / ".git").is_dir():
            raise ValueError("A locked submodule is missing or is a symlink.")
        if git(directory, "remote", "get-url", "origin") != submodule["repository"] or git(directory, "rev-parse", "HEAD") != submodule["commit"]:
            raise ValueError("A submodule repository or revision does not match the lock.")
        if git(directory, "status", "--porcelain", "--untracked-files=all"):
            raise ValueError("A submodule is dirty; preserve local work.")


def fetch_checkout(repository, commit, destination):
    destination.mkdir(parents=True, exist_ok=False)
    git(destination, "init", "-q")
    git(destination, "remote", "add", "origin", repository)
    git(destination, "fetch", "--depth", "1", "origin", commit)
    git(destination, "checkout", "--detach", commit)


def prepare_reference(lock_path: Path, destination: Path) -> str:
    lock = json.loads(Path(lock_path).read_text(encoding="utf-8"))
    validate_lock(lock)
    destination = Path(destination).absolute()
    if destination.is_symlink():
        raise ValueError("A reference destination must not be a symlink.")
    if destination.exists():
        if not (destination / ".git").is_dir():
            raise ValueError("The destination is not a dedicated reference repository.")
        verify_checkout(destination, lock)
        return lock["commit"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".prepare-reference-", dir=destination.parent) as temporary:
        staging = Path(temporary) / "reference"
        fetch_checkout(lock["repository"], lock["commit"], staging)
        for submodule in lock["submodules"]:
            directory = staging / submodule["path"]
            # Git creates an empty gitlink directory; remove only that empty directory.
            if directory.exists():
                directory.rmdir()
            fetch_checkout(submodule["repository"], submodule["commit"], directory)
        verify_checkout(staging, lock)
        staging.rename(destination)
    return lock["commit"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(prepare_reference(args.lock, args.destination))
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"Reference preparation failed: {error}\n")
