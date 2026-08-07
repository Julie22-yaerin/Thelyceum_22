#!/usr/bin/env node
/**
 * The red team CLI.
 *
 *   redteam challenge "<claim or plan text>"
 *       Scan a claim/plan/code edit for reasoning & code flaws. Exit 0 if clean/warn,
 *       1 if blocked (blocking flaw matched or too many flags).
 *
 *   redteam rebut "<claim or plan text>"
 *       Quick devil's advocate: counters + verdict only, no flag audit.
 *
 *   redteam compact "<text>"
 *       Smart context compacting: filter hesitation fillers and word duplications
 *       without losing important technical or logical context.
 *
 *   redteam rules
 *       List the flaw rules the red team watches (reasoning + code flaw classes).
 *
 *   redteam status [--limit N]
 *       Show the most recent challenge events from the audit log.
 *
 *   redteam mode (always | slash)
 *       Set / show the mode. 'always' = model challenges its own reasoning
 *       proactively; 'slash' = only when the user types /redteam.
 *
 *   redteam install <target>        claude-desktop | claude-code | chatgpt | all
 *   redteam uninstall <target>
 *   redteam init                    Write ~/.redteam/config.json with defaults.
 *   redteam mcp                     Start the MCP server on stdio.
 *
 *   redteam --version | --help
 */
export {};
//# sourceMappingURL=cli.d.ts.map