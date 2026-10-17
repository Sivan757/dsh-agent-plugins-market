#!/usr/bin/env python3
"""Build the description-improvement prompt, and record the candidate it yields.

A Python process cannot spawn subagents, so the two halves are split:

  * `prompt`  — assembles the improvement prompt from a score report. The agent
                reads it and produces the candidate. No LLM call happens here.
  * `accept`  — validates a candidate the agent wrote, checks the length limit,
                appends the scored attempt to the history, and prints the result.

The loop itself (spawn subagents, score, propose, repeat, keep the best test
score) is driven by the agent; see the Description Optimization section of
SKILL.md.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from scripts.utils import parse_skill_md

MAX_CHARS = 1024


def build_prompt(
    skill_name: str,
    skill_content: str,
    current_description: str,
    report: dict,
    history: list[dict],
    test_report: dict | None = None,
) -> str:
    """Assemble the improvement prompt from one round's score report."""
    failed = [r for r in report["results"] if r["should_trigger"] and r["verdict"].startswith("FALSE")]
    false_triggers = [r for r in report["results"] if not r["should_trigger"] and r["verdict"].startswith("FALSE")]

    train_score = f"{report['correct']}/{report['scored']}"
    if test_report:
        scores_summary = f"Train: {train_score}, Test: {test_report['correct']}/{test_report['scored']}"
    else:
        scores_summary = f"Train: {train_score}"

    prompt = f"""You are optimizing the description of a skill named "{skill_name}". A skill uses progressive disclosure: the name and description are all the model sees when deciding whether to load it, and only if it loads the skill does it read SKILL.md and the linked resources.

The description appears in the available-skills catalog. On each user query the model decides whether to load the skill from the name and this description alone. Write a description that fires for relevant queries and stays quiet for irrelevant ones.

Here is the current description:
<current_description>
"{current_description}"
</current_description>

Current scores ({scores_summary}):
<scores_summary>
"""
    if failed:
        prompt += "FAILED TO TRIGGER (should have triggered but did not):\n"
        for r in failed:
            prompt += f'  - "{r["query"]}" (triggered {r["triggered"]}/{r["runs"]} times)\n'
        prompt += "\n"

    if false_triggers:
        prompt += "FALSE TRIGGERS (triggered but should not have):\n"
        for r in false_triggers:
            prompt += f'  - "{r["query"]}" (triggered {r["triggered"]}/{r["runs"]} times)\n'
        prompt += "\n"

    if history:
        prompt += "PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):\n\n"
        for h in history:
            score_str = f"train={h.get('train_correct', '?')}/{h.get('train_scored', '?')}"
            if h.get("test_correct") is not None:
                score_str += f", test={h['test_correct']}/{h.get('test_scored', '?')}"
            prompt += f"<attempt {score_str}>\n"
            prompt += f'Description: "{h["description"]}"\n'
            for r in h.get("results", []):
                status = "PASS" if r["verdict"] == "ok" else "FAIL"
                prompt += f'  [{status}] "{r["query"][:80]}" (triggered {r["triggered"]}/{r["runs"]})\n'
            if h.get("note"):
                prompt += f'Note: {h["note"]}\n'
            prompt += "</attempt>\n\n"

    prompt += f"""</scores_summary>

Skill content (for context on what the skill does):
<skill_content>
{skill_content}
</skill_content>

Based on the failures, write a new and improved description that is more likely to trigger correctly. "Based on the failures" is a tricky line to walk, because we do not want to overfit to the specific cases you are seeing. So what I do NOT want is an ever-expanding list of specific queries this skill should or should not trigger for. Instead, generalize from the failures to broader categories of user intent and situations where this skill is useful or not useful. The reason is twofold:

1. Avoid overfitting
2. The list would get long, and it is injected into every query; with many skills installed, no single description should take too much space.

Concretely, keep the description under about 100-200 words even if that costs some accuracy. There is a hard limit of {MAX_CHARS} characters — anything longer is truncated, so stay comfortably under it.

Tips that work well:
- Phrase it in the imperative — "Use this skill for" rather than "this skill does".
- Focus on the user's intent, what they are trying to achieve, not on how the skill works internally.
- The description competes with other skills for attention — make it distinctive and immediately recognizable.
- List the concrete nouns, error strings, and API names a user would actually type; those are what lexical matching latches onto.
- If you keep getting failures after several attempts, change things up: different sentence structure, different opening.

Be creative and vary the style across iterations; you get multiple attempts and we keep the highest-scoring one.

Respond with only the new description text inside <new_description> tags, nothing else."""

    return prompt


def extract_candidate(text: str) -> str:
    match = re.search(r"<new_description>(.*?)</new_description>", text, re.DOTALL)
    return (match.group(1) if match else text).strip().strip('"')


def cmd_prompt(args: argparse.Namespace) -> int:
    report = json.loads(Path(args.report).read_text())
    test_report = json.loads(Path(args.test_report).read_text()) if args.test_report else None
    history = json.loads(Path(args.history).read_text()) if args.history else []
    name, current_description, content = parse_skill_md(Path(args.skill_path))
    prompt = build_prompt(name, content, current_description, report, history, test_report)
    if args.out:
        Path(args.out).write_text(prompt)
        print(f"wrote {args.out} ({len(prompt)} chars)")
    else:
        print(prompt)
    return 0


def cmd_accept(args: argparse.Namespace) -> int:
    report = json.loads(Path(args.report).read_text())
    test_report = json.loads(Path(args.test_report).read_text()) if args.test_report else None
    history = json.loads(Path(args.history).read_text()) if args.history else []
    _, current_description, _ = parse_skill_md(Path(args.skill_path))

    raw = Path(args.candidate).read_text()
    description = extract_candidate(raw)
    over = len(description) > MAX_CHARS

    history = history + [{
        "description": current_description,
        "train_correct": report["correct"],
        "train_scored": report["scored"],
        "test_correct": test_report["correct"] if test_report else None,
        "test_scored": test_report["scored"] if test_report else None,
        "results": report["results"],
        "note": args.note,
    }]
    if args.out_history:
        Path(args.out_history).write_text(json.dumps(history, ensure_ascii=False, indent=2))

    out = {
        "description": description,
        "char_count": len(description),
        "over_limit": over,
        "history_entries": len(history),
    }
    if over:
        out["action_required"] = (
            f"Description is {len(description)} chars, over the {MAX_CHARS} hard limit. "
            f"Rewrite it shorter before installing it."
        )
    if args.out:
        Path(args.out).write_text(description)
        out["written_to"] = args.out
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("prompt", help="write the improvement prompt for the agent to answer")
    p.add_argument("--report", required=True, help="score report from run_eval.py")
    p.add_argument("--skill-path", required=True)
    p.add_argument("--test-report", default=None)
    p.add_argument("--history", default=None)
    p.add_argument("--out", default=None)
    p.set_defaults(func=cmd_prompt)

    p = sub.add_parser("accept", help="validate a candidate and append it to the history")
    p.add_argument("--report", required=True)
    p.add_argument("--skill-path", required=True)
    p.add_argument("--candidate", required=True, help="file holding the agent's <new_description>")
    p.add_argument("--test-report", default=None)
    p.add_argument("--history", default=None)
    p.add_argument("--out-history", default=None)
    p.add_argument("--out", default=None, help="write the accepted description here")
    p.add_argument("--note", default=None, help="free-text note stored with this attempt")
    p.set_defaults(func=cmd_accept)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
