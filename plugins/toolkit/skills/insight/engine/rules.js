// Maintained by hand in this copy of the shared rule tables; no generator ships
// with this skill. The facet closed sets below are shared with a widely used
// session-review vocabulary, with vendor words renamed for this runtime.
export default {
  "DSH_KNOWN_RECORD_TYPES": [
    "agent-preset/selected",
    "agent/inbox/spliced",
    "approval/asked",
    "approval/decided",
    "approval/policy",
    "assistant/attempt",
    "assistant/chunk",
    "assistant/message",
    "command/done",
    "command/run",
    "compaction/end",
    "compaction/prune",
    "compaction/start",
    "compaction/summary",
    "deliverables/presented",
    "feedback/message-delete",
    "feedback/message-put",
    "feedback/record",
    "goal/change",
    "hook/invoked",
    "hook/result",
    "llm/retry",
    "llm/retry-started",
    "model/selection",
    "permission/preset",
    "plan/mode",
    "reasoning-chunks",
    "request/context",
    "request/header",
    "sandbox/mode",
    "schedule/change",
    "session",
    "session-log-deepseek/delivery-accepted",
    "session/end-seed",
    "session/title",
    "session/title-llm-request",
    "step/end",
    "step/start",
    "subagent/catalog",
    "subagent/descriptor",
    "subagent/model-selection-policy",
    "system/message",
    "team/member",
    "team/message/delivered",
    "team/message/queued",
    "team/task",
    "text-chunks",
    "todo/write",
    "tool-call-chunks",
    "tool-workflow/agent-end",
    "tool-workflow/agent-start",
    "tool-workflow/run-end",
    "tool-workflow/run-start",
    "tool/call",
    "tool/code-dispatch",
    "tool/code-dispatch-start",
    "tool/ptc-dispatch",
    "tool/ptc-dispatch-start",
    "tool/result",
    "turn/end",
    "turn/start",
    "user/message",
    "web/deepseek-search-llm-request"
  ],
  "WORK_AREA_RULES": [
    [
      "research_writing",
      [
        "paper",
        "manuscript",
        "reviewer",
        "latex",
        "abstract",
        "introduction",
        "论文",
        "稿件",
        "投稿",
        "审稿",
        "章节"
      ]
    ],
    [
      "experiments_data",
      [
        "experiment",
        "dataset",
        "analysis",
        "metric",
        "csv",
        "benchmark",
        "实验",
        "数据",
        "分析",
        "指标",
        "结果"
      ]
    ],
    [
      "skills_configuration",
      [
        "skill",
        "plugin",
        "mcp",
        "agents.md",
        "dsh",
        "config",
        "技能",
        "插件",
        "配置",
        "同步"
      ]
    ],
    [
      "documents_presentations",
      [
        "docx",
        "document",
        "ppt",
        "slide",
        "pdf",
        "report",
        "文档",
        "报告",
        "幻灯片",
        "演示",
        "验收",
        "合同",
        "材料"
      ]
    ],
    [
      "software_engineering",
      [
        "code",
        "bug",
        "test",
        "implement",
        "refactor",
        "build",
        "api",
        "代码",
        "实现",
        "修复",
        "测试",
        "重构",
        "开发"
      ]
    ],
    [
      "web_sites",
      [
        "website",
        "html",
        "css",
        "jekyll",
        "frontend",
        "page",
        "网页",
        "网站",
        "前端",
        "页面",
        "主页"
      ]
    ]
  ],
  "COMMON_FILE_EXTENSIONS": [
    "bib",
    "c",
    "cc",
    "cpp",
    "css",
    "csv",
    "docx",
    "go",
    "gradle",
    "h",
    "hpp",
    "html",
    "java",
    "jpeg",
    "jpg",
    "js",
    "json",
    "jsonl",
    "jsx",
    "kt",
    "log",
    "md",
    "pdf",
    "png",
    "pptx",
    "properties",
    "ps1",
    "py",
    "rs",
    "sh",
    "sql",
    "svg",
    "swift",
    "tex",
    "toml",
    "ts",
    "tsx",
    "txt",
    "xlsx",
    "xml",
    "yaml",
    "yml",
    "zip",
    "zsh"
  ],
  "TEXT_ERROR_RULES": [
    [
      "shell_syntax",
      {
        "source": "^(?:ParserError|SyntaxError)(?::.*)?$",
        "flags": "i"
      }
    ],
    [
      "encoding_locale",
      {
        "source": "^Unicode(?:Encode|Decode|Translate)?Error(?::.*)?$",
        "flags": "i"
      }
    ],
    [
      "other",
      {
        "source": "^Traceback \\(most recent call last\\):$",
        "flags": ""
      }
    ],
    [
      "missing_dependency",
      {
        "source": "^(?:ModuleNotFoundError|ImportError)(?::.*)?$",
        "flags": "i"
      }
    ]
  ],
  "FAILURE_CAUSE_RULES": [
    [
      "permission_boundary",
      {
        "source": "(?:permission denied|operation not permitted|access is denied|outside (?:the )?sandbox|requires escalated permissions|EACCES)",
        "flags": "i"
      }
    ],
    [
      "timeout",
      {
        "source": "(?:timed? out|timeout expired|TimeoutExpired)",
        "flags": "i"
      }
    ],
    [
      "missing_dependency",
      {
        "source": "(?:ModuleNotFoundError|No module named|command not found|is not recognized as the name)",
        "flags": "i"
      }
    ],
    [
      "encoding_locale",
      {
        "source": "(?:Unicode(?:Encode|Decode|Translate)?Error|codec can't encode|invalid utf-?8)",
        "flags": "i"
      }
    ],
    [
      "shell_syntax",
      {
        "source": "(?:ParserError|SyntaxError|unexpected token|parse error)",
        "flags": "i"
      }
    ],
    [
      "missing_path",
      {
        "source": "(?:cannot find path|no such file or directory|path does not exist|找不到路径)",
        "flags": "i"
      }
    ],
    [
      "network_auth",
      {
        "source": "(?:authentication failed|permission denied \\(publickey\\)|could not resolve host|connection refused|proxy error|HTTP (?:401|403|407))",
        "flags": "i"
      }
    ],
    [
      "test_validation",
      {
        "source": "(?:\\bFAILED\\b|tests? failed|validation failed|doctor.*failure)",
        "flags": "i"
      }
    ]
  ],
  "TOKEN_KEYS": [
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens"
  ],
  "ROLE_NAMES": [
    "root_task",
    "task_subagent",
    "action_reviewer",
    "unknown_system_rollout"
  ],
  "SENSITIVE_BLOCK_RE": {
    "source": "<(?:environment_context|permissions instructions|skills_instructions|apps_instructions)\\b[^>]*>.*?</(?:environment_context|permissions instructions|skills_instructions|apps_instructions)>",
    "flags": "is"
  },
  "FENCED_CODE_RE": {
    "source": "```.*?```",
    "flags": "s"
  },
  "EMAIL_RE": {
    "source": "\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b",
    "flags": "i"
  },
  "UUID_RE": {
    "source": "\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b",
    "flags": "i"
  },
  "HOME_UNIX_RE": {
    "source": "/(?:Users|home)/[^/\\s]+",
    "flags": ""
  },
  "HOME_WINDOWS_RE": {
    "source": "\\b[A-Za-z]:\\\\Users\\\\[^\\\\\\s]+",
    "flags": "i"
  },
  "ABS_UNIX_PATH_RE": {
    "source": "(?<![:/\\w])/(?:[^/\\s]+/)+[^/\\s,;:)\\]]+",
    "flags": ""
  },
  "ABS_WINDOWS_PATH_RE": {
    "source": "\\b[A-Za-z]:\\\\(?:[^\\\\\\s]+\\\\)+[^\\\\\\s,;:)\\]]+",
    "flags": ""
  },
  "BEARER_RE": {
    "source": "\\bBearer\\s+[A-Za-z0-9._~+/=-]{8,}",
    "flags": "i"
  },
  "NAMED_SECRET_RE": {
    "source": "\\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\\b\\s*[:=]\\s*['\\\"]?[^\\s'\\\",;]{4,}",
    "flags": "i"
  },
  "KNOWN_SECRET_RE": {
    "source": "\\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\\b",
    "flags": ""
  },
  "LONG_TOKEN_RE": {
    "source": "\\b(?=[A-Za-z0-9+/=]{32,}\\b)(?=[A-Za-z0-9+/=]*[A-Za-z])(?=[A-Za-z0-9+/=]*\\d)[A-Za-z0-9+/=]+\\b",
    "flags": ""
  },
  "CORRECTION_RE": {
    "source": "(?:\\b(?:no|not that|instead|wrong|stop|actually|rather than|misunderstood)\\b|不要|不是这样|不对|错了|改为|你误解|别这样)",
    "flags": "i"
  },
  "USER_ACCEPTANCE_RE": {
    "source": "^\\s*(?:验收通过|我接受(?:这个)?结果|结果可以|通过验收|accepted|i accept(?: this result)?|looks good)\\s*[。.!！]?\\s*$",
    "flags": "i"
  },
  "CONTENT_DUMP_COMMAND_RE": {
    "source": "(?:Get-Content|Select-String|\\brg\\b|\\bgrep\\b|\\bcat\\b|\\btype\\b|sed\\s+-n\\b|\\bhead\\b|\\btail\\b)",
    "flags": "i"
  },
  "DIAGNOSTIC_COMMAND_RE": {
    "source": "(?:\\b(?:Test-Path|Get-Command|where\\.exe|git\\s+diff\\s+--quiet|git\\s+rev-parse|rg\\b|grep\\b|Select-String)\\b)",
    "flags": "i"
  },
  "VERIFICATION_COMMAND_RE": {
    "source": "(?:\\b(?:pytest|unittest)\\b|\\bpython(?:\\.exe)?\\b[^\\r\\n]{0,200}\\b(?:test|validate|doctor|smoke|audit|check)[\\w.-]*\\.py\\b|\\b(?:npm|pnpm|yarn)\\s+(?:run\\s+)?test\\b|\\b(?:validate|doctor|smoke|audit|check)[\\w.-]*(?:\\.py|\\.ps1|\\.sh)?\\b)",
    "flags": "i"
  },
  "STATE_CHANGE_COMMAND_RE": {
    "source": "(?:\\b(?:apply_patch|install|pip\\s+install|npm\\s+install|git\\s+(?:pull|fetch|merge|rebase)|New-Item|Set-Content|Copy-Item|Move-Item|Remove-Item|mkdir|touch)\\b)",
    "flags": "i"
  },
  "FILE_EXTENSION_RE": {
    "source": "(?:^|[\\\\/\\s\\\"'])[^\\s\\\"']+\\.([a-z0-9]{1,10})(?=$|[\\s\\\"',:;)}\\]])",
    "flags": "i"
  },
  "SKILL_MENTION_RE": {
    "source": "(?<![\\w-])\\$([a-z0-9]+(?:-[a-z0-9]+)+)(?![\\w-])",
    "flags": "i"
  },
  "DSH_SANDBOX_DENIED_RE": {
    "source": "\\[sandbox:\\s*file access denied under\\s+[^]]+\\s+mode\\]",
    "flags": "i"
  },
  "DSH_USER_REJECTED_RE": {
    "source": "user rejected escalating|approval (?:was )?rejected",
    "flags": "i"
  },
  "RUNTIME_EXIT_LINE_RE": {
    "source": "^(?:Process exited with code|Exit code:|exit_code\\s*[:=])\\s*(-?\\d+)\\s*$",
    "flags": "i"
  },
  "RUNTIME_SUCCESS_LINE_RE": {
    "source": "^(?:Script completed|Command completed)$",
    "flags": ""
  },
  "RUNTIME_FAILURE_LINE_RE": {
    "source": "^(?:Script failed|Command failed)$",
    "flags": "i"
  },
  "WALL_TIME_LINE_RE": {
    "source": "^Wall time\\s+([0-9]+(?:\\.[0-9]+)?)\\s+seconds$",
    "flags": "i"
  },
  "TOOL_EVIDENCE_LINE_RE": {
    "source": "(?:^Ran\\s+\\d+\\s+tests?\\b|\\b\\d+\\s+(?:passed|failed|errors?|skipped)\\b|\\b(?:tests?|validation|doctor|smoke|audit|check)\\b.{0,100}\\b(?:passed|failed|success|complete)\\b|\\b\\d+\\s+files? changed\\b|^\\[[^]\\r\\n]+\\s+[0-9a-f]{7,40}\\]|^(?:HEAD|origin/main|remote/main)=|^(?:Script|Command) (?:completed|failed)$)",
    "flags": "i"
  },
  "FACET_ENUMS": {
    "outcome": [
      "fully_achieved",
      "mostly_achieved",
      "partially_achieved",
      "not_achieved",
      "unclear_from_transcript"
    ],
    "assistant_helpfulness": [
      "unhelpful",
      "slightly_helpful",
      "moderately_helpful",
      "very_helpful",
      "essential"
    ],
    "session_type": [
      "single_task",
      "multi_task",
      "iterative_refinement",
      "exploration",
      "quick_question"
    ],
    "primary_success": [
      "none",
      "fast_accurate_search",
      "correct_code_edits",
      "good_explanations",
      "proactive_help",
      "multi_file_changes",
      "good_debugging"
    ],
    "goal_categories": [
      "debug_investigate",
      "implement_feature",
      "fix_bug",
      "write_script_tool",
      "refactor_code",
      "configure_system",
      "create_pr_commit",
      "analyze_data",
      "understand_codebase",
      "write_tests",
      "write_docs",
      "deploy_infra",
      "warmup_minimal"
    ],
    "user_satisfaction_counts": [
      "frustrated",
      "dissatisfied",
      "likely_satisfied",
      "satisfied",
      "happy",
      "unsure",
      "neutral",
      "delighted"
    ],
    "friction_counts": [
      "misunderstood_request",
      "wrong_approach",
      "buggy_code",
      "user_rejected_action",
      "assistant_got_blocked",
      "user_stopped_early",
      "wrong_file_or_location",
      "excessive_changes",
      "slow_or_verbose",
      "tool_failed",
      "user_unclear",
      "external_issue"
    ]
  },
  "AGGREGATE_SECTIONS": [
    "glance",
    "workflows",
    "operating_style",
    "strengths",
    "frictions",
    "recommendations",
    "horizon"
  ]
}
