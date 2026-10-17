#!/usr/bin/env python3
"""Track a description-optimization loop that the agent drives.

A Python process cannot spawn subagents, so the loop is split:

  * the agent spawns one subagent per query and binds the session ids
    (`run_eval.py bind`), then scores the round (`run_eval.py score`);
  * the agent writes the next description (`improve_description.py prompt` →
    the agent answers → `improve_description.py accept`);
  * this script keeps the state: which attempts were made, at what scores, and
    which one wins by held-out test score.

State lives in `<workspace>/state.json` and keeps the field names that
`generate_report.py` renders, so the HTML report still works.

    python -m scripts.run_loop init loop/ --skill my-skill \\
        --skill-path ~/.agents/skills/my-skill --eval-set evals/trigger-eval.json
    python -m scripts.run_loop status loop/
    python -m scripts.run_loop record loop/ --iteration 0 \\
        --train-report loop/train-report.json --test-report loop/test-report.json
    python -m scripts.run_loop best loop/ --out loop/best-description.txt
    python -m scripts.run_loop report loop/ --out loop/report.html
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scripts.generate_report import generate_html
from scripts.run_eval import split_eval_set
from scripts.utils import parse_skill_md


def _state_path(workspace: str) -> Path:
    return Path(workspace) / "state.json"


def _load(workspace: str) -> dict:
    path = _state_path(workspace)
    if not path.exists():
        print(f"no state at {path}; run `init` first", file=sys.stderr)
        sys.exit(1)
    return json.loads(path.read_text())


def _save(workspace: str, state: dict) -> None:
    path = _state_path(workspace)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2))


def _rows(report: dict | None) -> list[dict]:
    """Project a run_eval report into the shape generate_report.py renders."""
    if not report:
        return []
    return [{"query": r["query"], "should_trigger": r["should_trigger"],
             "pass": r["verdict"] == "ok", "runs": r["runs"],
             "triggers": r["triggered"]}
            for r in report["results"]]


def _score(report: dict | None) -> tuple[int, int]:
    if not report:
        return 0, 0
    return report["correct"], report["scored"]


def cmd_init(args: argparse.Namespace) -> int:
    workspace = Path(args.workspace)
    workspace.mkdir(parents=True, exist_ok=True)
    items = json.loads(Path(args.eval_set).read_text())
    name, description, _ = parse_skill_md(Path(args.skill_path))

    train, test = split_eval_set(items, holdout=args.holdout, seed=args.seed)

    for label, group in (("train", train), ("test", test)):
        group = sorted(group, key=lambda q: q["id"])
        (workspace / f"{label}-eval-set.json").write_text(
            json.dumps(group, ensure_ascii=False, indent=2))
        (workspace / f"{label}-runs.json").write_text(json.dumps(
            {"skill": name, "threshold": args.threshold,
             "queries": [{"id": q["id"], "query": q["query"],
                          "should_trigger": bool(q["should_trigger"]), "sessions": []}
                         for q in group]}, ensure_ascii=False, indent=2))

    state = {
        "skill": name, "skill_path": str(Path(args.skill_path).resolve()),
        "eval_set": str(Path(args.eval_set).resolve()),
        "threshold": args.threshold, "holdout": args.holdout, "seed": args.seed,
        "train_size": len(train), "test_size": len(test),
        "original_description": description,
        "best_description": description, "best_score": 0.0,
        "best_train_score": None, "best_test_score": None,
        "iterations_run": 0, "history": [],
    }
    _save(args.workspace, state)
    print(json.dumps({
        "workspace": str(workspace), "skill": name, "threshold": args.threshold,
        "train": {"positives": len([q for q in train if q["should_trigger"]]),
                  "negatives": len([q for q in train if not q["should_trigger"]])},
        "test": {"positives": len([q for q in test if q["should_trigger"]]),
                 "negatives": len([q for q in test if not q["should_trigger"]])},
        "next": [
            "agent: spawn one subagent per train query, then `run_eval.py bind train-runs.json --query <id> --session <id>`",
            "then: `run_eval.py score train-runs.json --json train-report.json`",
            "then: `run_loop.py record <workspace> --iteration 0 --train-report train-report.json`",
        ],
    }, ensure_ascii=False, indent=2))
    return 0


def cmd_record(args: argparse.Namespace) -> int:
    state = _load(args.workspace)
    train = json.loads(Path(args.train_report).read_text())
    test = json.loads(Path(args.test_report).read_text()) if args.test_report else None
    description = (Path(args.description_file).read_text().strip()
                   if args.description_file else state["original_description"])

    tp, tt = _score(train)
    ep, et = _score(test)
    entry = {
        "iteration": args.iteration,
        "description": description,
        "train_results": _rows(train),
        "test_results": _rows(test),
        "train_passed": tp, "train_total": tt,
        "test_passed": ep if test else None, "test_total": et if test else None,
        # generate_report.py's summary path reads these two for the headline score
        "passed": ep if test else tp, "total": et if test else tt,
        "note": args.note,
    }
    state["history"] = [h for h in state["history"] if h["iteration"] != args.iteration] + [entry]
    state["history"].sort(key=lambda h: h["iteration"])
    state["iterations_run"] = len(state["history"])

    best = max(state["history"], key=lambda h: (
        (h["test_passed"] / h["test_total"]) if h.get("test_total") else 0.0,
        (h["train_passed"] / h["train_total"]) if h.get("train_total") else 0.0,
    ))
    state["best_description"] = best["description"]
    state["best_iteration"] = best["iteration"]
    state["best_train_score"] = round(best["train_passed"] / best["train_total"], 4) if best["train_total"] else 0.0
    state["best_test_score"] = round(best["test_passed"] / best["test_total"], 4) if best.get("test_total") else None
    state["best_score"] = state["best_test_score"] if state["best_test_score"] is not None else state["best_train_score"]
    if args.description_file:
        state["current_description"] = description
    _save(args.workspace, state)

    print(json.dumps({
        "iteration": entry["iteration"],
        "train": f"{tp}/{tt}", "test": f"{ep}/{et}" if test else None,
        "best_iteration": best["iteration"],
        "best_train": state["best_train_score"], "best_test": state["best_test_score"],
    }, ensure_ascii=False, indent=2))
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    state = _load(args.workspace)
    print(json.dumps({
        "skill": state["skill"],
        "iterations_run": state["iterations_run"],
        "best_iteration": state.get("best_iteration"),
        "best_train_score": state["best_train_score"],
        "best_test_score": state["best_test_score"],
        "history": [{"iteration": h["iteration"],
                     "train": f"{h['train_passed']}/{h['train_total']}",
                     "test": f"{h['test_passed']}/{h['test_total']}" if h.get("test_total") else None,
                     "chars": len(h["description"])} for h in state["history"]],
    }, ensure_ascii=False, indent=2))
    return 0


def cmd_best(args: argparse.Namespace) -> int:
    state = _load(args.workspace)
    if args.out:
        Path(args.out).write_text(state["best_description"])
    print(json.dumps({
        "description": state["best_description"],
        "char_count": len(state["best_description"]),
        "train_score": state["best_train_score"],
        "test_score": state["best_test_score"],
        "written_to": args.out,
    }, ensure_ascii=False, indent=2))
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    state = _load(args.workspace)
    html = generate_html(state, skill_name=state["skill"])
    out = Path(args.out)
    out.write_text(html)
    print(f"wrote {out}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init", help="create the loop workspace and train/test splits")
    p.add_argument("workspace")
    p.add_argument("--skill-path", required=True)
    p.add_argument("--eval-set", required=True)
    p.add_argument("--holdout", type=float, default=0.4)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--threshold", type=float, default=0.5)
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("record", help="record one scored attempt")
    p.add_argument("workspace")
    p.add_argument("--iteration", type=int, required=True)
    p.add_argument("--train-report", required=True)
    p.add_argument("--test-report", default=None)
    p.add_argument("--description-file", default=None)
    p.add_argument("--note", default=None)
    p.set_defaults(func=cmd_record)

    p = sub.add_parser("status", help="show the attempts and the current best")
    p.add_argument("workspace")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("best", help="print the best description")
    p.add_argument("workspace")
    p.add_argument("--out", default=None)
    p.set_defaults(func=cmd_best)

    p = sub.add_parser("report", help="render the HTML report")
    p.add_argument("workspace")
    p.add_argument("--out", default="report.html")
    p.set_defaults(func=cmd_report)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
