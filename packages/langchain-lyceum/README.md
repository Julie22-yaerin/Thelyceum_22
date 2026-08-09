# langchain-lyceum

Drop-in token compression for [LangChain.js](https://js.langchain.com) agent tools. Wrap your tools once, and every tool call gets run through [The Lyceum](https://thelyceum.site)'s compression engine before the agent sees it — repeated reads of the same content collapse to a pointer, oversized results get capped to a token budget, and machine noise gets stripped. Nothing is estimated: every number is measured on the actual bytes that would have gone into the model's context.

```bash
npm install langchain-lyceum
```

## Usage

```ts
import { wrapTools } from "langchain-lyceum";
import { readFileTool, searchTool } from "./my-tools.js";

const tools = wrapTools([readFileTool, searchTool]);

// pass `tools` to your agent exactly as before — createReactAgent, etc.
```

That's it. `wrapTools` shares one dedupe ledger across every tool you pass it, so if the agent reads the same file via two different tools, the second read still collapses.

For a single tool, or to control the shared ledger yourself:

```ts
import { wrapTool, SeenLedger } from "langchain-lyceum";

const ledger = new SeenLedger();
const wrapped = wrapTool(myTool, ledger, {
  budgetTokens: 4000,        // cap any single tool result to this many tokens
  onCompress: (name, result) => {
    console.log(`${name}: saved ${result.savedFraction * 100}%`);
  },
});
```

## What it actually does

- **Dedupe** — if a tool returns byte-identical content it already returned earlier in the same run, the repeat is replaced with a short pointer instead of being sent again.
- **Cap** — output over the token budget is trimmed to a fragment, with a note telling the model to ask for the specific section it needs.
- **Strip** — repeated lines and other machine noise inside a single result get collapsed.

None of this changes what the tool *does* — only what the agent has to pay to read the result.

## Why this isn't a `thrift` dependency

`thrift` (The Lyceum's compression package name) isn't published standalone on npm — that name is already Apache Thrift. This package vendors the compression engine directly so it works correctly for anyone installing it outside the monorepo, rather than depending on a name that would silently resolve to an unrelated RPC framework.

## License

MIT
