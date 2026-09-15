import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("publisher", Path(__file__).with_name("publish-build-summary.py"))
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)


def command(*args, cwd=None):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@contextmanager
def environment(root):
    previous_cwd = Path.cwd()
    previous = dict(os.environ)
    os.chdir(root)
    os.environ.update({
        "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "saiviki/agent-cost-calc",
        "GITHUB_RUN_ID": "123", "BUILD_SERVICE_ENABLED": "false",
    })
    try:
        yield
    finally:
        os.chdir(previous_cwd)
        os.environ.clear()
        os.environ.update(previous)


class PublisherIntegrationTests(unittest.TestCase):
    def test_local_bare_remote_cas_and_failure_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / "remote.git"
            checkout = root / "checkout"
            command("git", "init", "--bare", str(remote))
            command("git", "init", str(checkout))
            command("git", "remote", "add", "origin", str(remote), cwd=checkout)
            with environment(checkout):
                # Missing dispatcher output becomes a bounded public failure receipt.
                publisher.publish()
                command("git", "fetch", "origin", "mc-build-production-status", cwd=checkout)
                first = json.loads(command("git", "show", "FETCH_HEAD:operator-summary.json", cwd=checkout))
                self.assertEqual(first["jobs"], [])
                self.assertEqual(len(first["syncErrors"]), 1)
                self.assertNotIn(str(root), json.dumps(first))

                newer = {
                    "producedAt": (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat(),
                    "imported": [], "jobsRun": 0, "jobs": [], "syncErrors": [],
                }
                (checkout / "operator-summary.json").write_text(json.dumps(newer))
                publisher.publish()
                command("git", "fetch", "origin", "mc-build-production-status", cwd=checkout)
                self.assertEqual(json.loads(command("git", "show", "FETCH_HEAD:operator-summary.json", cwd=checkout))["syncErrors"], [])

                older = {**newer, "producedAt": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), "syncErrors": [{"error": "old"}]}
                (checkout / "operator-summary.json").write_text(json.dumps(older))
                with self.assertRaisesRegex(RuntimeError, "newer hosted receipt"):
                    publisher.publish()
                command("git", "fetch", "origin", "mc-build-production-status", cwd=checkout)
                self.assertEqual(json.loads(command("git", "show", "FETCH_HEAD:operator-summary.json", cwd=checkout))["syncErrors"], [])

    def test_malformed_or_oversized_local_output_becomes_generic_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with environment(root):
                source = root / "operator-summary.json"
                source.write_text("{" + "secret" * 50000)
                raw, parsed = publisher.load_receipt(source)
                self.assertLessEqual(len(raw), publisher.MAX_SUMMARY_BYTES)
                self.assertEqual(len(parsed["syncErrors"]), 1)
                self.assertNotIn("secret", raw.decode())


if __name__ == "__main__":
    unittest.main()
