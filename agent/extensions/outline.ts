/**
 * Outline Integration Extension
 *
 * Provides tools to interact with the Boletia Outline wiki.
 * Requires OUTLINE_API_KEY environment variable.
 * Create your key at: https://boletia.getoutline.com/settings/api
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

// ─── Configuration ────────────────────────────────────────────────────────

const OUTLINE_BASE_URL = "https://boletia.getoutline.com/api";

function getApiKey(): string {
  const key = process.env.OUTLINE_API_KEY;
  if (!key) {
    throw new Error(
      "OUTLINE_API_KEY not set. Create a key at https://boletia.getoutline.com/settings/api and export it as an environment variable.",
    );
  }
  return key;
}

// ─── API Helper ───────────────────────────────────────────────────────────

interface OutlineResponse<T> {
  ok: boolean;
  data?: T;
  pagination?: {
    limit: number;
    offset: number;
    nextPath?: string;
  };
  error?: string;
}

async function outlineFetch<T>(
  method: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<OutlineResponse<T>> {
  const apiKey = getApiKey();
  const url = `${OUTLINE_BASE_URL}/${method}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    return {
      ok: false,
      error: `HTTP ${res.status}: ${res.statusText}${errorText ? ` - ${errorText}` : ""}`,
    };
  }

  return (await res.json()) as OutlineResponse<T>;
}

// ─── Type Definitions ─────────────────────────────────────────────────────

interface OutlineCollection {
  id: string;
  name: string;
  description?: string;
  color?: string;
  sort?: string;
  permission?: string;
  documentCount?: number;
  index?: string;
  url?: string;
}

interface OutlineDocument {
  id: string;
  url: string;
  urlId: string;
  title: string;
  summary?: string;
  text?: string;
  collectionId?: string;
  parentDocumentId?: string | null;
  lastModifiedById?: string;
  createdById?: string;
  editor?: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  teamId?: string;
  revisions?: unknown[];
}

interface NavigationNode {
  id: string;
  url: string;
  title: string;
  children?: NavigationNode[];
}

interface OutlineDocumentTree {
  id: string;
  url: string;
  title: string;
  children?: NavigationNode[];
}

interface OutlineSearchResult {
  id: string;
  ranking: number;
  context?: string;
  document: OutlineDocument;
}

interface OutlineUser {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

// ─── Tools ────────────────────────────────────────────────────────────────

/**
 * search_documents – Search across all Outline documents
 */
const searchDocumentsTool = {
  name: "outline_search",
  label: "Search Outline",
  description:
    "Search for documents in the Boletia Outline wiki by query text. Returns matching documents with titles, URLs, and context snippets.",
  promptSnippet: "Search Outline wiki documents by query",
  parameters: Type.Object({
    query: Type.String({ description: "Search query text" }),
    collectionId: Type.Optional(
      Type.String({ description: "Limit search to a specific collection ID" }),
    ),
    dateFilter: Type.Optional(
      StringEnum(["day", "week", "month", "year"] as const, {
        description: "Filter by last updated date range",
      }),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Max results to return (default: 15)", default: 15 }),
    ),
  }),
  async execute(
    _toolCallId: string,
    params: {
      query: string;
      collectionId?: string;
      dateFilter?: "day" | "week" | "month" | "year";
      limit?: number;
    },
    signal?: AbortSignal,
  ) {
    const body: Record<string, unknown> = {
      query: params.query,
      limit: params.limit ?? 15,
    };
    if (params.collectionId) body.collectionId = params.collectionId;
    if (params.dateFilter) body.dateFilter = params.dateFilter;

    const result = await outlineFetch<{ results: OutlineSearchResult[] }>(
      "documents.search",
      body,
      signal,
    );

    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Search failed: ${result.error}` }],
        details: { success: false, error: result.error },
      };
    }

    const results = result.data?.results ?? [];

    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No documents found for "${params.query}".` }],
        details: { success: true, count: 0, query: params.query },
      };
    }

    const text = results
      .map((r) => {
        const doc = r.document;
        let line = `**${doc.title}**\n`;
        line += `  URL: ${doc.url}\n`;
        if (doc.summary) line += `  Summary: ${doc.summary}\n`;
        if (r.context) line += `  Context: ...${r.context}...\n`;
        return line;
      })
      .join("\n");

    return {
      content: [{ type: "text", text: `Found ${results.length} result(s) for "${params.query}":\n\n${text}` }],
      details: { success: true, count: results.length, query: params.query },
    };
  },
};

