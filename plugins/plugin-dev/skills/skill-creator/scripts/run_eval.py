#!/usr/bin/env python3
"""Score skill triggering from DSH subagent session logs.

A skill load is an ordinary tool call recorded in the subagent's persisted
session log:

    {"type": "tool/call", "data": {"name": "skill",
                                   "arguments": "{\\"name\\":\\"my-skill\\"}"}}

So triggering is *observed*, not asked for. The agent spawns one subagent per
query — Python cannot spawn them — and binds the returned session ids here; this
script does the deterministic part: reading logs, detecting the call, and
aggregating a confusion matrix.

Typical use:

    # 1. split the eval set once, so description tuning never sees the test half
    python -m scripts.run_eval split evals/trigger-eval.json --out eval-run --skill my-skill

    # 2. the agent spawns a subagent per query, then binds each session id
    python -m scripts.run_eval bind eval-run/train-runs.json --query 3 --session <id>

    # 3. score
    python -m scripts.run_eval score eval-run/train-runs.json --json eval-run/train-report.json

Session logs live at $DSH_HOME/sessions/<workspace>/<session>/session.v*.jsonl[.zstd];
the session id is searched across every workspace directory.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import random
import subprocess
import sys

ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"


def dsh_home() -> pathlib.Path:
    return pathlib.Path(os.environ.get("DSH_HOME", pathlib.Path.home() / ".dsh"))


def read_session(session_id: str) -> tuple[list[dict], str | None]:
    """Return (events, error) for one session id, searching every workspace."""
    root = dsh_home() / "sessions"
    if not root.is_dir():
        return [], f"no sessions directory at {root}"
    matches = sorted(root.glob(f"*/{session_id}"))
    if not matches:
        return [], f"no session directory for {session_id} under {root}"
    logs = sorted(p for p in matches[0].iterdir()
                  if p.name.startswith("session.") and ".jsonl" in p.name)
    if not logs:
        return [], f"no session log in {matches[0]}"

    raw = logs[-1].read_bytes()
    if raw[:4] == ZSTD_MAGIC:
        proc = subprocess.run(["zstd", "-dc", str(logs[-1])],
                              capture_output=True, check=False)
        if proc.returncode != 0:
            return [], f"zstd failed for {logs[-1]}: {proc.stderr.decode()[:200]}"
        raw = proc.stdout

    events = []
    for line in raw.decode("utf-8", "replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events, None


def skill_calls(events: list[dict]) -> list[dict]:
    """Every `skill` tool call in order, with its parsed argument."""
    found = []
    for e in events:
        if e.get("type") != "tool/call":
            continue
        d = e.get("data") or {}
        if d.get("name") != "skill":
            continue
        args = d.get("arguments")
        parsed = None
        if isinstance(args, str):
            try:
                parsed = json.loads(args)
            except json.JSONDecodeError:
                parsed = None
        elif isinstance(args, dict):
            parsed = args
        found.append({"turn": d.get("turn"), "step": d.get("step"),
                      "time": e.get("time"), "name": (parsed or {}).get("name")})
    return found


def is_triggered(events: list[dict], skill: str) -> tuple[bool, dict | None]:
    for call in skill_calls(events):
        if call["name"] == skill:
            return True, call
    return False, None


def session_cost(events: list[dict]) -> dict:
    """Wall duration and summed per-request usage for one run."""
    times = [e.get("time") for e in events if isinstance(e.get("time"), (int, float))]
    tokens = sum(((e.get("data") or {}).get("usage") or {}).get("totalTokens", 0) or 0
                 for e in events if e.get("type") == "assistant/message")
    return {
        "seconds": round((max(times) - min(times)) / 1000, 1) if times else None,
        "total_tokens": tokens,
        "tool_calls": sum(1 for e in events if e.get("type") == "tool/call"),
    }


def _load(path: str) -> dict | list:
    return json.loads(pathlib.Path(path).read_text())


def _save(path: str, data: object) -> None:
    pathlib.Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2))


def split_eval_set(items: list[dict], holdout: float, seed: int = 42) -> tuple[list[dict], list[dict]]:
    """Split an eval set into (train, test), stratified by should_trigger.

    Stratifying keeps both halves carrying positives and negatives, which is what
    makes the held-out score meaningful for a binary trigger decision.
    """
    rng = random.Random(seed)
    positives = [q for q in items if q.get("should_trigger")]
    negatives = [q for q in items if not q.get("should_trigger")]
    rng.shuffle(positives)
    rng.shuffle(negatives)
    n_p = max(1, round(len(positives) * holdout))
    n_n = max(1, round(len(negatives) * holdout))
    return positives[n_p:] + negatives[n_n:], positives[:n_p] + negatives[:n_n]


def _write_split(out: pathlib.Path, label: str, group: list[dict],
                 skill: str | None, threshold: float) -> None:
    group = sorted(group, key=lambda q: q["id"])
    _save(str(out / f"{label}-eval-set.json"),
          [{"id": q["id"], "query": q["query"],
            "should_trigger": bool(q["should_trigger"])} for q in group])
    _save(str(out / f"{label}-runs.json"),
          {"skill": skill, "threshold": threshold,
           "queries": [{"id": q["id"], "query": q["query"],
                        "should_trigger": bool(q["should_trigger"]), "sessions": []}
                       for q in group]})


def cmd_split(args: argparse.Namespace) -> int:
    items = _load(args.eval_set)
    train, test = split_eval_set(items, holdout=1 - args.ratio, seed=args.seed)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    _write_split(out, "train", train, args.skill, args.threshold)
    _write_split(out, "test", test, args.skill, args.threshold)

    def counts(group: list[dict]) -> dict:
        return {"positives": sum(1 for q in group if q["should_trigger"]),
                "negatives": sum(1 for q in group if not q["should_trigger"])}

    print(json.dumps({"out": str(out), "train": counts(train), "test": counts(test)},
                     ensure_ascii=False, indent=2))
    return 0


def cmd_bind(args: argparse.Namespace) -> int:
    data = _load(args.runs)
    for q in data["queries"]:
        if str(q["id"]) == str(args.query):
            if args.session not in q["sessions"]:
                q["sessions"].append(args.session)
            _save(args.runs, data)
            print(f"bound {args.session} to query {q['id']} "
                  f"({len(q['sessions'])} run(s))")
            return 0
    print(f"no query with id {args.query}", file=sys.stderr)
    return 1


def cmd_check(args: argparse.Namespace) -> int:
    events, err = read_session(args.session)
    if err:
        print(json.dumps({"session": args.session, "error": err}, ensure_ascii=False))
        return 1
    triggered, hit = is_triggered(events, args.skill)
    print(json.dumps({"session": args.session, "skill": args.skill,
                      "triggered": triggered, "first_hit": hit,
                      "all_skill_calls": skill_calls(events),
                      **session_cost(events)}, ensure_ascii=False, indent=2))
    return 0


def cmd_score(args: argparse.Namespace) -> int:
    data = _load(args.runs)
    skill = args.skill or data["skill"]
    threshold = args.threshold if args.threshold is not None else data.get("threshold", 0.5)

    rows, tp, tn, fp, fn = [], 0, 0, 0, 0
    seconds = tokens = 0
    for q in data["queries"]:
        hits, errors = 0, []
        for sid in q["sessions"]:
            events, err = read_session(sid)
            if err:
                errors.append({"session": sid, "error": err})
                continue
            cost = session_cost(events)
            seconds += cost["seconds"] or 0
            tokens += cost["total_tokens"]
            triggered, _ = is_triggered(events, skill)
            hits += 1 if triggered else 0
        total = len(q["sessions"]) - len(errors)
        rate = hits / total if total else 0.0
        predicted, expected = rate >= threshold, bool(q["should_trigger"])
        if total == 0:
            verdict = "no-data"
        elif predicted == expected:
            verdict = "ok"
            if expected:
                tp += 1
            else:
                tn += 1
        elif predicted:
            verdict = "FALSE POSITIVE"
            fp += 1
        else:
            verdict = "FALSE NEGATIVE"
            fn += 1
        rows.append({"id": q["id"], "query": q["query"], "should_trigger": expected,
                     "runs": total, "triggered": hits, "rate": round(rate, 3),
                     "verdict": verdict, "errors": errors})

    scored = [r for r in rows if r["verdict"] != "no-data"]
    report = {
        "skill": skill, "threshold": threshold,
        "runs_per_query": max((r["runs"] for r in rows), default=0),
        "queries": len(rows), "scored": len(scored), "correct": tp + tn,
        "accuracy": round((tp + tn) / len(scored), 4) if scored else None,
        "true_positive": tp, "true_negative": tn,
        "false_positive": fp, "false_negative": fn,
        "precision": round(tp / (tp + fp), 4) if (tp + fp) else None,
        "recall": round(tp / (tp + fn), 4) if (tp + fn) else None,
        "total_seconds": round(seconds, 1), "total_tokens": tokens,
        "failures": [r for r in rows if r["verdict"].startswith("FALSE")],
        "results": rows,
    }
    if args.json:
        _save(args.json, report)
    print(json.dumps({k: v for k, v in report.items() if k != "results"},
                     ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("split", help="split an eval set into train/test runs files")
    p.add_argument("eval_set")
    p.add_argument("--out", required=True)
    p.add_argument("--skill", default=None)
    p.add_argument("--ratio", type=float, default=0.6)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--threshold", type=float, default=0.5)
    p.set_defaults(func=cmd_split)

    p = sub.add_parser("bind", help="attach a spawned subagent session to a query")
    p.add_argument("runs")
    p.add_argument("--query", required=True)
    p.add_argument("--session", required=True)
    p.set_defaults(func=cmd_bind)

    p = sub.add_parser("check", help="inspect one session log")
    p.add_argument("session")
    p.add_argument("--skill", required=True)
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("score", help="aggregate trigger rates and the confusion matrix")
    p.add_argument("runs")
    p.add_argument("--skill", default=None)
    p.add_argument("--threshold", type=float, default=None)
    p.add_argument("--json", default=None)
    p.set_defaults(func=cmd_score)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
