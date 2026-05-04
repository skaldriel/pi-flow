/**
 * Web Search Extension for Pi
 *
 * Tools:
 *   - search    → Smart router: Context7 (docs) or Exa MCP (web), sin API key
 *   - fetch_url → Direct fetch + Turndown, fallback a Jina Reader
 *
 * Routing logic:
 *   1. Pre-classifier local (sin llamadas API):
 *      - Noticias / eventos actuales → Exa directamente
 *      - Errores / debugging         → Exa directamente
 *      - Queries tipo docs           → intenta Context7
 *   2. Context7 se usa solo si:
 *      - Benchmark score >= 70
 *      - Nombre de librería resuelta aparece en la query
 *      - Si falla → fallback a Exa
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import TurndownService from "turndown";

// ──────────────────────────────────────────────────────────────
// TIPOS
// ──────────────────────────────────────────────────────────────

interface C7Library {
  name: string;
  libraryId: string;
  benchmarkScore: number;
}

type RouteDecision =
  | { source: "context7"; libraryId: string; libraryName: string }
  | { source: "exa"; reason: string };

// ──────────────────────────────────────────────────────────────
// HELPERS: SSE Parser (formato de respuesta de los MCP servers)
// ──────────────────────────────────────────────────────────────

function parseSseText(body: string): string | undefined {
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const data = JSON.parse(line.substring(6));
      const text = data?.result?.content?.[0]?.text;
      if (text) return text;
    } catch {
      // línea inválida, continuar
    }
  }
  return undefined;
}

// ──────────────────────────────────────────────────────────────
// HELPERS: Context7
// ──────────────────────────────────────────────────────────────

function parseC7Libraries(text: string): C7Library[] {
  const libs: C7Library[] = [];
  const blocks = text.split("----------");

  for (const block of blocks) {
    const nameMatch = block.match(/Title:\s*(.+)/);
    const idMatch = block.match(/Context7-compatible library ID:\s*(.+)/);
    const scoreMatch = block.match(/Benchmark Score:\s*([\d.]+)/);

    if (nameMatch && idMatch && scoreMatch) {
      libs.push({
        name: nameMatch[1].trim(),
        libraryId: idMatch[1].trim(),
        benchmarkScore: parseFloat(scoreMatch[1]),
      });
    }
  }

  return libs;
}

async function c7Resolve(query: string, signal?: AbortSignal): Promise<C7Library[]> {
  // Extraer nombre de librería candidato: quitar stop words y tomar primeras palabras
  const STOP_WORDS = new Set([
    "how", "to", "use", "the", "a", "an", "in", "with", "for", "of",
    "and", "or", "is", "are", "what", "when", "where", "why", "does",
    "do", "can", "i", "my", "me", "latest", "best", "get", "set",
    "using", "via", "from", "into", "about", "example", "examples",
    "tutorial", "guide", "documentation", "docs", "reference",
  ]);

  const libraryName = query
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 3)
    .join(" ") || query;

  const res = await fetch("https://mcp.context7.com/mcp", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "resolve-library-id",
        arguments: { query, libraryName },
      },
    }),
  });

  const text = parseSseText(await res.text());
  return text ? parseC7Libraries(text) : [];
}

async function c7QueryDocs(libraryId: string, query: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch("https://mcp.context7.com/mcp", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "query-docs",
        arguments: { libraryId, query },
      },
    }),
  });

  return parseSseText(await res.text()) ?? "No documentation found.";
}

// ──────────────────────────────────────────────────────────────
// HELPERS: Exa MCP
// ──────────────────────────────────────────────────────────────

async function exaSearch(query: string, numResults: number, signal?: AbortSignal): Promise<string> {
  const res = await fetch("https://mcp.exa.ai/mcp", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query,
          type: "auto",
          numResults,
          livecrawl: "fallback",
          contextMaxCharacters: 8000,
        },
      },
    }),
  });

  return parseSseText(await res.text()) ?? "No search results found.";
}

// ──────────────────────────────────────────────────────────────
// ROUTER
// ──────────────────────────────────────────────────────────────

// Indicadores de noticias / eventos actuales → siempre Exa
const NEWS_RE = /\b(latest|news|today|yesterday|recent|current|announced|launched|released|changelog|2024|2025|2026|who is|what happened|when did|just released|new version)\b/i;

// Indicadores de errores / debugging → siempre Exa (Stack Overflow, foros)
const ERROR_RE = /\b(error|bug|crash|fix|issue|exception|undefined|null pointer|failed|broken|not working|TypeError|SyntaxError|ReferenceError|cannot read|is not a function)\b/i;

// Indicadores de documentación → intentar Context7 primero
const DOCS_RE = /\b(how to|tutorial|example|documentation|docs|api|reference|guide|usage|install|configure|setup|import|function|method|hook|component|class|module|syntax|parameter|option|prop|interface)\b/i;

async function route(query: string, signal?: AbortSignal): Promise<RouteDecision> {
  // ── Fast path: Exa directo ──────────────────────────────────
  if (NEWS_RE.test(query)) {
    return { source: "exa", reason: "current events / news detected" };
  }
  if (ERROR_RE.test(query)) {
    return { source: "exa", reason: "error / debugging query — routing to web forums" };
  }

  // ── Slow path: intentar Context7 ───────────────────────────
  if (DOCS_RE.test(query)) {
    try {
      const libs = await c7Resolve(query, signal);
      const top = libs[0];

      if (top && top.benchmarkScore >= 70) {
        // Verificar que el nombre de la librería aparece en la query
        const queryLower = query.toLowerCase();
        const libWords = top.name
          .toLowerCase()
          .split(/[\s.\-/]+/)
          .filter(w => w.length > 2);
        const nameMatch = libWords.some(word => queryLower.includes(word));

        if (nameMatch) {
          return {
            source: "context7",
            libraryId: top.libraryId,
            libraryName: top.name,
          };
        }
      }
    } catch {
      // Context7 no disponible, caer a Exa
    }
  }

  return { source: "exa", reason: "general web search" };
}

// ──────────────────────────────────────────────────────────────
// HTML → MARKDOWN (para fetch_url)
// ──────────────────────────────────────────────────────────────

function makeConverter(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    hr: "---",
  });
  // Eliminar elementos que no aportan contenido útil
  td.remove(["script", "style", "meta", "link", "noscript", "nav", "footer", "iframe", "svg"]);
  return td;
}

function truncate(text: string, maxChars = 20000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n*[Contenido truncado...]*";
}

// ──────────────────────────────────────────────────────────────
// EXTENSIÓN PRINCIPAL
// ──────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const converter = makeConverter();

  // ── Tool: search ─────────────────────────────────────────────
  pi.registerTool({
    name: "search",
    label: "Search",
    description:
      "Smart search that automatically routes to the best source: " +
      "official library documentation via Context7 (React, Vue, Next.js, etc.) " +
      "or general web search via Exa (news, errors, forums, any topic). " +
      "Use this for any question that requires external information.",
    promptSnippet: "Search documentation or the web intelligently",
    promptGuidelines: [
      "Always use 'search' before answering questions about external libraries, APIs, or current events.",
      "Include the library name in the query for documentation lookups (e.g. 'React useEffect cleanup', 'Next.js App Router').",
      "For errors, include the exact error message for better results.",
      "Use 'fetch_url' to read the full content of any URL returned by search.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description:
          "What to search for. For docs: include library name (e.g. 'React useState hook'). " +
          "For web: describe naturally (e.g. 'Node.js 22 new features').",
      }),
      numResults: Type.Optional(
        Type.Number({
          description: "Results to return for web search (1–10, default 5).",
        })
      ),
    }),

    async execute(_id, params, signal, onUpdate, _ctx) {
      const { query, numResults = 5 } = params;
      const count = Math.min(Math.max(numResults, 1), 10);

      onUpdate?.({ content: [{ type: "text", text: "🔍 Analizando query..." }] });

      const decision = await route(query, signal);

      // ── Ruta: Context7 ────────────────────────────────────────
      if (decision.source === "context7") {
        onUpdate?.({
          content: [{ type: "text", text: `📚 Consultando docs de ${decision.libraryName}...` }],
        });

        try {
          const result = await c7QueryDocs(decision.libraryId, query, signal);
          return {
            content: [
              {
                type: "text",
                text: `[via Context7 · ${decision.libraryId}]\n\n${result}`,
              },
            ],
            details: { source: "context7", libraryId: decision.libraryId, libraryName: decision.libraryName },
          };
        } catch {
          onUpdate?.({
            content: [{ type: "text", text: "⚠️ Context7 falló, usando búsqueda web..." }],
          });
        }
      }

      // ── Ruta: Exa MCP (default / fallback) ───────────────────
      onUpdate?.({ content: [{ type: "text", text: `🌐 Buscando en la web... (${decision.reason})` }] });

      const result = await exaSearch(query, count, signal);
      return {
        content: [{ type: "text", text: `[via Exa web search]\n\n${result}` }],
        details: { source: "exa", query, reason: decision.reason },
      };
    },
  });

  // ── Tool: fetch_url ──────────────────────────────────────────
  pi.registerTool({
    name: "fetch_url",
    label: "Fetch URL",
    description:
      "Fetch and read the full content of any web page as clean Markdown. " +
      "Tries direct fetch first (fast, private). " +
      "Falls back to Jina Reader automatically for JavaScript-rendered pages or when content is insufficient.",
    promptSnippet: "Read the full content of any web page",
    promptGuidelines: [
      "Use 'fetch_url' to read the full content of URLs found via 'search'.",
      "Works with both static and JavaScript-heavy pages (automatic fallback).",
    ],
    parameters: Type.Object({
      url: Type.String({
        description: "Full URL to fetch (must start with http:// or https://).",
      }),
    }),

    async execute(_id, params, signal, onUpdate, _ctx) {
      const { url } = params;

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return {
          content: [{ type: "text", text: "❌ La URL debe comenzar con http:// o https://" }],
          isError: true,
        };
      }

      onUpdate?.({ content: [{ type: "text", text: "⬇️ Descargando página..." }] });

      // ── Intento 1: Fetch directo ──────────────────────────────
      try {
        const res = await fetch(url, {
          signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });

        if (res.ok) {
          const contentType = res.headers.get("content-type") ?? "";
          const rawContent = await res.text();

          // Contenido no-HTML (JSON, texto plano, etc.) → devolver tal cual
          if (!contentType.includes("text/html")) {
            return {
              content: [{ type: "text", text: `[via direct fetch · ${contentType}]\n\n${truncate(rawContent)}` }],
              details: { url, source: "direct", contentType },
            };
          }

          // HTML → Markdown con Turndown
          const markdown = converter.turndown(rawContent);

          // Si el contenido es sustancial (>500 chars), devolver
          if (markdown.trim().length > 500) {
            return {
              content: [{ type: "text", text: `[via direct fetch]\n\n${truncate(markdown)}` }],
              details: { url, source: "direct", length: markdown.length },
            };
          }

          // Contenido insuficiente → probable página JS-rendered
          onUpdate?.({
            content: [{ type: "text", text: "⚠️ Contenido insuficiente (página JS-rendered?), usando Jina Reader..." }],
          });
        }
      } catch {
        onUpdate?.({ content: [{ type: "text", text: "⚠️ Fetch directo falló, usando Jina Reader..." }] });
      }

      // ── Intento 2: Jina Reader (fallback) ────────────────────
      try {
        const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
          signal,
          headers: {
            Accept: "text/markdown",
            "X-Return-Format": "markdown",
          },
        });

        if (jinaRes.ok) {
          const content = await jinaRes.text();
          return {
            content: [{ type: "text", text: `[via Jina Reader]\n\n${truncate(content)}` }],
            details: { url, source: "jina", length: content.length },
          };
        }
      } catch {
        // Jina también falló
      }

      return {
        content: [{ type: "text", text: `❌ No se pudo obtener el contenido de: ${url}` }],
        isError: true,
        details: { url },
      };
    },
  });
}