/**
 * get_document – Get a specific document by ID or URL
 */
const getDocumentTool = {
  name: "outline_get_document",
  label: "Get Outline Document",
  description:
    "Retrieve a document's full content from Outline by ID, URL, or share link. Returns the Markdown text, title, and metadata.",
  promptSnippet: "Get full content of an Outline document",
  parameters: Type.Object({
    id: Type.String({
      description:
        "Document ID, URL, or share link (e.g., 'abc-123', 'https://boletia.getoutline.com/doc/...', or share URL)",
    }),
  }),
  async execute(
    _toolCallId: string,
    params: { id: string },
    signal?: AbortSignal,
  ) {
    const body: Record<string, unknown> = {};

    // Determine if it's a URL or an ID
    if (params.id.startsWith("http")) {
      body.shareId = params.id;
    } else {
      body.id = params.id;
    }

    const result = await outlineFetch<OutlineDocument>("documents.info", body, signal);

    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Failed to get document: ${result.error}` }],
        details: { success: false, error: result.error },
      };
    }

    const doc = result.data!;
    let text = `# ${doc.title}\n\n`;
    if (doc.summary) text += `> ${doc.summary}\n\n`;
    if (doc.text) text += doc.text;
    else text += "_(Document has no text content)_";

    text += `\n\n---\n`;
    text += `**URL:** ${doc.url}\n`;
    text += `**ID:** ${doc.id}\n`;
    if (doc.createdAt) text += `**Created:** ${doc.createdAt}\n`;
    if (doc.updatedAt) text += `**Updated:** ${doc.updatedAt}\n`;
    if (doc.publishedAt) text += `**Published:** ${doc.publishedAt}\n`;

    return {
      content: [{ type: "text", text }],
      details: {
        success: true,
        id: doc.id,
        title: doc.title,
        url: doc.url,
        updatedAt: doc.updatedAt,
      },
    };
  },
};

/**
 * list_documents – List documents in a collection or all documents
 */
