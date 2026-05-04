/**
 * Agent Team — Dispatcher-only orchestrator with grid dashboard
 *
 * The primary Pi agent has NO codebase tools. It can ONLY delegate work
 * to specialist agents via the `dispatch_agent` tool. Each specialist
 * maintains its own Pi session for cross-invocation memory.
 *
 * Loads agent definitions from ~/.pi/agent/*.md.
 * Teams are defined in ~/.pi/agent/teams.yaml — on boot a select dialog lets
 * you pick which team to work with. Only team members are available for dispatch.
 *
 * Commands:
 *   /agents-team          — switch active team
 *   /agents-list          — list loaded agents
 *   /agents-grid N        — set column count (default 2)
 *
 * Usage: pi -e extensions/agent-team.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text, type AutocompleteItem, truncateToWidth, visibleWidth, Markdown, matchesKey } from "@mariozechner/pi-tui";
import { spawn } from "child_process";
import { readdirSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { applyExtensionDefaults } from "./themeMap.ts";

// ── Types ────────────────────────────────────────

interface AgentDef {
  name: string;
  description: string;
  tools: string;
  systemPrompt: string;
  file: string;
}


// ── Expand Feature ──
interface ToolCallLog {
  name: string;
  args: any;
  timestamp: number;
}

interface AgentState {
  def: AgentDef;
  status: "idle" | "running" | "done" | "error";
  task: string;
  toolCount: number;
  elapsed: number;
  lastWork: string;
  contextPct: number;
  sessionFile: string | null;
  runCount: number;
  timer?: ReturnType<typeof setInterval>;
  // ── Expand Feature ──
  index: number;
  allOutput: string;
  toolCalls: ToolCallLog[];
}

// ── Display Name Helper ──────────────────────────

function displayName(name: string): string {
  return name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}


// ── Expand Feature: Agent Expanded Overlay ──────────────────────

class AgentExpandedOverlay {
  private state: AgentState;
  private theme: any;
  private tui: any;
  private onClose: () => void;
  private scrollOffset = 0;
  private contentHeight = 20;
  private renderedMdLines: string[] = [];

  constructor(state: AgentState, theme: any, tui: any, onClose: () => void) {
    this.state = state;
    this.theme = theme;
    this.tui = tui;
    this.onClose = onClose;
  }

  render(width: number): string[] {
    const w = width;

    // ── Border helpers ──
    const borderFg = (s: string) => this.theme.fg("accent", s);
    const dimFg = (s: string) => this.theme.fg("dim", s);

    // ── Header ──
    const name = displayName(this.state.def.name);
    const icon = this.state.status === "idle" ? "○"
      : this.state.status === "running" ? "●"
      : this.state.status === "done" ? "✓" : "✗";
    const elapsed = Math.round(this.state.elapsed / 1000);
    const pct = Math.ceil(this.state.contextPct);

    const headerTop = borderFg("┌" + "─".repeat(w - 2) + "┐");
    const headerContent = " " +
      this.theme.fg("accent", this.theme.bold(name)) +
      dimFg(`  ${icon} ${this.state.status}  task: ${this.state.task || "(none)"}  tools: ${this.state.toolCount}  ${elapsed}s  ctx: ${pct}%`);
    const headerPad = Math.max(0, w - 2 - visibleWidth(headerContent));
    const headerName = borderFg("│") + headerContent + " ".repeat(headerPad) + borderFg("│");
    const headerSep = dimFg("├" + "─".repeat(w - 2) + "┤");

    // Use a conservative header height (3 rows)
    const headerRows = 3;

    // ── Footer ──
    const footerSep = dimFg("├" + "─".repeat(w - 2) + "┤");
    const footerBottom = borderFg("└" + "─".repeat(w - 2) + "┘");
    const footerRows = 3;

    // ── Available content area ──
    const termHeight = this.tui?.rows ?? process.stdout.rows ?? 24;
    const maxOverlayH = Math.floor(termHeight * 0.85);
    this.contentHeight = Math.max(5, maxOverlayH - headerRows - footerRows - 4);

    // ── Render Markdown ──
    const mdContent = this.state.allOutput || "(no output yet)";
    const mdTheme = getMarkdownTheme();
    const md = new Markdown(mdContent, 0, 0, mdTheme);
    this.renderedMdLines = md.render(w - 4);

    const maxScroll = Math.max(0, this.renderedMdLines.length - this.contentHeight);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));

    const visibleLines = this.renderedMdLines.slice(
      this.scrollOffset,
      this.scrollOffset + this.contentHeight,
    );

    // ── Assemble ──
    const lines: string[] = [];
    lines.push(headerTop);
    lines.push(headerName);
    lines.push(headerSep);
    for (const mdLine of visibleLines) {
      lines.push(borderFg("│") + " " + mdLine + " " + borderFg("│"));
    }
    // Pad if needed
    const padCount = this.contentHeight - visibleLines.length;
    for (let i = 0; i < padCount; i++) {
      lines.push(borderFg("│") + " ".repeat(w - 2) + borderFg("│"));
    }
    lines.push(footerSep);
    const scrollInfo = `Ln ${this.scrollOffset + 1}/${this.renderedMdLines.length || 1}`;
    const helpText = "↑↓/jk line  PgUp/PgDn page  Home/End  Esc close";
    const footerPad = Math.max(0, w - 2 - visibleWidth(helpText) - visibleWidth(scrollInfo) - 2);
    lines.push(
      borderFg("│") + " " +
      this.theme.fg("muted", helpText) +
      " ".repeat(footerPad) +
      dimFg(scrollInfo) +
      " " + borderFg("│"),
    );
    lines.push(footerBottom);

    return lines;
  }

  invalidate() {
    // Clear caches so render() rebuilds with fresh state + theme
    this.renderedMdLines = [];
    this.contentHeight = 0;

  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onClose();
      return;
    }

    const maxScroll = Math.max(0, this.renderedMdLines.length - this.contentHeight);

    if (data === "up" || data === "k") {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      return;
    }
    if (data === "down" || data === "j") {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
      return;
    }
    if (data === "pageup") {
      this.scrollOffset = Math.max(0, this.scrollOffset - this.contentHeight);
      return;
    }
    if (data === "pagedown") {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + this.contentHeight);
      return;
    }
    if (data === "home") {
      this.scrollOffset = 0;
      return;
    }
    if (data === "end") {
      this.scrollOffset = maxScroll;
      return;
    }

  }

  dispose() {
    this.onClose = () => {};
  }
}

// ── Expand Feature: showAgentOverlay ────────────────────────────

async function showAgentOverlay(
  agent: AgentState,
  ctx: any,
): Promise<void> {
  await ctx.ui.custom<void>(
    (tui: any, theme: any, _keybindings: any, done: () => void) => {
      return new AgentExpandedOverlay(agent, theme, tui, () => done());
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "80%",
        maxHeight: "90%",
      },
    },
  );
}

// ── Teams YAML Parser ────────────────────────────

function parseTeamsYaml(raw: string): Record<string, string[]> {
  const teams: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of raw.split("\n")) {
    const teamMatch = line.match(/^(\S[^:]*):$/);
    if (teamMatch) {
      current = teamMatch[1].trim();
      teams[current] = [];
      continue;
    }
    const itemMatch = line.match(/^\s+-\s+(.+)$/);
    if (itemMatch && current) {
      teams[current].push(itemMatch[1].trim());
    }
  }
  return teams;
}

// ── Frontmatter Parser ───────────────────────────

function parseAgentFile(filePath: string): AgentDef | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }

    if (!frontmatter.name) return null;

    return {
      name: frontmatter.name,
      description: frontmatter.description || "",
      tools: frontmatter.tools || "read,grep,find,ls",
      systemPrompt: match[2].trim(),
      file: filePath,
    };
  } catch {
    return null;
  }
}

const PI_DIR = join(homedir(), ".pi");

function scanAgentDirs(): AgentDef[] {
  const dirs = [
    join(PI_DIR, "agent"),
    join(PI_DIR, "agent/boletia"),
    join(PI_DIR, "agent/front"),
    join(PI_DIR, "agent/tdd"),
    join(PI_DIR, "agent/pi-pi"),
    join(PI_DIR, ".claude", "agent"),
    join(PI_DIR, ".pi", "agent"),
  ];

  const agents: AgentDef[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        const fullPath = resolve(dir, file);
        const def = parseAgentFile(fullPath);
        if (def && !seen.has(def.name.toLowerCase())) {
          seen.add(def.name.toLowerCase());
          agents.push(def);
        }
      }
    } catch { }
  }

  return agents;
}

// ── Extension ────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const agentStates: Map<string, AgentState> = new Map();
  let allAgentDefs: AgentDef[] = [];
  let teams: Record<string, string[]> = {};
  let activeTeamName = "";
  let gridCols = 2;
  let widgetCtx: any;
  let sessionDir = "";
  let contextWindow = 0;

  function loadAgents() {
    // Create session storage dir
    sessionDir = join(PI_DIR, "agent-sessions");
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    // Load all agent definitions
    allAgentDefs = scanAgentDirs();

    // Load teams from ~/.pi/agent/teams.yaml
    const teamsPath = join(PI_DIR, "agent", "teams.yaml");
    if (existsSync(teamsPath)) {
      try {
        teams = parseTeamsYaml(readFileSync(teamsPath, "utf-8"));
      } catch {
        teams = {};
      }
    } else {
      teams = {};
    }

    // If no teams defined, create a default "all" team
    if (Object.keys(teams).length === 0) {
      teams = { all: allAgentDefs.map(d => d.name) };
    }
  }

  function activateTeam(teamName: string) {
    activeTeamName = teamName;
    const members = teams[teamName] || [];
    const defsByName = new Map(allAgentDefs.map(d => [d.name.toLowerCase(), d]));

    agentStates.clear();
    let idx = 0; // ── Expand Feature ──
    for (const member of members) {
      idx++;
      const def = defsByName.get(member.toLowerCase());
      if (!def) continue;
      const key = def.name.toLowerCase().replace(/\s+/g, "-");
      const sessionFile = join(sessionDir, `${key}.json`);
      agentStates.set(def.name.toLowerCase(), {
        def,
        status: "idle",
        task: "",
        toolCount: 0,
        elapsed: 0,
        lastWork: "",
        contextPct: 0,
        sessionFile: existsSync(sessionFile) ? sessionFile : null,
        runCount: 0,
        // ── Expand Feature ──
        index: idx,
        allOutput: "",
        toolCalls: [],
      });
    }

    // Auto-size grid columns based on team size
    const size = agentStates.size;
    gridCols = size <= 3 ? size : size === 4 ? 2 : 3;
  }

  // ── Grid Rendering ───────────────────────────

  function renderCard(state: AgentState, colWidth: number, theme: any): string[] {
    const w = colWidth - 2;
    const trunc = (s: string, max: number) => truncateToWidth(s, max);

    const statusColor = state.status === "idle" ? "dim"
      : state.status === "running" ? "accent"
        : state.status === "done" ? "success" : "error";
    const statusIcon = state.status === "idle" ? "○"
      : state.status === "running" ? "●"
        : state.status === "done" ? "✓" : "✗";

    const name = displayName(state.def.name);
    // ── Expand Feature ──
    const indexStr = `#${state.index}`;
    const maxNameWidth = Math.max(0, w - indexStr.length - 1);
    const namePart = trunc(name, maxNameWidth);
    const namePartVis = visibleWidth(namePart);
    const padBeforeIndex = Math.max(0, w - 1 - namePartVis - indexStr.length);
    const nameContent = " " + theme.fg("accent", theme.bold(namePart)) + " ".repeat(padBeforeIndex) + theme.fg("dim", indexStr);
    const nameVisible = w;

    const statusStr = `${statusIcon} ${state.status}`;
    const timeStr = state.status !== "idle" ? ` ${Math.round(state.elapsed / 1000)}s` : "";
    const statusLine = theme.fg(statusColor, statusStr + timeStr);
    const statusVisible = statusStr.length + timeStr.length;

    // Context bar: 5 blocks + percent
    const filled = Math.ceil(state.contextPct / 20);
    const bar = "#".repeat(filled) + "-".repeat(5 - filled);
    const ctxStr = `[${bar}] ${Math.ceil(state.contextPct)}%`;
    const ctxLine = theme.fg("dim", ctxStr);
    const ctxVisible = ctxStr.length;

    const workRaw = state.task
      ? (state.lastWork || state.task)
      : state.def.description;
    const workText = trunc(workRaw, Math.min(50, w - 1));
    const workLine = theme.fg("muted", workText);
    const workVisible = workText.length;

    const top = "┌" + "─".repeat(w) + "┐";
    const bot = "└" + "─".repeat(w) + "┘";
    const border = (content: string, visLen: number) =>
      theme.fg("dim", "│") + content + " ".repeat(Math.max(0, w - visLen)) + theme.fg("dim", "│");

    return [
      theme.fg("dim", top),
      border(nameContent, nameVisible),
      border(" " + statusLine, 1 + statusVisible),
      border(" " + ctxLine, 1 + ctxVisible),
      border(" " + workLine, 1 + workVisible),
      theme.fg("dim", bot),
    ];
  }

  function updateWidget() {
    if (!widgetCtx) return;

    widgetCtx.ui.setWidget("agent-team", (_tui: any, theme: any) => {
      const text = new Text("", 0, 1);

      return {
        render(width: number): string[] {
          if (agentStates.size === 0) {
            text.setText(theme.fg("dim", "No agents found. Add .md files to agents/"));
            return text.render(width);
          }

          const cols = Math.min(gridCols, agentStates.size);
          const gap = 1;
          const colWidth = Math.floor((width - gap * (cols - 1)) / cols);
          const agents = Array.from(agentStates.values());
          const rows: string[][] = [];

          for (let i = 0; i < agents.length; i += cols) {
            const rowAgents = agents.slice(i, i + cols);
            const cards = rowAgents.map(a => renderCard(a, colWidth, theme));

            while (cards.length < cols) {
              cards.push(Array(6).fill(" ".repeat(colWidth)));
            }

            const cardHeight = cards[0].length;
            for (let line = 0; line < cardHeight; line++) {
              rows.push(cards.map(card => card[line] || ""));
            }
          }

          const output = rows.map(cols => cols.join(" ".repeat(gap)));
          text.setText(output.join("\n"));
          return text.render(width);
        },
        invalidate() {
    // Clear caches so render() rebuilds with fresh state + theme
    this.renderedMdLines = [];
    this.contentHeight = 0;
          text.invalidate();
        },
      };
    });
  }

  // ── Dispatch Agent (returns Promise) ─────────

  function dispatchAgent(
    agentName: string,
    task: string,
    ctx: any,
  ): Promise<{ output: string; exitCode: number; elapsed: number }> {
    const key = agentName.toLowerCase();
    const state = agentStates.get(key);
    if (!state) {
      return Promise.resolve({
        output: `Agent "${agentName}" not found. Available: ${Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ")}`,
        exitCode: 1,
        elapsed: 0,
      });
    }

    if (state.status === "running") {
      return Promise.resolve({
        output: `Agent "${displayName(state.def.name)}" is already running. Wait for it to finish.`,
        exitCode: 1,
        elapsed: 0,
      });
    }

    state.status = "running";
    state.task = task;
    state.toolCount = 0;
    state.elapsed = 0;
    state.lastWork = "";
    // ── Expand Feature ──
    state.allOutput = "";
    state.toolCalls = [];
    state.runCount++;
    updateWidget();

    const startTime = Date.now();
    state.timer = setInterval(() => {
      state.elapsed = Date.now() - startTime;
      updateWidget();
    }, 1000);

    const model = ctx.model
      ? `${ctx.model.provider}/${ctx.model.id}`
      : "openrouter/google/gemini-3-flash-preview";

    // Session file for this agent
    const agentKey = state.def.name.toLowerCase().replace(/\s+/g, "-");
    const agentSessionFile = join(sessionDir, `${agentKey}.json`);

    // Build args — first run creates session, subsequent runs resume
    const args = [
      "--mode", "json",
      "-p",
      "--model", model,
      "--tools", state.def.tools,
      "--thinking", "off",
      "--append-system-prompt", state.def.systemPrompt,
      "--session", agentSessionFile,
    ];

    // Continue existing session if we have one
    if (state.sessionFile) {
      args.push("-c");
    }

    args.push(task);

    const textChunks: string[] = [];

    return new Promise((resolve) => {
      const proc = spawn("pi", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      let buffer = "";

      proc.stdout!.setEncoding("utf-8");
      proc.stdout!.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "message_update") {
              const delta = event.assistantMessageEvent;
              if (delta?.type === "text_delta") {
                textChunks.push(delta.delta || "");
                state.allOutput += delta.delta || ""; // ── Expand Feature ──
                // lastWork: only the last meaningful line, capped for card display
                const lastLine = state.allOutput.split("\n").filter((l: string) => l.trim()).pop() || "";
                state.lastWork = lastLine.length > 80 ? lastLine.slice(0, 77) + "..." : lastLine;
                updateWidget();
              }
            } else if (event.type === "tool_execution_start") {
              state.toolCount++;
              // ── Expand Feature ──
              state.toolCalls.push({
                name: event.toolName || "unknown",
                args: event.args || {},
                timestamp: Date.now(),
              });
              updateWidget();
            } else if (event.type === "message_end") {
              const msg = event.message;
              if (msg?.usage && contextWindow > 0) {
                state.contextPct = ((msg.usage.input || 0) / contextWindow) * 100;
                updateWidget();
              }
            } else if (event.type === "agent_end") {
              const msgs = event.messages || [];
              const last = [...msgs].reverse().find((m: any) => m.role === "assistant");
              if (last?.usage && contextWindow > 0) {
                state.contextPct = ((last.usage.input || 0) / contextWindow) * 100;
                updateWidget();
              }
            }
          } catch { }
        }
      });

      proc.stderr!.setEncoding("utf-8");
      proc.stderr!.on("data", () => { });

      proc.on("close", (code) => {
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer);
            if (event.type === "message_update") {
              const delta = event.assistantMessageEvent;
              if (delta?.type === "text_delta") textChunks.push(delta.delta || "");
            }
          } catch { }
        }

        clearInterval(state.timer);
        state.elapsed = Date.now() - startTime;
        state.status = code === 0 ? "done" : "error";

        // Mark session file as available for resume
        if (code === 0) {
          state.sessionFile = agentSessionFile;
        }

        const full = textChunks.join("");
        const doneLine = full.split("\n").filter((l: string) => l.trim()).pop() || "";
        state.lastWork = doneLine.length > 80 ? doneLine.slice(0, 77) + "..." : doneLine;
        updateWidget();

        ctx.ui.notify(
          `${displayName(state.def.name)} ${state.status} in ${Math.round(state.elapsed / 1000)}s`,
          state.status === "done" ? "success" : "error"
        );

        resolve({
          output: full,
          exitCode: code ?? 1,
          elapsed: state.elapsed,
        });
      });

      proc.on("error", (err) => {
        clearInterval(state.timer);
        state.status = "error";
        state.lastWork = `Error: ${err.message}`;
        updateWidget();
        resolve({
          output: `Error spawning agent: ${err.message}`,
          exitCode: 1,
          elapsed: Date.now() - startTime,
        });
      });
    });
  }

  // ── dispatch_agent Tool (registered at top level) ──

  pi.registerTool({
    name: "dispatch_agent",
    label: "Dispatch Agent",
    description: "Dispatch a task to a specialist agent. The agent will execute the task and return the result. Use the system prompt to see available agent names.",
    parameters: Type.Object({
      agent: Type.String({ description: "Agent name (case-insensitive)" }),
      task: Type.String({ description: "Task description for the agent to execute" }),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const { agent, task } = params as { agent: string; task: string };

      try {
        if (onUpdate) {
          onUpdate({
            content: [{ type: "text", text: `Dispatching to ${agent}...` }],
            details: { agent, task, status: "dispatching" },
          });
        }

        const result = await dispatchAgent(agent, task, ctx);

        const truncated = result.output.length > 8000
          ? result.output.slice(0, 8000) + "\n\n... [truncated]"
          : result.output;

        const status = result.exitCode === 0 ? "done" : "error";
        const summary = `[${agent}] ${status} in ${Math.round(result.elapsed / 1000)}s`;

        return {
          content: [{ type: "text", text: `${summary}\n\n${truncated}` }],
          details: {
            agent,
            task,
            status,
            elapsed: result.elapsed,
            exitCode: result.exitCode,
            fullOutput: result.output,
          },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error dispatching to ${agent}: ${err?.message || err}` }],
          details: { agent, task, status: "error", elapsed: 0, exitCode: 1, fullOutput: "" },
        };
      }
    },

    renderCall(args, theme) {
      const agentName = (args as any).agent || "?";
      const task = (args as any).task || "";
      const preview = task.length > 60 ? task.slice(0, 57) + "..." : task;
      return new Text(
        theme.fg("toolTitle", theme.bold("dispatch_agent ")) +
        theme.fg("accent", agentName) +
        theme.fg("dim", " — ") +
        theme.fg("muted", preview),
        0, 0,
      );
    },

    renderResult(result, options, theme) {
      const details = result.details as any;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      // Streaming/partial result while agent is still running
      if (options.isPartial || details.status === "dispatching") {
        return new Text(
          theme.fg("accent", `● ${details.agent || "?"}`) +
          theme.fg("dim", " working..."),
          0, 0,
        );
      }

      const icon = details.status === "done" ? "✓" : "✗";
      const color = details.status === "done" ? "success" : "error";
      const elapsed = typeof details.elapsed === "number" ? Math.round(details.elapsed / 1000) : 0;
      const header = theme.fg(color, `${icon} ${details.agent}`) +
        theme.fg("dim", ` ${elapsed}s`);

      if (options.expanded && details.fullOutput) {
        const output = details.fullOutput.length > 4000
          ? details.fullOutput.slice(0, 4000) + "\n... [truncated]"
          : details.fullOutput;
        return new Text(header + "\n" + theme.fg("muted", output), 0, 0);
      }

      return new Text(header, 0, 0);
    },
  });

  // ── Commands ─────────────────────────────────

  pi.registerCommand("teams", {
    description: "Select a team to work with",
    handler: async (_args, ctx) => {
      widgetCtx = ctx;
      const teamNames = Object.keys(teams);
      if (teamNames.length === 0) {
        ctx.ui.notify("No teams defined in .pi/agents/teams.yaml", "warning");
        return;
      }

      const options = teamNames.map(name => {
        const members = teams[name].map(m => displayName(m));
        return `${name} — ${members.join(", ")}`;
      });

      const choice = await ctx.ui.select("Select Team", options);
      if (choice === undefined) return;

      const idx = options.indexOf(choice);
      const name = teamNames[idx];
      activateTeam(name);
      updateWidget();
      ctx.ui.setStatus("teams", `Team: ${name} (${agentStates.size})`);
      ctx.ui.notify(`Team: ${name} — ${Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ")}`, "info");
    },
  });

  pi.registerCommand("agents-list", {
    description: "List all loaded agents",
    handler: async (_args, _ctx) => {
      widgetCtx = _ctx;
      const names = Array.from(agentStates.values())
        .map(s => {
          const session = s.sessionFile ? "resumed" : "new";
          return `${displayName(s.def.name)} (${s.status}, ${session}, runs: ${s.runCount}): ${s.def.description}`;
        })
        .join("\n");
      _ctx.ui.notify(names || "No agents loaded", "info");
    },
  });

  pi.registerCommand("agents-grid", {
    description: "Set grid columns: /agents-grid <1-6>",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items = ["1", "2", "3", "4", "5", "6"].map(n => ({
        value: n,
        label: `${n} columns`,
      }));
      const filtered = items.filter(i => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : items;
    },
    handler: async (args, _ctx) => {
      widgetCtx = _ctx;
      const n = parseInt(args?.trim() || "", 10);
      if (n >= 1 && n <= 6) {
        gridCols = n;
        _ctx.ui.notify(`Grid set to ${gridCols} columns`, "info");
        updateWidget();
      } else {
        _ctx.ui.notify("Usage: /agents-grid <1-6>", "error");
      }
    },
  });

  // ── System Prompt Override ───────────────────

  pi.on("before_agent_start", async (_event, _ctx) => {
    // Build dynamic agent catalog from active team only
    const agentCatalog = Array.from(agentStates.values())
      .map(s => `### ${displayName(s.def.name)}\n**Dispatch as:** \`${s.def.name}\`\n${s.def.description}\n**Tools:** ${s.def.tools}`)
      .join("\n\n");

    const teamMembers = Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ");

    return {
      systemPrompt: `You are a dispatcher agent. You coordinate specialist agents to accomplish tasks.
You do NOT have direct access to the codebase. You MUST delegate all work through
agents using the dispatch_agent tool.

## Active Team: ${activeTeamName}
Members: ${teamMembers}
You can ONLY dispatch to agents listed below. Do not attempt to dispatch to agents outside this team.

## How to Work
- Analyze if a tool or extensio is available to do the task
- Analyze the user's request and break it into clear sub-tasks
- Choose the right agent(s) for each sub-task
- Dispatch tasks using the dispatch_agent tool
- Review results and dispatch follow-up agents if needed
- If a task fails, try a different agent or adjust the task description
- Summarize the outcome for the user

## Rules
- NEVER try to read, write, or execute code directly — you have no such tools
- ALWAYS use dispatch_agent to get work done
- You can chain agents: use scout to explore, then builder to implement
- You can dispatch the same agent multiple times with different tasks
- Keep tasks focused — one clear objective per dispatch

## Agents

${agentCatalog}`,
    };
  });

  // ── Session Start ────────────────────────────

  pi.on("session_start", async (_event, _ctx) => {
    applyExtensionDefaults(import.meta.url, _ctx);
    // Clear widgets from previous session
    if (widgetCtx) {
      widgetCtx.ui.setWidget("agent-team", undefined);
    }
    widgetCtx = _ctx;
    contextWindow = _ctx.model?.contextWindow || 0;

    // Wipe old agent session files so subagents start fresh
    const sessDir = join(PI_DIR, "agent-sessions");
    if (existsSync(sessDir)) {
      for (const f of readdirSync(sessDir)) {
        if (f.endsWith(".json")) {
          try { unlinkSync(join(sessDir, f)); } catch { }
        }
      }
    }

    loadAgents();

    // Default to first team — use /agents-team to switch
    const teamNames = Object.keys(teams);
    if (teamNames.length > 0) {
      activateTeam(teamNames[0]);
    }

    // Lock down to dispatcher-only (tool already registered at top level)
    pi.setActiveTools(["dispatch_agent"]);

    _ctx.ui.setStatus("agent-team", `Team: ${activeTeamName} (${agentStates.size})`);
    const members = Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ");
    _ctx.ui.notify(
      `Team: ${activeTeamName} (${members})\n` +
      `Team sets loaded from: .pi/agents/teams.yaml\n\n` +
      `/agents-team          Select a team\n` +
      `/agents-list          List active agents and status\n` +
      `/agents-grid <1-6>    Set grid column count`,
      "info",
    );
    updateWidget();

    // Footer: model | team | context bar
    _ctx.ui.setFooter((_tui, theme, _footerData) => ({
      dispose: () => { },
      invalidate() {
    // Clear caches so render() rebuilds with fresh state + theme
    this.renderedMdLines = [];
    this.contentHeight = 0; },
      render(width: number): string[] {
        const model = _ctx.model?.id || "no-model";
        const usage = _ctx.getContextUsage();
        const pct = usage ? usage.percent : 0;
        const filled = Math.round(pct / 10);
        const bar = "#".repeat(filled) + "-".repeat(10 - filled);

        const left = theme.fg("dim", ` ${model}`) +
          theme.fg("muted", " · ") +
          theme.fg("accent", activeTeamName);
        const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);
        const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

        return [truncateToWidth(left + pad + right, width)];
      },
    }));
  });

  // ── Expand Feature: Agent overlay shortcuts Ctrl+1..9 ──────────
  for (let i = 1; i <= 9; i++) {
    pi.registerShortcut(`ctrl+${i}`, {
      description: `Expand agent #${i} detail overlay`,
      handler: async (ctx: any) => {
        const agents = Array.from(agentStates.values());
        const agent = agents.find((a: AgentState) => a.index === i);
        if (!agent) {
          ctx.ui.notify(`No agent at position ${i}`, "warning");
          return;
        }
        await showAgentOverlay(agent, ctx);
      },
    });
  }
}