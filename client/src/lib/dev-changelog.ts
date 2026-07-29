/**
 * Daily Development Changelog
 *
 * Update this file each day with what changed. The most recent entry
 * is shown as a banner on workspace pages so users witness the product
 * evolving day by day.
 *
 * Format:
 *   { day: number, date: "YYYY-MM-DD", title: string, description: string }
 */

export interface ChangelogEntry {
  day: number;
  date: string;
  title: string;
  description: string;
}

const CHANGELOG: ChangelogEntry[] = [
  {
    day: 1,
    date: "2026-07-29",
    title: "Launch Day 🚀",
    description:
      "Live beta is open. No more waiting room — everyone goes straight to the workspace. Floating social widget added so you can book a call or join Slack from anywhere.",
  },
  {
    day: 2,
    date: "2026-07-30",
    title: "Workspace Foundations",
    description:
      "Task onboarding flow live. Choose from AI-suggested tasks or create custom ones, assign AI agents by role, set timeframes and dependencies. Workflow graph view added.",
  },
  {
    day: 3,
    date: "2026-07-31",
    title: "Agent Collaboration",
    description:
      "AI agents now communicate in sequence — human output triggers the next AI in the chain. Real-time OpenRouter streaming integrated. Task status updates ripple through the graph.",
  },
  {
    day: 4,
    date: "2026-08-01",
    title: "Session Persistence",
    description:
      "Sessions save to localStorage. Resume incomplete sessions from the home page. Session history shows progress bars, completion status, and quick-resume buttons.",
  },
  {
    day: 5,
    date: "2026-08-02",
    title: "MCP Inspector & Admin",
    description:
      "MCP Inspector panel inside the canvas — browse tools, call them with custom args, inspect responses. Admin dashboard for monitoring orders and license keys.",
  },
];

export function getLatestChangelog(): ChangelogEntry {
  return CHANGELOG[CHANGELOG.length - 1];
}

export function getChangelogForDay(day: number): ChangelogEntry | undefined {
  return CHANGELOG.find((e) => e.day === day);
}

export function getTotalDays(): number {
  return CHANGELOG.length;
}

export default CHANGELOG;