const listDocumentsTool = {
  name: "outline_list_documents",
  label: "List Outline Documents",
  description:
    "List documents in Outline, optionally filtered by collection. Returns a list of titles, URLs, and metadata.",
  promptSnippet: "List documents from an Outline collection",
  parameters: Type.Object({
    collectionId: Type.Optional(
      Type.String({ description: "Collection ID to list documents from" }),
    ),
    sort: Type.Optional(
      StringEnum(["createdAt", "updatedAt", "title", "index"] as const, {
        description: "Sort field (default: index)",
      }),
    ),
    direction: Type.Optional(
      StringEnum(["ASC", "DESC"] as const, {
        description: "Sort direction (default: ASC)",
      }),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Max results (default: 25)", default: 25 }),
    ),
  }),
  async execute(
    _toolCallId: string,
    params: {
      collectionId?: string;
      sort?: string;
      direction?: "ASC" | "DESC";
      limit?: number;
    },
    signal?: AbortSignal,
  ) {
    const body: Record<string, unknown> = {
      limit: params.limit ?? 25,
      sort: params.sort ?? "index",
      direction: params.direction ?? "ASC",
    };
    if (params.collectionId) body.collectionId = params.collectionId;

    const result = await outlineFetch<OutlineDocument[]>("documents.list", body, signal);

    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Failed to list documents: ${result.error}` }],
        details: { success: false, error: result.error },
      };
    }

    const docs = result.data ?? [];

    if (docs.length === 0) {
      const scope = params.collectionId ? ` in collection ${params.collectionId}` : "";
      return {
        content: [{ type: "text", text: `No documents found${scope}.` }],
        details: { success: true, count: 0 },
      };
    }

    const text = docs
      .map((d) => {
        let line = `- **${d.title}**`;
        line += `\n  URL: ${d.url}`;
        if (d.summary) line += `\n  Summary: ${d.summary}`;
        if (d.updatedAt) line += `\n  Updated: ${d.updatedAt}`;
        return line;
      })
      .join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: `Found ${docs.length} document(s):\n\n${text}`,
        },
      ],
      details: { success: true, count: docs.length },
    };
  },
};

/**
 * list_collections – List all collections
 */
const listCollectionsTool = {
  name: "outline_list_collections",
  label: "List Outline Collections",
  description:
    "List all collections in the Boletia Outline workspace. Use collection IDs to scope document searches.",
  promptSnippet: "List all Outline collections",
  parameters: Type.Object({}),
  async execute(_toolCallId: string, _params: object, signal?: AbortSignal) {
    const result = await outlineFetch<OutlineCollection[]>(
      "collections.list",
      {},
      signal,
    );

    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Failed to list collections: ${result.error}` }],
        details: { success: false, error: result.error },
      };
    }

    const collections = result.data ?? [];

    if (collections.length === 0) {
      return {
        content: [{ type: "text", text: "No collections found." }],
        details: { success: true, count: 0 },
      };
    }

    const text = collections
      .map((c) => {
        let line = `- **${c.name}** (\`${c.id}\`)`;
        if (c.description) line += ` – ${c.description}`;
        if (c.url) line += `\n  URL: ${c.url}`;
        if (c.permission) line += `\n  Permission: ${c.permission}`;
        return line;
      })
      .join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: `Found ${collections.length} collection(s):\n\n${text}`,
        },
      ],
      details: { success: true, count: collections.length },
    };
  },
};

/**
 * create_document – Create a new document
 */
