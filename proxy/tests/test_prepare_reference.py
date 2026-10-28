import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "prepare-reference.py"
spec = importlib.util.spec_from_file_location("prepare_reference", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrepareReferenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.upstream = self.root / "upstream"
        self.upstream.mkdir()
        self.git("init", "-b", "fixture")
        self.git("config", "user.name", "Local Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "core.autocrlf", "false")
        (self.upstream / "LICENSE").write_bytes(b"Fixture license\n")
        (self.upstream / "source.txt").write_text("first\n")
        self.git("add", ".")
        self.git("commit", "-m", "First fixture revision")
        self.first = self.git("rev-parse", "HEAD").strip()
        (self.upstream / "source.txt").write_text("second\n")
        self.git("commit", "-am", "Second fixture revision")
        self.second = self.git("rev-parse", "HEAD").strip()
        self.lock = self.root / "lock.json"
        self.destination = self.root / "reference"
        self.write_lock()

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.upstream, check=True,
                              text=True, capture_output=True).stdout

    def write_lock(self, **overrides):
        self.lock.write_text(json.dumps({
            "repository": str(self.upstream), "commit": self.first,
            "license_sha256": hashlib.sha256((self.upstream / "LICENSE").read_bytes()).hexdigest(),
            "submodules": [], **overrides,
        }))

    def test_checks_out_exact_locked_commit(self):
        # Following the mutable branch would incorrectly return the second revision.
        self.assertNotEqual(self.first, self.second)
        self.assertEqual(module.prepare_reference(self.lock, self.destination), self.first)
        self.assertEqual((self.destination / "source.txt").read_text(), "first\n")

    def test_repeat_prepare_preserves_same_commit(self):
        module.prepare_reference(self.lock, self.destination)
        self.assertEqual(module.prepare_reference(self.lock, self.destination), self.first)
        self.assertEqual((self.destination / "source.txt").read_text(), "first\n")

    def test_rejects_dirty_or_wrong_destination(self):
        module.prepare_reference(self.lock, self.destination)
        (self.destination / "source.txt").write_text("user work\n")
        with self.assertRaisesRegex(ValueError, "dirty"):
            module.prepare_reference(self.lock, self.destination)
        self.assertEqual((self.destination / "source.txt").read_text(), "user work\n")
        other = self.root / "unrelated"
        other.mkdir()
        (other / "keep.txt").write_text("keep\n")
        with self.assertRaises(ValueError):
            module.prepare_reference(self.lock, other)
        self.assertEqual((other / "keep.txt").read_text(), "keep\n")

    def test_rejects_unpinned_revision(self):
        for revision in ["develop", "HEAD", self.first[:7], "-bad-option"]:
            self.write_lock(commit=revision)
            with self.assertRaisesRegex(ValueError, "commit"):
                module.prepare_reference(self.lock, self.destination)
        self.assertFalse(self.destination.exists())

    def test_rejects_wrong_repository_without_changing_checkout(self):
        module.prepare_reference(self.lock, self.destination)
        self.write_lock(repository=str(self.root / "another-repository"))
        with self.assertRaisesRegex(ValueError, "repository"):
            module.prepare_reference(self.lock, self.destination)
        self.assertEqual((self.destination / "source.txt").read_text(), "first\n")

    def test_rejects_license_mismatch(self):
        self.write_lock(license_sha256="0" * 64)
        with self.assertRaisesRegex(ValueError, "license"):
            module.prepare_reference(self.lock, self.destination)

    def test_license_verification_accepts_platform_checkout_line_endings(self):
        (self.upstream / ".gitattributes").write_text("LICENSE text eol=crlf\n")
        self.git("add", ".gitattributes")
        self.git("commit", "-m", "Use Windows checkout line endings for the fixture license")
        self.first = self.git("rev-parse", "HEAD").strip()
        self.write_lock()
        self.assertEqual(module.prepare_reference(self.lock, self.destination), self.first)
        self.assertEqual((self.destination / "LICENSE").read_bytes(), b"Fixture license\r\n")


if __name__ == "__main__":
    unittest.main()
