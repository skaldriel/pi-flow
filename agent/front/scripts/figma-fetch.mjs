#!/usr/bin/env node
/**
 * figma-fetch.mjs — Fetch Figma file data via REST API and extract
 * structured design tokens for the interpreter-expert.
 *
 * Usage:
 *   node figma-fetch.mjs <figma-url-or-file-key> [--token <personal-access-token>]
 *   node figma-fetch.mjs <figma-url-or-file-key> [--node <node-id>]
 *
 * Environment:
 *   Set FIGMA_TOKEN env var or pass --token
 *
 * Output: Structured JSON with colors, typography, component tree,
 *         layout info, and interactive states.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ─── Parse CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: node figma-fetch.mjs <figma-url-or-file-key> [options]

Options:
  --token <token>   Figma personal access token (or set FIGMA_TOKEN env var)
  --node <id>       Fetch only a specific node (faster for large files)
  --raw             Output raw Figma API response (for debugging)
  --compact         Minimize output (skip verbose node details)
  --depth <n>       Max tree depth (default: 10)
  --output <path>   Save to file instead of stdout

Examples:
  node figma-fetch.mjs https://www.figma.com/file/ABC123/MyDesign
  node figma-fetch.mjs ABC123 --token figd_xxx
  node figma-fetch.mjs ABC123 --node 1:5 --compact
  FIGMA_TOKEN=figd_xxx node figma-fetch.mjs ABC123
`);
  process.exit(args.length === 0 ? 1 : 0);
}

const input = args[0];
const flags = {};
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--token" && args[i + 1]) flags.token = args[++i];
  else if (args[i] === "--node" && args[i + 1]) flags.nodeId = args[++i];
  else if (args[i] === "--depth" && args[i + 1]) flags.depth = parseInt(args[++i], 10);
  else if (args[i] === "--output" && args[i + 1]) flags.output = args[++i];
  else if (args[i] === "--raw") flags.raw = true;
  else if (args[i] === "--compact") flags.compact = true;
}

// ─── Extract file key from URL or direct key ──────────────────────────────────
function extractFileKey(input) {
  // Direct file key: just alphanumeric chars
  if (/^[a-zA-Z0-9]+$/.test(input)) return input;

  // URL formats: figma.com/file/<key>/... or figma.com/design/<key>/...
  const match = input.match(/figma\.com\/(file|design)\/([a-zA-Z0-9]+)/);
  if (match) return match[2];

  throw new Error(
    `Cannot extract file key from: "${input}". Provide a Figma URL or file key.`
  );
}

const fileKey = extractFileKey(input);
const token = flags.token || process.env.FIGMA_TOKEN;

if (!token) {
  console.error("ERROR: Figma token required.");
  console.error("Set FIGMA_TOKEN env var or pass --token <token>.");
  console.error("Get one at: https://www.figma.com/developers/api#access-tokens");
  process.exit(1);
}

const maxDepth = flags.depth || 10;

// ─── Fetch from Figma API ─────────────────────────────────────────────────────
async function figmaRequest(endpoint) {
  const url = `https://api.figma.com/v1${endpoint}`;
  const response = await fetch(url, {
    headers: { "X-Figma-Token": token },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Figma API error ${response.status}: ${body}`);
  }

  return response.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.error(`Fetching Figma file ${fileKey}...`);

  let fileData, components, styles;
  const componentsMap = new Map();
  const stylesMap = new Map();

  if (flags.nodeId) {
    // Fetch specific node only
    const nodeData = await figmaRequest(
      `/files/${fileKey}/nodes?ids=${flags.nodeId}`
    );
    fileData = nodeData;
  } else {
    fileData = await figmaRequest(`/files/${fileKey}`);
    components = fileData.components || {};
    const componentSets = fileData.componentSets || {};
    styles = fileData.styles || {};
  }

  if (flags.raw) {
    const out = JSON.stringify(fileData, null, 2);
    if (flags.output) writeFileSync(resolve(flags.output), out);
    else console.log(out);
    return;
  }

  // ─── Build component and style lookup maps ──────────────────────────────────
  if (components) {
    for (const [id, comp] of Object.entries(components)) {
      componentsMap.set(id, {
        name: comp.name,
        key: comp.key,
        description: comp.description || "",
        componentSetId: comp.componentSetId || null,
      });
    }
  }

  if (styles) {
    for (const [id, style] of Object.entries(styles)) {
      stylesMap.set(id, {
        name: style.name,
        key: style.key,
        styleType: style.styleType,
        description: style.description || "",
      });
    }
  }

  // ─── Process document tree ──────────────────────────────────────────────────
  const document = fileData.document || (fileData.nodes ? Object.values(fileData.nodes)[0]?.document : null);

  if (!document) {
    console.error("ERROR: No document found in Figma response.");
    process.exit(1);
  }

  // ─── Extract design tokens ──────────────────────────────────────────────────
  const tokens = {
    fileKey,
    fileName: fileData.name || "Unknown",
    lastModified: fileData.lastModified || null,
    extractedAt: new Date().toISOString(),
    colorPalette: extractColors(document, stylesMap),
    typography: extractTypography(document, stylesMap),
    spacing: extractSpacing(document),
    elevations: extractElevations(document),
    borderRadii: extractBorderRadii(document),
    componentTree: extractComponentTree(document, componentsMap, 0, maxDepth),
    components: [
      ...(components ? Object.values(components).map((c) => ({
        name: c.name,
        key: c.key,
        description: c.description || "",
      })) : []),
    ],
    styles: [
      ...(styles ? Object.values(styles).map((s) => ({
        name: s.name,
        styleType: s.styleType,
        description: s.description || "",
      })) : []),
    ],
  };

  const output = JSON.stringify(tokens, null, 2);

  if (flags.output) {
    writeFileSync(resolve(flags.output), output);
    console.error(`Saved to ${flags.output}`);
  } else {
    console.log(output);
  }
}

// ─── Token Extractors ─────────────────────────────────────────────────────────

function walkTree(node, visitor, depth = 0, maxDepth = Infinity) {
  if (depth > maxDepth) return;
  visitor(node, depth);
  if (node.children) {
    for (const child of node.children) {
      walkTree(child, visitor, depth + 1, maxDepth);
    }
  }
}

function rgbaToHex(color) {
  if (!color) return null;
  const r = Math.round((color.r || 0) * 255);
  const g = Math.round((color.g || 0) * 255);
  const b = Math.round((color.b || 0) * 255);
  const a = color.a != null ? color.a : 1;
  if (a === 1) {
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
  }
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(2))})`;
}

function extractColors(node, stylesMap) {
  const colorSet = new Map(); // hex -> { hex, occurrences, names }

  walkTree(node, (n) => {
    // Process fills
    if (n.fills && Array.isArray(n.fills)) {
      for (const fill of n.fills) {
        if (fill.type === "SOLID" && fill.visible !== false && fill.color) {
          const hex = rgbaToHex(fill.color);
          if (!hex) continue;

          const existing = colorSet.get(hex);
          if (existing) {
            existing.occurrences++;
            if (n.name && !existing.names.includes(n.name)) {
              existing.names.push(n.name);
            }
          } else {
            // Try to match with a style
            let styleName = null;
            if (fill.boundVariables?.color?.id && stylesMap) {
              const styleObj = stylesMap.get(fill.boundVariables.color.id);
              if (styleObj) styleName = styleObj.name;
            }

            colorSet.set(hex, {
              hex,
              occurrences: 1,
              names: n.name ? [n.name] : [],
              styleName,
              opacity: fill.opacity ?? fill.color.a ?? 1,
            });
          }
        }
      }
    }

    // Process strokes
    if (n.strokes && Array.isArray(n.strokes)) {
      for (const stroke of n.strokes) {
        if (stroke.type === "SOLID" && stroke.visible !== false && stroke.color) {
          const hex = rgbaToHex(stroke.color);
          if (!hex) continue;

          const existing = colorSet.get(hex);
          if (existing) {
            existing.occurrences++;
          } else {
            colorSet.set(hex, {
              hex,
              occurrences: 1,
              names: [],
              styleName: null,
              isStroke: true,
              opacity: stroke.opacity ?? 1,
            });
          }
        }
      }
    }
  });

  // Sort by occurrence count (most used first)
  return [...colorSet.values()].sort((a, b) => b.occurrences - a.occurrences);
}

function extractTypography(node, stylesMap) {
  const typoMap = new Map(); // key -> { fontFamily, fontWeight, fontSize, lineHeight, occurrences }

  walkTree(node, (n) => {
    if (n.type !== "TEXT" || !n.style) return;

    const s = n.style;
    const ff = s.fontFamily || "Unknown";
    const fw = s.fontWeight || 400;
    const fs = s.fontSize || 14;
    const lh = s.lineHeightPx || (s.lineHeightPercent ? fs * (s.lineHeightPercent / 100) : null);

    const key = `${ff}|${fw}|${fs}|${lh}`;
    const existing = typoMap.get(key);
    if (existing) {
      existing.occurrences++;
    } else {
      let styleName = null;
      if (s.boundVariables?.textStyle?.id && stylesMap) {
        const styleObj = stylesMap.get(s.boundVariables.textStyle.id);
        if (styleObj) styleName = styleObj.name;
      }

      typoMap.set(key, {
        fontFamily: ff,
        fontWeight: fw,
        fontSize: fs,
        lineHeight: lh,
        letterSpacing: s.letterSpacing || null,
        textCase: s.textCase || "ORIGINAL",
        textAlign: s.textAlignHorizontal || "LEFT",
        textDecoration: s.textDecoration || "NONE",
        styleName,
        occurrences: 1,
        sampleText: n.characters?.slice(0, 50) || "",
      });
    }
  });

  return [...typoMap.values()].sort((a, b) => b.occurrences - a.occurrences);
}

function extractSpacing(node) {
  const spacings = new Set();
  const autoLayoutGaps = new Set();

  walkTree(node, (n) => {
    // Auto-layout gaps
    if (n.layoutMode && n.itemSpacing > 0) {
      autoLayoutGaps.add(n.itemSpacing);
    }

    // Padding
    if (n.paddingTop) spacings.add(n.paddingTop);
    if (n.paddingBottom) spacings.add(n.paddingBottom);
    if (n.paddingLeft) spacings.add(n.paddingLeft);
    if (n.paddingRight) spacings.add(n.paddingRight);

    // Absolute position offsets
    if (n.x > 0) spacings.add(Math.round(n.x));
    if (n.y > 0) spacings.add(Math.round(n.y));
  });

  return {
    commonValues: [...spacings].sort((a, b) => a - b),
    autoLayoutGaps: [...autoLayoutGaps].sort((a, b) => a - b),
    gridUnit: inferGridUnit([...spacings, ...autoLayoutGaps]),
  };
}

function inferGridUnit(values) {
  if (values.length === 0) return 8;
  // Try common grid units: 4, 8, 10
  const candidates = [4, 8, 10];
  let bestUnit = 8;
  let bestScore = 0;

  for (const unit of candidates) {
    let score = 0;
    for (const v of values) {
      if (v % unit === 0) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestUnit = unit;
    }
  }

  return bestUnit;
}

function extractElevations(node) {
  const effects = new Map(); // key -> count

  walkTree(node, (n) => {
    if (!n.effects || n.effects.length === 0) return;

    for (const e of n.effects) {
      if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
        const key = `${e.type}|${e.radius}|${e.offset?.x ?? 0}|${e.offset?.y ?? 0}|${e.spread ?? 0}|${rgbaToHex(e.color) || "none"}`;
        effects.set(key, (effects.get(key) || 0) + 1);
      }
      if (e.type === "BACKGROUND_BLUR") {
        const key = `BLUR|${e.radius}`;
        effects.set(key, (effects.get(key) || 0) + 1);
      }
    }
  });

  return [...effects.entries()]
    .map(([key, count]) => {
      const parts = key.split("|");
      if (parts[0] === "BLUR") {
        return { type: "background_blur", radius: parseFloat(parts[1]), occurrences: count };
      }
      return {
        type: parts[0],
        radius: parseFloat(parts[1]),
        offsetX: parseFloat(parts[2]),
        offsetY: parseFloat(parts[3]),
        spread: parseFloat(parts[4]),
        color: parts[5],
        occurrences: count,
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences);
}

function extractBorderRadii(node) {
  const radii = new Set();

  walkTree(node, (n) => {
    if (n.cornerRadius) radii.add(n.cornerRadius);
    if (n.rectangleCornerRadii) {
      n.rectangleCornerRadii.forEach((r) => { if (r) radii.add(r); });
    }
    if (n.topLeftRadius) radii.add(n.topLeftRadius);
    if (n.topRightRadius) radii.add(n.topRightRadius);
    if (n.bottomLeftRadius) radii.add(n.bottomLeftRadius);
    if (n.bottomRightRadius) radii.add(n.bottomRightRadius);
  });

  return [...radii].sort((a, b) => a - b);
}

function extractComponentTree(node, componentsMap, depth, maxDepth) {
  if (depth > maxDepth) return null;

  // Skip invisible or helper layers
  if (node.visible === false) return null;

  const info = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  // Resolve component references
  if (node.type === "INSTANCE" && node.componentId && componentsMap) {
    const comp = componentsMap.get(node.componentId);
    if (comp) {
      info.component = comp.name;
      info.componentKey = comp.key;
    }
  }

  if (node.type === "COMPONENT") {
    info.isComponent = true;
  }

  // Layout info
  if (node.layoutMode) {
    info.layout = {
      mode: node.layoutMode, // HORIZONTAL | VERTICAL
      gap: node.itemSpacing || 0,
      paddingTop: node.paddingTop || 0,
      paddingBottom: node.paddingBottom || 0,
      paddingLeft: node.paddingLeft || 0,
      paddingRight: node.paddingRight || 0,
      primaryAlign: node.primaryAxisAlignItems || "MIN",
      counterAlign: node.counterAxisAlignItems || "MIN",
      wrap: node.layoutWrap === "WRAP",
    };
  }

  // Size
  if (node.absoluteBoundingBox) {
    info.size = {
      width: Math.round(node.absoluteBoundingBox.width),
      height: Math.round(node.absoluteBoundingBox.height),
    };
  }

  // Text content
  if (node.type === "TEXT" && node.characters) {
    info.text = node.characters.slice(0, 200);
  }

  // Fills (first solid fill only for compactness)
  if (node.fills && node.fills.length > 0) {
    const solidFill = node.fills.find((f) => f.type === "SOLID" && f.visible !== false);
    if (solidFill && solidFill.color) {
      info.fill = rgbaToHex(solidFill.color);
    }
  }

  // Process children
  if (node.children && node.children.length > 0) {
    const children = [];
    for (const child of node.children) {
      const childTree = extractComponentTree(child, componentsMap, depth + 1, maxDepth);
      if (childTree) children.push(childTree);
    }
    if (children.length > 0) info.children = children;
  }

  return info;
}

// ─── Run ──────────────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