const createDocumentTool = {
  name: "outline_create_document",
  label: "Create Outline Document",
  description:
    "Create a new document in Outline. Supports Markdown content, collection placement, and parent-child nesting.",
  promptSnippet: "Create a new document in Outline",
  parameters: Type.Object({
    title: Type.String({ description: "Document title" }),
    text: Type.String({
      description: "Document content in Markdown format",
    }),
    collectionId: Type.String({
      description: "Collection ID to create the document in",
    }),
    parentDocumentId: Type.Optional(
      Type.String({ description: "Parent document ID to nest under (for sub-pages)" }),
    ),
    publish: Type.Optional(
      Type.Boolean({
        description: "Whether to publish immediately (default: true)",
        default: true,
      }),
    ),
  }),
  async execute(
    _toolCallId: string,
    params: {
      title: string;
      text: string;
      collectionId: string;
      parentDocumentId?: string;
      publish?: boolean;
    },
    signal?: AbortSignal,
  ) {
    const body: Record<string, unknown> = {
      title: params.title,
      text: params.text,
      collectionId: params.collectionId,
      publish: params.publish !== false,
    };
    if (params.parentDocumentId) body.parentDocumentId = params.parentDocumentId;

    const result = await outlineFetch<OutlineDocument>("documents.create", body, signal);

    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Failed to create document: ${result.error}` }],
        details: { success: false, error: result.error },
      };
    }

    const doc = result.data!;
    return {
      content: [
        {
          type: "text",
          text: `Document created successfully!\n\n**Title:** ${doc.title}\n**URL:** ${doc.url}\n**ID:** ${doc.id}`,
        },
      ],
      details: {
        success: true,
        id: doc.id,
        title: doc.title,
        url: doc.url,
      },
    };
  },
};

/**
 * update_document – Update an existing document
 */
const updateDocumentTool = {
  name: "outline_update_document",
  label: "Update Outline Document",
  description:
    "Update an existing Outline document's title, content, or other properties. Returns the updated document.",
  promptSnippet: "Update an existing Outline document",
  parameters: Type.Object({
    id: Type.String({ description: "Document ID to update" }),
    title: Type.Optional(Type.String({ description: "New title" })),
    text: Type.Optional(
      Type.String({ description: "New content in Markdown (replaces existing content)" }),
    ),
    appendText: Type.Optional(
      Type.String({
        description: "Text to append to existing content (instead of replacing)",
      }),
    ),
  }),
  async execute(
    _toolCallId: string,
    params: {
      id: string;
      title?: string;
      text?: string;
      appendText?: string;
    },
    signal?: AbortSignal,
  ) {
    // If appending, first fetch the current document
    if (params.appendText) {
      const current = await outlineFetch<OutlineDocument>(
        "documents.info",
        { id: params.id },
        signal,
      );

      if (!current.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch current document for append: ${current.error}`,
            },
          ],
          details: { success: false, error: current.error },
        };
      }

      const existingText = current.data?.text ?? "";
      params.text = existingText + "\n\n" + params.appendText;
    }

    const body: Record<string, unknown> = { id: params.id };
    if (params.title) body.title = params.title;
    if (params.text) body.text = params.text;

    const result = await outlineFetch<OutlineDocument>("documents.update", body, signal);

    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Failed to update document: ${result.error}` }],
        details: { success: false, error: result.error },
      };
    }

    const doc = result.data!;
    return {
      content: [
        {
          type: "text",
          text: `Document updated successfully!\n\n**Title:** ${doc.title}\n**URL:** ${doc.url}\n**Updated:** ${doc.updatedAt}`,
        },
      ],
      details: {
        success: true,
        id: doc.id,
        title: doc.title,
        url: doc.url,
        updatedAt: doc.updatedAt,
      },
    };
  },
};

/**
 * delete_document – Archive/delete a document
 */
const deleteDocumentTool = {
  name: "outline_delete_document",
  label: "Delete Outline Document",
  description:
    "Archive or permanently delete an Outline document. Archived documents can be restored.",
  promptSnippet: "Archive or delete an Outline document",
  parameters: Type.Object({
    id: Type.String({ description: "Document ID to delete" }),
    permanent: Type.Optional(
      Type.Boolean({
        description: "Permanently delete instead of archiving (default: false)",
        default: false,
      }),
    ),
  }),
  async execute(
    _toolCallId: string,
    params: { id: string; permanent?: boolean },
    signal?: AbortSignal,
  ) {
    if (params.permanent) {
      const result = await outlineFetch<unknown>(
        "documents.delete",
        { id: params.id },
        signal,
      );

      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Failed to delete document: ${result.error}` }],
          details: { success: false, error: result.error },
        };
      }

      return {
        content: [
          { type: "text", text: `Document \`${params.id}\` permanently deleted.` },
        ],
        details: { success: true, id: params.id, permanent: true },
      };
    }

    const result = await outlineFetch<OutlineDocument>(
      "documents.archive",
      { id: params.id },
      signal,
    );

    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Failed to archive document: ${result.error}` }],
        details: { success: false, error: result.error },
      };
    }

    const doc = result.data!;
    return {
      content: [
        { type: "text", text: `Document archived: **${doc.title}** (\`${doc.id}\`)` },
      ],
      details: { success: true, id: params.id, permanent: false, title: doc.title },
    };
  },
};

/**
 * get_document_tree – Get document children tree
 */
