/**
 * Agent Switcher Extension
 * 
 * Permite alternar entre diferentes "agentes" (personas/roles) almacenados
 * como archivos de system prompt en la carpeta agents/
 * 
 * Uso:
 *   /agent          - Lista y permite seleccionar un agente
 *   /agent <nombre> - Activa directamente un agente
 *   /agent none     - Desactiva el agente actual (vuelve al prompt base)
 * 
 * Estructura esperada:
 *   .pi/agents/           (project-local)
 *   ~/.pi/agent/agents/   (global)
 * 
 * Cada agente es un archivo .md con el system prompt completo.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { readdir, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { homedir } from "node:os";

interface Agent {
  name: string;
  path: string;
  scope: "project" | "global";
}

interface AgentState {
  currentAgent?: string;
  availableAgents: Agent[];
}

const STATE_KEY = "agent-switcher-state";

// Estado en memoria (se pierde al recargar, pero se reconstruye desde sessionManager)
let memoryState: AgentState = { availableAgents: [] };

/**
 * Recupera el estado desde las entradas de la sesión
 */
function restoreState(ctx: ExtensionContext): AgentState {
  const entries = ctx.sessionManager.getEntries();
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === STATE_KEY && entry.data) {
      return entry.data as AgentState;
    }
  }
  return { availableAgents: [] };
}

/**
 * Guarda el estado en la sesión
 */
function saveState(pi: ExtensionAPI, state: AgentState): void {
  pi.appendEntry(STATE_KEY, state);
}

/**
 * Encuentra todos los agentes disponibles en las carpetas agents/
 */
