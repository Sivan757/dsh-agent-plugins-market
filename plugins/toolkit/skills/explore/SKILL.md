---
name: explore
description: Fast read-only codebase exploration that returns a report instead of filling the main context. Use when the user asks to "explore the codebase", "find where X is handled", "how does Y work", or when a search would take many reads to answer.
---

# Explore

Answer a question about a codebase by searching and reading, then report.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

## Call shape

The invocation carries the question to answer, optionally followed by a thoroughness word. The thoroughness level sets how far to search before answering:

- **quick** for basic searches
- **medium** for moderate exploration
- **very thorough** for comprehensive analysis across multiple locations and naming conventions

## Procedure

1. Restate the question as the concrete thing to find: a symbol, a route, a behavior, a configuration value.
2. Use glob for broad file pattern matching and content search for searching file contents with regex; use read when you know the specific file path you need.
3. Use Bash ONLY for read-only operations (ls, git status, git log, git diff, find, cat, head, tail). NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification.
4. Wherever possible, spawn multiple parallel tool calls for searching and reading files — you are meant to return output as quickly as possible.
5. Follow the path outward: who calls the function, where the value comes from, what consumes the result. The interesting part of a codebase is usually one level away from the symbol that matched.

## Report

One message, no files:

- **Answer** — the direct answer in one or two sentences.
- **Evidence** — file paths with the lines that support it, quoted where the exact text matters.
- **Map** — the entry point, the call chain, and the tests covering it.
- **Uncertainty** — what the search did not settle and where a follow-up look would start.

Report what the code shows; label inferences as inferences.