const getDocumentTreeTool = {
  name: "outline_get_document_tree",
  label: "Get Outline Document Tree",
  description:
    "Get the document hierarchy (tree structure) for a specific document. Returns all nested children as a tree, showing the document's complete structure including sub-documents at any depth.",
  promptSnippet: "Get the document tree structure with all nested children",
  parameters: Type.Object({
    id: Type.String({
      description:
        "Document ID or slug to get the tree structure for (e.g., 'abc-123' or the slug from the URL like 'blt-3943-marketing-campaingns-PhWuvG0SKE')",
    }),
    maxDepth: Type.Optional(
      Type.Number({
        description: "Maximum depth to traverse (default: unlimited)",
      }),
    ),
  }),
  async execute(
    _toolCallId: string,
    params: { id: string; maxDepth?: number },
    signal?: AbortSignal,
  ) {
    const result = await outlineFetch<OutlineDocumentTree>(
      "documents.documents",
      { id: params.id },
      signal,
    );

    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Failed to get document tree: ${result.error}` }],
        details: { success: false, error: result.error },
      };
    }

    const tree = result.data!;

    // Helper to render tree with indentation
    function renderTree(nodes: NavigationNode[], depth: number, maxD: number | undefined): string {
      const indent = "  ".repeat(depth);
      let output = "";

      for (const node of nodes) {
        const connector = node.children && node.children.length > 0 ? "📁" : "📄";
        output += `${indent}${connector} **${node.title}**\n`;
        output += `${indent}   └─ ${node.url}\n`;

        if (node.children && node.children.length > 0) {
          if (maxD === undefined || depth < maxD) {
            output += renderTree(node.children, depth + 1, maxD);
          } else if (maxD !== undefined) {
            output += `${indent}   └─ ... (${node.children.length} children, max depth reached)\n`;
          }
        }
      }

      return output;
    }

    // Count total documents in tree
    function countNodes(nodes: NavigationNode[]): number {
      let count = nodes.length;
      for (const node of nodes) {
        if (node.children) {
          count += countNodes(node.children);
        }
      }
      return count;
    }

    const treeOutput = renderTree(
      tree.children ?? [],
      0,
      params.maxDepth,
    );

    const totalDocs = countNodes(tree.children ?? []);

    let text = `# Document Tree: ${tree.title}\n\n`;
    text += `**Root:** ${tree.url}\n`;
    text += `**Total child documents:** ${totalDocs}\n\n`;

    if (tree.children && tree.children.length > 0) {
      text += `---\n\n**Structure:**\n\n${treeOutput}`;
    } else {
      text += `_No child documents_`;
    }

    return {
      content: [{ type: "text", text }],
      details: {
        success: true,
        id: tree.id,
        title: tree.title,
        url: tree.url,
        childCount: totalDocs,
      },
    };
  },
};

/**
 * list_document_children – List direct children of a document
 */
const listDocumentChildrenTool = {
  name: "outline_list_document_children",
  label: "List Outline Document Children",
  description:
    "List the direct child documents of a specific document. Use this to see what documents are indexed/nested under a parent document (like a project parent document containing PRD, DTD, ARD, SPECS sections).",
  promptSnippet: "List child documents nested under a parent document",
  parameters: Type.Object({
    id: Type.String({
      description:
        "Document ID or slug of the parent document (e.g., 'abc-123' or the slug from the URL)",
    }),
  }),
  async execute(
    _toolCallId: string,
    params: { id: string },
    signal?: AbortSignal,
  ) {
    const result = await outlineFetch<OutlineDocumentTree>(
      "documents.documents",
      { id: params.id },
      signal,
    );

    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Failed to get document children: ${result.error}` }],
        details: { success: false, error: result.error },
      };
    }

    const tree = result.data!;

    if (!tree.children || tree.children.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No child documents found under **${tree.title}**`,
          },
        ],
        details: { success: true, id: tree.id, title: tree.title, childCount: 0 },
      };
    }

    const childrenList = tree.children
      .map((child) => {
        const childCount = child.children ? child.children.length : 0;
        const suffix = childCount > 0 ? ` (${childCount} child${childCount > 1 ? "ren" : ""})` : "";
        return `- **${child.title}**${suffix}\n  URL: ${child.url}`;
      })
      .join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: `**${tree.title}** has ${tree.children.length} child document(s):\n\n${childrenList}`,
        },
      ],
      details: {
        success: true,
        id: tree.id,
        title: tree.title,
        url: tree.url,
        childCount: tree.children.length,
        children: tree.children.map((c) => ({
          id: c.id,
          title: c.title,
          url: c.url,
          childCount: c.children?.length ?? 0,
        })),
      },
    };
  },
};

/**
 * create_comment – Add a comment to a document
 */