async function discoverAgents(cwd: string): Promise<Agent[]> {
  const agents: Agent[] = [];
  const seen = new Set<string>();

  // Rutas a buscar (project-local tiene prioridad)
  const searchPaths: { path: string; scope: "project" | "global" }[] = [];

  // 1. Project-local: .pi/agents/
  const projectAgentsPath = join(cwd, ".pi", "agent");
  if (existsSync(projectAgentsPath)) {
    searchPaths.push({ path: projectAgentsPath, scope: "project" });
  }

  // 2 Global: ~/.pi/agent/agents/
  const PI_DIR = join(homedir(), ".pi");

  const dirs = [
    join(PI_DIR, "agent"),
    join(PI_DIR, "agent/boletia"),
    join(PI_DIR, "agent/front"),
    join(PI_DIR, "agent/tdd"),
    join(PI_DIR, "agent/pi-pi"),
    join(PI_DIR, ".claude", "agent"),
    join(PI_DIR, ".pi", "agent"),
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;

        searchPaths.push({ path: dir, scope: "global" });
      }
    } catch { }
  }

  // Buscar archivos .md en cada ruta
  for (const { path, scope } of searchPaths) {
    try {
      const files = await readdir(path);
      for (const file of files) {
        if (extname(file) === ".md") {
          const name = basename(file, ".md");
          // Los agentes de proyecto sobreescriben los globales
          if (!seen.has(name)) {
            seen.add(name);
            agents.push({
              name,
              path: join(path, file),
              scope,
            });
          }
        }
      }
    } catch {
      // Ignorar errores de lectura
    }
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Carga el contenido de un agente
 */
async function loadAgent(agent: Agent): Promise<string | null> {
  try {
    return await readFile(agent.path, "utf-8");
  } catch {
    return null;
  }
}

export default function agentSwitcher(pi: ExtensionAPI) {
  // Evento: al iniciar la sesión, descubrir agentes disponibles
  pi.on("session_start", async (_event, ctx) => {
    // Restaurar estado desde la sesión
    const savedState = restoreState(ctx);
    memoryState = { ...savedState };

    // Descubrir agentes disponibles
    memoryState.availableAgents = await discoverAgents(ctx.cwd);
    saveState(pi, memoryState);

    if (memoryState.availableAgents.length > 0) {
      const current = memoryState.currentAgent;
      const agentList = memoryState.availableAgents.map(a =>
        current === a.name ? `• ${a.name} (${a.scope}) [activo]` : `  ${a.name} (${a.scope})`
      ).join("\n");

      ctx.ui.notify(
        `Agent Switcher: ${memoryState.availableAgents.length} agente(s) disponible(s). Usa /agent para seleccionar.\n${agentList}`,
        "info"
      );

      // Mostrar agente activo en el footer
      if (current) {
        ctx.ui.setStatus("agent-switcher", `Agent: ${current}`);
      }
    }
  });

  // Evento: modificar el system prompt antes de enviar al agente
  pi.on("before_agent_start", async (event) => {
    if (memoryState.currentAgent) {
      const agent = memoryState.availableAgents.find(a => a.name === memoryState.currentAgent);
      if (agent) {
        const agentPrompt = await loadAgent(agent);
        if (agentPrompt) {
          // Reemplazar completamente el system prompt con el del agente
          // Pero preservamos el append del usuario si existe
          const userAppend = event.systemPromptOptions.appendSystemPrompt || "";

          let newPrompt = agentPrompt.trim();
          if (userAppend) {
            newPrompt += "\n\n" + userAppend;
          }

          return {
            systemPrompt: newPrompt,
          };
        }
      }
    }

    // No hay agente activo, usar el prompt por defecto
    return { systemPrompt: event.systemPrompt };
  });

  // Comando: /agent para listar/seleccionar agentes
  pi.registerCommand("agent", {
    description: "Listar o cambiar de agente",
    paramsDescription: "[nombre|none]",
    handler: async (args, ctx) => {
      // Si no hay agentes disponibles, intentar redescubrir
      if (memoryState.availableAgents.length === 0) {
        memoryState.availableAgents = await discoverAgents(ctx.cwd);
        saveState(pi, memoryState);
      }

      // Comando: /agent none - Desactivar agente
      if (args?.trim().toLowerCase() === "none") {
        memoryState.currentAgent = undefined;
        saveState(pi, memoryState);
        ctx.ui.setStatus("agent-switcher", undefined);
        ctx.ui.notify("Agente desactivado. Usando system prompt por defecto.", "success");
        return;
      }

      // Comando: /agent <nombre> - Activar agente específico
      if (args?.trim()) {
        const searchName = args.trim().toLowerCase();
        const agent = memoryState.availableAgents.find(
          a => a.name.toLowerCase() === searchName
        );

        if (agent) {
          memoryState.currentAgent = agent.name;
          saveState(pi, memoryState);
          ctx.ui.setStatus("agent-switcher", `Agent: ${agent.name}`);
          ctx.ui.notify(`Agente activado: ${agent.name} (${agent.scope})`, "success");

          // Mostrar preview del prompt
          const preview = await loadAgent(agent);
          if (preview) {
            const firstLine = preview.split("\n")[0].slice(0, 60);
            ctx.ui.notify(`Preview: ${firstLine}...`, "info");
          }
        } else {
          const available = memoryState.availableAgents.map(a => a.name).join(", ") || "ninguno";
          ctx.ui.notify(`Agente "${args}" no encontrado. Disponibles: ${available}`, "error");
        }
        return;
      }

      // Comando: /agent (sin args) - Mostrar selector interactivo
      if (memoryState.availableAgents.length === 0) {
        ctx.ui.notify(
          "No se encontraron agentes. Crea archivos .md en .pi/agents/ o ~/.pi/agent/agents/",
          "error"
        );
        return;
      }

      // Opciones para el selector (ctx.ui.select espera string[], no objetos)
      const optionStrings: string[] = [];

      // Opción para desactivar
      optionStrings.push(
        memoryState.currentAgent
          ? `Desactivar agente actual (${memoryState.currentAgent})`
          : "Sin agente (prompt por defecto)"
      );

      // Agentes disponibles
      for (const agent of memoryState.availableAgents) {
        const marker = memoryState.currentAgent === agent.name ? " [activo]" : "";
        optionStrings.push(`${agent.name} (${agent.scope})${marker}`);
      }

      const selected = await ctx.ui.select("Selecciona un agente:", optionStrings);

      if (selected === undefined) return; // usuario canceló

      // Determinar si seleccionó la opción de desactivar
      const isDeactivate =
        selected.startsWith("Desactivar") || selected.startsWith("Sin agente");

      if (isDeactivate) {
        memoryState.currentAgent = undefined;
        saveState(pi, memoryState);
        ctx.ui.setStatus("agent-switcher", undefined);
        ctx.ui.notify("Agente desactivado. Reinicia la conversación para aplicar.", "success");
      } else {
        // Extraer el nombre del agente del string seleccionado
        // Formato: "nombre (scope)[ activo]"
        const agentName = selected.split(" (")[0];
        memoryState.currentAgent = agentName;
        saveState(pi, memoryState);
        ctx.ui.setStatus("agent-switcher", `Agent: ${agentName}`);
        ctx.ui.notify(`Agente "${agentName}" seleccionado. Reinicia la conversación para aplicar.`, "success");
      }
    },
  });

  // Comando: /agents para listar agentes disponibles (info only)
  pi.registerCommand("agents", {
    description: "Listar todos los agentes disponibles",
    handler: async (_args, ctx) => {
      if (memoryState.availableAgents.length === 0) {
        ctx.ui.notify(
          "No hay agentes disponibles.\n\nCrea archivos .md en:\n  • .pi/agents/ (proyecto)\n  • ~/.pi/agent/agents/ (global)",
          "info"
        );
        return;
      }

      const lines = [
        "Agentes disponibles:",
        "",
        ...memoryState.availableAgents.map(a => {
          const marker = memoryState.currentAgent === a.name ? "▸ " : "  ";
          return `${marker}${a.name} (${a.scope})`;
        }),
        "",
        "Usa /agent <nombre> para activar uno",
      ];

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
