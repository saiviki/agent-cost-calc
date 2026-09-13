#!/usr/bin/env python3
"""Publish one small derived receipt with a non-force Git compare-and-swap."""
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

BRANCH = "mc-build-production-status"
MAX_SUMMARY_BYTES = 262144


def git(*args, data=None, allow_failure=False):
    result = subprocess.run(["git", *args], input=data, capture_output=True, timeout=30)
    if result.returncode and not allow_failure:
        raise RuntimeError(f"Status publication failed at git {args[0]}; previous receipt preserved")
    return result


def failure_summary():
    return {
        "producedAt": datetime.now(timezone.utc).isoformat(), "imported": [], "jobsRun": 0, "jobs": [],
        "cadenceEnabled": os.environ.get("BUILD_SERVICE_ENABLED") == "true",
        "syncErrors": [{"repository": "saiviki/agent-cost-calc", "error": "Hosted workflow stopped before producing a valid receipt; inspect the run."}],
        "runUrl": f"https://github.com/saiviki/agent-cost-calc/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    }


def load_receipt(source):
    try:
        raw = source.read_bytes()
        if len(raw) > MAX_SUMMARY_BYTES:
            raise ValueError("summary exceeds public receipt bound")
        parsed = json.loads(raw)
        if not isinstance(parsed, dict) or not isinstance(parsed.get("jobs"), list) or not parsed.get("producedAt"):
            raise ValueError("summary has no dispatcher receipt")
        return raw, parsed
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        parsed = failure_summary()
        raw = (json.dumps(parsed, indent=2) + "\n").encode()
        source.write_bytes(raw)
        return raw, parsed


def publish():
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("GITHUB_REPOSITORY") != "saiviki/agent-cost-calc":
        raise RuntimeError("Expected the approved GitHub workflow host")
    source = Path("operator-summary.json")
    raw, parsed = load_receipt(source)
    os.environ.update({"GIT_AUTHOR_NAME": "Mission Control", "GIT_AUTHOR_EMAIL": "mission-control@users.noreply.github.com",
                       "GIT_COMMITTER_NAME": "Mission Control", "GIT_COMMITTER_EMAIL": "mission-control@users.noreply.github.com"})
    blob = git("hash-object", "-w", "--stdin", data=raw).stdout.decode().strip()
    tree = git("mktree", data=f"100644 blob {blob}\toperator-summary.json\n".encode()).stdout.decode().strip()
    ref = f"refs/heads/{BRANCH}"
    for _ in range(3):
        remote = git("ls-remote", "--exit-code", "origin", ref, allow_failure=True)
        if remote.returncode not in (0, 2):
            raise RuntimeError("Cannot read status branch; check GitHub connectivity/access")
        head = remote.stdout.decode().split()[0] if remote.returncode == 0 else None
        if head:
            git("fetch", "--quiet", "--no-tags", "origin", head)
            old = json.loads(git("show", f"{head}:operator-summary.json").stdout)
            parse_time = lambda value: datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parse_time(old["producedAt"]) > parse_time(parsed["producedAt"]):
                raise RuntimeError("Refusing to replace a newer hosted receipt")
        commit = git("commit-tree", tree, *(["-p", head] if head else []), "-m", "build-status: operator receipt").stdout.decode().strip()
        if git("push", "--porcelain", "origin", f"{commit}:{ref}", allow_failure=True).returncode == 0:
            print(f"Published operator summary to {BRANCH}")
            return
    raise RuntimeError("Status publication lost three compare-and-swap races; previous receipt retained")


if __name__ == "__main__":
    publish()
