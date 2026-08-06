/**
 * Download / install data for the web download page.
 *
 * Public on purpose: the tools are MIT, installable from npm, and the README
 * on GitHub shows the same commands. What a subscription gates is the guided
 * setup (guides.ts) and the tarball (/download/cli) — not the commands
 * themselves. This module is the single source the download page renders
 * from, so the page cannot drift from what actually ships.
 *
 * Command discipline: every command here is copy-paste exact — never
 * abbreviated with "..." . A command the operator has to guess at is worse
 * than no command, because they won't know whether the failure is them.
 */

export type ProductId = "brake" | "redteam" | "thrift";
export type OsId = "macos" | "windows" | "linux";

export interface InstallStep {
  title: string;
  /** Copy-paste exact. May contain {placeholder} tokens resolved per-OS. */
  command: string;
  /** What running it should show, so a stuck operator knows if they're stuck. */
  expect?: string;
  /** May contain {placeholder} tokens resolved per-OS (see OsInfo fields). */
  note?: string;
}

export interface InstallEnv {
  id: string;
  label: string;
  /** One-line "what this is for", shown under the card title. */
  tagline: string;
  steps: InstallStep[];
}

export interface Product {
  id: ProductId;
  name: string;
  role: string;
  npmPackage: string;
  bin: string;
  version: string;
  envs: InstallEnv[];
}

export interface OsInfo {
  id: OsId;
  label: string;
  shell: string;
  /** Where npm puts global bins, and how to fix PATH if the CLI isn't found. */
  pathNote: string;
  /** Claude Desktop config path (used by `install claude-desktop`). */
  claudeDesktopConfig: string;
  /** Claude Code settings path (used by `install claude-code`). */
  claudeCodeConfig: string;
  /** Where the ChatGPT skill is written by `install chatgpt`. */
  chatgptSkillDir: string;
}

export const OSES: OsInfo[] = [
  {
    id: "macos",
    label: "macOS",
    shell: "zsh (default) / bash",
    pathNote:
      "npm installs global binaries to `$(npm config get prefix)/bin`. If `brake` is not found after install, add that directory to PATH in ~/.zshrc (or ~/.bash_profile): `export PATH=\"$(npm config get prefix)/bin:$PATH\"`, then open a new terminal.",
    claudeDesktopConfig: "~/Library/Application Support/Claude/claude_desktop_config.json",
    claudeCodeConfig: "~/.claude/settings.json",
    chatgptSkillDir: "~/.brake/skills/ (brake) · ~/.redteam/skills/ (redteam) · ~/.thrift/skills/ (thrift)",
  },
  {
    id: "windows",
    label: "Windows",
    shell: "PowerShell",
    pathNote:
      "npm installs global binaries to %APPDATA%\\npm (added to PATH by the Node.js installer). If `brake` is not found in a new PowerShell window, check `npm config get prefix` and add `%APPDATA%\\npm` to your user PATH in System Properties → Environment Variables.",
    claudeDesktopConfig: "%APPDATA%\\Claude\\claude_desktop_config.json",
    claudeCodeConfig: "%USERPROFILE%\\.claude\\settings.json",
    chatgptSkillDir: "%USERPROFILE%\\.brake\\skills\\ (brake) · %USERPROFILE%\\.redteam\\skills\\ (redteam) · %USERPROFILE%\\.thrift\\skills\\ (thrift)",
  },
  {
    id: "linux",
    label: "Linux",
    shell: "bash (default) / zsh",
    pathNote:
      "npm installs global binaries to `$(npm config get prefix)/bin`. If `brake` is not found after install, add that directory to PATH in ~/.bashrc (or ~/.zshrc): `export PATH=\"$(npm config get prefix)/bin:$PATH\"`, then open a new terminal.",
    claudeDesktopConfig: "~/.config/Claude/claude_desktop_config.json",
    claudeCodeConfig: "~/.claude/settings.json",
    chatgptSkillDir: "~/.brake/skills/ (brake) · ~/.redteam/skills/ (redteam) · ~/.thrift/skills/ (thrift)",
  },
];

const npmEnv = (pkg: string, bin: string, version: string): InstallEnv => ({
  id: "npm",
  label: "Install globally (npm)",
  tagline: "The standard install — puts the CLI on PATH for every host.",
  steps: [
    {
      title: "Install",
      command: `npm install -g ${pkg}`,
      expect: `Installs to the npm global bin. Run \`${bin} --version\` → prints ${version}.`,
    },
    {
      title: "Not found after install?",
      command: "npm config get prefix",
      expect: "Prints the npm prefix; add <prefix>/bin to PATH (see the note for your OS above).",
      note: "npm needs Node ≥ 22.5.0. Check with `node --version` before anything else.",
    },
  ],
});

const npxEnv = (bin: string, smoke: string): InstallEnv => ({
  id: "npx",
  label: "Run without installing (npx)",
  tagline: "One-off runs in CI or a throwaway container — nothing to install.",
  steps: [
    {
      title: "Run once",
      command: `npx -y ${bin} ${smoke}`,
      expect: "Runs the command directly; the package is fetched on demand and not installed globally.",
      note: "`-y` skips the npx confirmation prompt, which matters in non-interactive CI shells.",
    },
  ],
});