const createCommentTool = {
  name: "outline_create_comment",
  label: "Create Outline Comment",
  description:
    "Add a comment to an Outline document, optionally on a specific line range.",
  promptSnippet: "Add a comment to an Outline document",
  parameters: Type.Object({
    documentId: Type.String({ description: "Document ID to comment on" }),
    body: Type.String({ description: "Comment text (Markdown supported)" }),
    parentCommentId: Type.Optional(
      Type.String({ description: "Parent comment ID for a reply" }),
    ),
  }),
  async execute(
    _toolCallId: string,
    params: { documentId: string; body: string; parentCommentId?: string },
    signal?: AbortSignal,
  ) {
    const body: Record<string, unknown> = {
      documentId: params.documentId,
      body: params.body,
    };
    if (params.parentCommentId) body.parentCommentId = params.parentCommentId;

    const result = await outlineFetch<unknown>("comments.create", body, signal);

    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Failed to create comment: ${result.error}` }],
        details: { success: false, error: result.error },
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Comment added to document \`${params.documentId}\`.`,
        },
      ],
      details: { success: true, documentId: params.documentId },
    };
  },
};

// ─── Commands ─────────────────────────────────────────────────────────────

/**
 * /outline-auth – Check API key validity
 */
function registerCommands(pi: ExtensionAPI) {
  pi.registerCommand("outline-auth", {
    description: "Test Outline API authentication",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("outline", "Checking auth...");

      try {
        const result = await outlineFetch<{
          user: OutlineUser;
        }>("auth.info", {});

        if (result.ok && result.data?.user) {
          const user = result.data.user;
          ctx.ui.notify(
            `Authenticated as: ${user.name} (${user.email ?? "no email"})`,
            "success",
          );
        } else {
          ctx.ui.notify(`Auth check failed: ${result.error}`, "error");
        }
      } catch (err: unknown) {
        ctx.ui.notify(
          `Auth check error: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }

      ctx.ui.setStatus("outline", "");
    },
  });

  pi.registerCommand("outline-collections", {
    description: "List all Outline collections",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("outline", "Loading collections...");

      try {
        const result = await outlineFetch<OutlineCollection[]>("collections.list", {});

        if (result.ok && result.data) {
          const lines = result.data.map((c) => {
            let line = `  • ${c.name}`;
            if (c.description) line += ` – ${c.description}`;
            line += ` [\`${c.id}\`]`;
            return line;
          });

          ctx.ui.notify(
            `Collections (${result.data.length}):\n\n${lines.join("\n")}`,
            "info",
          );
        } else {
          ctx.ui.notify(`Failed: ${result.error}`, "error");
        }
      } catch (err: unknown) {
        ctx.ui.notify(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }

      ctx.ui.setStatus("outline", "");
    },
  });
}

// ─── Extension Entry Point ───────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Register all tools
  pi.registerTool(searchDocumentsTool);
  pi.registerTool(getDocumentTool);
  pi.registerTool(listDocumentsTool);
  pi.registerTool(listCollectionsTool);
  pi.registerTool(createDocumentTool);
  pi.registerTool(updateDocumentTool);
  pi.registerTool(deleteDocumentTool);
  pi.registerTool(createCommentTool);
  pi.registerTool(getDocumentTreeTool);
  pi.registerTool(listDocumentChildrenTool);

  // Register user commands
  registerCommands(pi);

  // Show status on startup
  pi.on("session_start", async (_event, ctx) => {
    const apiKey = process.env.OUTLINE_API_KEY;
    if (apiKey) {
      ctx.ui.setStatus("outline", ctx.ui.theme.fg("success", "● Outline"));

      // Verify auth silently in background
      try {
        const result = await outlineFetch<{ user: OutlineUser }>("auth.info", {});
        if (result.ok && result.data?.user) {
          ctx.ui.setStatus(
            "outline",
            ctx.ui.theme.fg("success", `● Outline: ${result.data.user.name}`),
          );
        } else {
          ctx.ui.setStatus(
            "outline",
            ctx.ui.theme.fg("error", `● Outline: ${result.error ?? "auth failed"}`),
          );
        }
      } catch {
        ctx.ui.setStatus("outline", ctx.ui.theme.fg("warning", "● Outline: error"));
      }
    } else {
      ctx.ui.setStatus(
        "outline",
        ctx.ui.theme.fg("warning", "● Outline: no API key"),
      );
    }
  });
}
