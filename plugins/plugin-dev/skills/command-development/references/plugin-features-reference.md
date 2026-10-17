# Plugin-Specific Command Features Reference

This reference covers features and patterns specific to commands bundled in DeepSeek Harness plugins.

## Table of Contents

- [Plugin Command Discovery](#plugin-command-discovery)
- [PLUGIN_ROOT Environment Variable](#plugin_root-environment-variable)
- [Plugin Command Patterns](#plugin-command-patterns)
- [Integration with Plugin Components](#integration-with-plugin-components)
- [Validation Patterns](#validation-patterns)

## Plugin Command Discovery

### Auto-Discovery

DeepSeek Harness automatically discovers commands in plugins using the following locations:

```
plugin-name/
└── com.deepseek.harness/
    └── commands/
        ├── foo.md            # /foo
        └── bar.md            # /bar
```

**Key points:**
- Commands are discovered at plugin load time
- No manual registration required
- Commands appear in the slash menu
- Subdirectories create namespaces

### Namespaced Plugin Commands

Organize commands in subdirectories for logical grouping:

```
plugin-name/
└── com.deepseek.harness/
    └── commands/
        ├── review/
        │   ├── security.md    # /security (review)
        │   └── style.md       # /style (review)
        └── deploy/
            ├── staging.md     # /staging (deploy)
            └── prod.md        # /prod (deploy)
```

**Namespace behavior:**
- Subdirectory name becomes namespace
- Subdirectory names namespace the command id
- Helps organize related commands
- Use when plugin has 5+ commands

### Command Naming Conventions

**Plugin command names should:**
1. Be descriptive and action-oriented
2. Avoid conflicts with common command names
3. Use hyphens for multi-word names
4. Consider prefixing with plugin name for uniqueness

**Examples:**
```
Good:
- /mylyn-sync          (plugin-specific prefix)
- /analyze-performance (descriptive action)
- /docker-compose-up   (clear purpose)

Avoid:
- /test               (conflicts with common name)
- /run                (too generic)
- /do-stuff           (not descriptive)
```

## PLUGIN_ROOT Environment Variable

### Purpose

`${PLUGIN_ROOT}` is a special environment variable available in plugin commands that resolves to the absolute path of the plugin directory.

**Why it matters:**
- Enables portable paths within plugin
- Allows referencing plugin files and scripts
- Works across different installations
- Essential for multi-file plugin operations

### Basic Usage

Reference files within your plugin:

```markdown
---
description: Analyze using plugin script
allowed-tools: Bash(node:*), Read
---

Run analysis: run `node ${PLUGIN_ROOT}/scripts/analyze.js`

Read template: @${PLUGIN_ROOT}/templates/report.md
```

**Expands to:**
```
Run analysis: run `node /path/to/plugins/plugin-name/scripts/analyze.js`

Read template: @/path/to/plugins/plugin-name/templates/report.md
```

### Common Patterns

#### 1. Executing Plugin Scripts

```markdown
---
description: Run custom linter from plugin
allowed-tools: Bash(node:*)
---

Lint results: run `node ${PLUGIN_ROOT}/bin/lint.js $1`

Review the linting output and suggest fixes.
```

#### 2. Loading Configuration Files

```markdown
---
description: Deploy using plugin configuration
allowed-tools: Read, Bash(*)
---

Configuration: @${PLUGIN_ROOT}/config/deploy-config.json

Deploy application using the configuration above for $1 environment.
```

#### 3. Accessing Plugin Resources

```markdown
---
description: Generate report from template
---

Use this template: @${PLUGIN_ROOT}/templates/api-report.md

Generate a report for @$1 following the template format.
```

#### 4. Multi-Step Plugin Workflows

```markdown
---
description: Complete plugin workflow
allowed-tools: Bash(*), Read
---

Step 1 - Prepare: run `bash ${PLUGIN_ROOT}/scripts/prepare.sh $1`
Step 2 - Config: @${PLUGIN_ROOT}/config/$1.json
Step 3 - Execute: run `${PLUGIN_ROOT}/bin/execute $1`

Review results and report status.
```

### Best Practices

1. **Always use for plugin-internal paths:**
   ```markdown
   # Good
   @${PLUGIN_ROOT}/templates/foo.md

   # Bad
   @./templates/foo.md  # Relative to current directory, not plugin
   ```

2. **Validate file existence:**
   ```markdown
   ---
   description: Use plugin config if exists
   allowed-tools: Bash(test:*), Read
   ---

   run `test -f ${PLUGIN_ROOT}/config.json && echo "exists" || echo "missing"`

   If config exists, load it: @${PLUGIN_ROOT}/config.json
   Otherwise, use defaults...
   ```

3. **Document plugin file structure:**
   ```markdown
   <!--
   Plugin structure:
   ${PLUGIN_ROOT}/
   ├── scripts/analyze.js  (analysis script)
   ├── templates/          (report templates)
   └── config/             (configuration files)
   -->
   ```

4. **Combine with arguments:**
   ```markdown
   Run: run `${PLUGIN_ROOT}/bin/process.sh $1 $2`
   ```

### Troubleshooting

**Variable not expanding:**
- Ensure command is loaded from plugin
- Check bash execution is allowed
- Verify syntax is exact: `${PLUGIN_ROOT}`

**File not found errors:**
- Verify file exists in plugin directory
- Check file path is correct relative to plugin root
- Ensure file permissions allow reading/execution

**Path with spaces:**
- Bash commands automatically handle spaces
- File references work with spaces in paths
- No special quoting needed

## Plugin Command Patterns

### Pattern 1: Configuration-Based Commands

Commands that load plugin-specific configuration:

```markdown
---
description: Deploy using plugin settings
allowed-tools: Read, Bash(*)
---

Load configuration: @${PLUGIN_ROOT}/deploy-config.json

Deploy to $1 environment using:
1. Configuration settings above
2. Current git branch: run `git branch --show-current`
3. Application version: run `cat package.json | grep version`

Execute deployment and monitor progress.
```

**When to use:** Commands that need consistent settings across invocations

### Pattern 2: Template-Based Generation

Commands that use plugin templates:

```markdown
---
description: Generate documentation from template
argument-hint: "[component-name]"
---

Template: @${PLUGIN_ROOT}/templates/component-docs.md

Generate documentation for $1 component following the template structure.
Include:
- Component purpose and usage
- API reference
- Examples
- Testing guidelines
```

**When to use:** Standardized output generation

### Pattern 3: Multi-Script Workflow

Commands that orchestrate multiple plugin scripts:

```markdown
---
description: Complete build and test workflow
allowed-tools: Bash(*)
---

Build: run `bash ${PLUGIN_ROOT}/scripts/build.sh`
Validate: run `bash ${PLUGIN_ROOT}/scripts/validate.sh`
Test: run `bash ${PLUGIN_ROOT}/scripts/test.sh`

Review all outputs and report:
1. Build status
2. Validation results
3. Test results
4. Recommended next steps
```

**When to use:** Complex plugin workflows with multiple steps

### Pattern 4: Environment-Aware Commands

Commands that adapt to environment:

```markdown
---
description: Deploy based on environment
argument-hint: "[dev|staging|prod]"
---

Environment config: @${PLUGIN_ROOT}/config/$1.json

Environment check: run `echo "Deploying to: $1"`

Deploy application using $1 environment configuration.
Verify deployment and run smoke tests.
```

**When to use:** Commands that behave differently per environment

### Pattern 5: Plugin Data Management

Commands that manage plugin-specific data:

```markdown
---
description: Save analysis results to plugin cache
allowed-tools: Bash(*), Read, Write
---

Cache directory: ${PLUGIN_ROOT}/cache/

Analyze @$1 and save results to cache:
run `mkdir -p ${PLUGIN_ROOT}/cache && date > ${PLUGIN_ROOT}/cache/last-run.txt`

Store analysis for future reference and comparison.
```

**When to use:** Commands that need persistent data storage

## Integration with Plugin Components

### Invoking Plugin Agents

Commands can trigger plugin agents using the subagent_run tool:

```markdown
---
description: Deep analysis using plugin agent
argument-hint: "[file-path]"
---

Initiate deep code analysis of @$1 using the code-analyzer agent.

The agent will:
1. Analyze code structure
2. Identify patterns
3. Suggest improvements
4. Generate detailed report

Note: This uses the subagent_run tool to launch the plugin's code-analyzer agent.
```

**Key points:**
- Agent must be defined in plugin's `agents/` directory
- the agent will automatically use subagent_run tool to launch agent
- Agent has access to same plugin resources

### Invoking Plugin Skills

Commands can reference plugin skills for specialized knowledge:

```markdown
---
description: API documentation with best practices
argument-hint: "[api-file]"
---

Document the API in @$1 following our API documentation standards.

Use the api-docs-standards skill to ensure documentation includes:
- Endpoint descriptions
- Parameter specifications
- Response formats
- Error codes
- Usage examples

Note: This leverages the plugin's api-docs-standards skill for consistency.
```

**Key points:**
- Skill must be defined in plugin's `skills/` directory
- Mention skill by name to hint the agent should invoke it
- Skills provide specialized domain knowledge

### Coordinating with Plugin Hooks

Commands can be designed to work with plugin hooks:

```markdown
---
description: Commit with pre-commit validation
allowed-tools: Bash(git:*)
---

Stage changes: !\`git add $1\`

Commit changes: !\`git commit -m "$2"\`

Note: This commit will trigger the plugin's pre-commit hook for validation.
Review hook output for any issues.
```

**Key points:**
- Hooks execute automatically on events
- Commands can prepare state for hooks
- Document hook interaction in command

### Multi-Component Plugin Commands

Commands that coordinate multiple plugin components:

```markdown
---
description: Comprehensive code review workflow
argument-hint: "[file-path]"
---

File to review: @$1

Execute comprehensive review:

1. **Static Analysis** (via plugin scripts)
   run `node ${PLUGIN_ROOT}/scripts/lint.js $1`

2. **Deep Review** (via plugin agent)
   Launch the code-reviewer agent for detailed analysis.

3. **Best Practices** (via plugin skill)
   Use the code-standards skill to ensure compliance.

4. **Documentation** (via plugin template)
   Template: @${PLUGIN_ROOT}/templates/review-report.md

Generate final report combining all outputs.
```

**When to use:** Complex workflows leveraging multiple plugin capabilities

## Validation Patterns

### Input Validation

Commands should validate inputs before processing:

```markdown
---
description: Deploy to environment with validation
argument-hint: "[environment]"
---

Validate environment: run `echo "$1" | grep -E "^(dev|staging|prod)$" || echo "INVALID"`

$IF($1 in [dev, staging, prod],
  Deploy to $1 environment using validated configuration,
  ERROR: Invalid environment '$1'. Must be one of: dev, staging, prod
)
```

**Validation approaches:**
1. Bash validation using grep/test
2. Inline validation in prompt
3. Script-based validation

### File Existence Checks

Verify required files exist:

```markdown
---
description: Process configuration file
argument-hint: "[config-file]"
---

Check file: run `test -f $1 && echo "EXISTS" || echo "MISSING"`

Process configuration if file exists: @$1

If file doesn't exist, explain:
- Expected location
- Required format
- How to create it
```

### Required Arguments

Validate required arguments provided:

```markdown
---
description: Create deployment with version
argument-hint: "[environment] [version]"
---

Validate inputs: run `test -n "$1" -a -n "$2" && echo "OK" || echo "MISSING"`

$IF($1 AND $2,
  Deploy version $2 to $1 environment,
  ERROR: Both environment and version required. Usage: /deploy [env] [version]
)
```

### Plugin Resource Validation

Verify plugin resources available:

```markdown
---
description: Run analysis with plugin tools
allowed-tools: Bash(test:*)
---

Validate plugin setup:
- Config exists: run `test -f ${PLUGIN_ROOT}/config.json && echo "✓" || echo "✗"`
- Scripts exist: run `test -d ${PLUGIN_ROOT}/scripts && echo "✓" || echo "✗"`
- Tools available: run `test -x ${PLUGIN_ROOT}/bin/analyze && echo "✓" || echo "✗"`

If all checks pass, proceed with analysis.
Otherwise, report missing components and installation steps.
```

### Output Validation

Validate command execution results:

```markdown
---
description: Build and validate output
allowed-tools: Bash(*)
---

Build: run `bash ${PLUGIN_ROOT}/scripts/build.sh`

Validate output:
- Exit code: run `echo $?`
- Output exists: run `test -d dist && echo "✓" || echo "✗"`
- File count: run `find dist -type f | wc -l`

Report build status and any validation failures.
```

### Graceful Error Handling

Handle errors gracefully with helpful messages:

```markdown
---
description: Process file with error handling
argument-hint: "[file-path]"
---

Try processing: run `node ${PLUGIN_ROOT}/scripts/process.js $1 2>&1 || echo "ERROR: $?"`

If processing succeeded:
- Report results
- Suggest next steps

If processing failed:
- Explain likely causes
- Provide troubleshooting steps
- Suggest alternative approaches
```

## Best Practices Summary

### Plugin Commands Should:

1. **Use ${PLUGIN_ROOT} for all plugin-internal paths**
   - Scripts, templates, configuration, resources

2. **Validate inputs early**
   - Check required arguments
   - Verify file existence
   - Validate argument formats

3. **Document plugin structure**
   - Explain required files
   - Document script purposes
   - Clarify dependencies

4. **Integrate with plugin components**
   - Reference agents for complex tasks
   - Use skills for specialized knowledge
   - Coordinate with hooks when relevant

5. **Provide helpful error messages**
   - Explain what went wrong
   - Suggest how to fix
   - Offer alternatives

6. **Handle edge cases**
   - Missing files
   - Invalid arguments
   - Failed script execution
   - Missing dependencies

7. **Keep commands focused**
   - One clear purpose per command
   - Delegate complex logic to scripts
   - Use agents for multi-step workflows

8. **Test across installations**
   - Verify paths work everywhere
   - Test with different arguments
   - Validate error cases

---

For general command development, see main SKILL.md.
For command examples, see examples/ directory.