const dockerEnv = (bin: string, smoke: string): InstallEnv => ({
  id: "docker",
  label: "Docker",
  tagline: "No official image yet — run the CLI in a stock node:22 container.",
  steps: [
    {
      title: "Run in a disposable container",
      command: `docker run --rm -it -v "$PWD":/work -w /work node:22 npx -y ${bin} ${smoke}`,
      expect: "Runs the command inside node:22 with your current directory mounted at /work.",
      note: "For a persistent image, add `RUN npm install -g <pkg>` to your Dockerfile. Windows PowerShell: use `${PWD}` instead of `$PWD`.",
    },
  ],
});

const claudeDesktopEnv = (bin: string): InstallEnv => ({
  id: "claude-desktop",
  label: "Claude Desktop (MCP)",
  tagline: "Auto-loads the tool via MCP — the model uses it without being told.",
  steps: [
    {
      title: "Wire it in",
      command: `${bin} install claude-desktop`,
      expect: "Adds an MCP server entry to the Claude Desktop config and registers the install.",
      note: "Writes to {claudeDesktopConfig}. Restart Claude Desktop — MCP tools load at session start.",
    },
  ],
});

const claudeCodeEnv = (bin: string, what: string): InstallEnv => ({
  id: "claude-code",
  label: "Claude Code (hook)",
  tagline: what,
  steps: [
    {
      title: "Wire it in",
      command: `${bin} install claude-code`,
      expect: "Adds the hook to the Claude Code settings and registers the install.",
      note: "Writes to {claudeCodeConfig}. Restart Claude Code to pick up the new hook.",
    },
  ],
});

const chatgptEnv = (bin: string): InstallEnv => ({
  id: "chatgpt",
  label: "ChatGPT (skill)",
  tagline: "Installs a skill the ChatGPT Skills API loads on the next context.",
  steps: [
    {
      title: "Wire it in",
      command: `${bin} install chatgpt`,
      expect: "Writes the skill file and registers the install.",
      note: "Writes to {chatgptSkillDir}. Loaded on the next context — no restart of the app needed.",
    },
  ],
});

const ciEnv = (bin: string, step: string): InstallEnv => ({
  id: "ci",
  label: "CI (GitHub Actions)",
  tagline: "Gate every pull request — the cheapest place a check like this can run.",
  steps: [
    {
      title: "Workflow step",
      command: `- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npm install -g ${bin}
- run: ${step}`,
      expect: "The check runs on every push/PR. Exit 1 fails the job.",
      note: "Works on ubuntu, macos and windows runners alike — no platform-specific code needed.",
    },
  ],
});

export const PRODUCTS: Product[] = [
  {
    id: "brake",
    name: "brake",
    role: "Financial safety. Stops the action.",
    npmPackage: "brake",
    bin: "brake",
    version: "1.0.0",
    envs: [
      npmEnv("brake", "brake", "1.0.0"),
      npxEnv("brake", 'scan "export all customer records to s3"'),
      dockerEnv("brake", 'scan "export all customer records to s3"'),
      claudeDesktopEnv("brake"),
      claudeCodeEnv("brake", "A PreToolUse hook on Bash that scans every shell command before it runs and blocks dangerous ones."),
      chatgptEnv("brake"),
      ciEnv("brake", 'brake scan "${{ github.event.pull_request.title }}"'),
    ],
  },
  {
    id: "redteam",
    name: "redteam",
    role: "Operational safety. Stops the argument.",
    npmPackage: "redteam",
    bin: "redteam",
    version: "1.0.0",
    envs: [
      npmEnv("redteam", "redteam", "1.0.0"),
      npxEnv("redteam", 'challenge "This migration is totally safe, no downside at all."'),
      dockerEnv("redteam", 'challenge "This migration is totally safe, no downside at all."'),
      claudeDesktopEnv("redteam"),
      claudeCodeEnv("redteam", "A PreToolUse hook on Write/Edit that challenges every proposed change before it's written."),
      chatgptEnv("redteam"),
      ciEnv("redteam", 'redteam challenge "${{ github.event.pull_request.title }}"'),
    ],
  },
  {
    id: "thrift",
    name: "thrift",
    role: "Data & cost hygiene. Stops the bill.",
    npmPackage: "thrift",
    bin: "thrift",
    version: "1.0.0",
    envs: [
      npmEnv("thrift", "thrift", "1.0.0"),
      npxEnv("thrift", "measure . --passes 5"),
      dockerEnv("thrift", "measure /work --passes 5"),
      claudeDesktopEnv("thrift"),
      claudeCodeEnv("thrift", "Registers the read_lean / run_lean MCP tools — an alternative to the host's read, not a gate."),
      chatgptEnv("thrift"),
      ciEnv("thrift", "thrift compress src/main.ts --budget 4000"),
    ],
  },
];

export function productFor(id: string): Product | null {
  return PRODUCTS.find((p) => p.id === id) ?? null;
}

export function osFor(id: string): OsInfo | null {
  return OSES.find((o) => o.id === id) ?? null;
}
