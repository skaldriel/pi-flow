import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

const LINEAR_API_URL = "https://api.linear.app/graphql";

interface LinearResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function linearQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY environment variable not set");
  }

  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": apiKey,
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as LinearResponse<T>;
  
  if (result.errors?.length) {
    throw new Error(`GraphQL error: ${result.errors.map(e => e.message).join(", ")}`);
  }

  if (!result.data) {
    throw new Error("No data returned from Linear API");
  }

  return result.data;
}

export default function (pi: ExtensionAPI) {
  // Check API key on startup
  pi.on("session_start", async (_event, ctx) => {
    if (!process.env.LINEAR_API_KEY) {
      ctx.ui.notify("⚠️ LINEAR_API_KEY not set. Linear tools unavailable.", "warning");
    }
  });

  // Search issues
  pi.registerTool({
    name: "linear_search_issues",
    label: "Search Linear Issues",
    description: "Search for issues in Linear by query string. Returns matching issues with title, identifier, state, and assignee.",
    promptSnippet: "Search Linear issues by keyword, identifier, or filter",
    parameters: Type.Object({
      query: Type.String({ description: "Search query - can be text, issue identifier (e.g., 'TEAM-123'), or filter terms" }),
      limit: Type.Optional(Type.Number({ default: 10, description: "Maximum number of results (1-50)" })),
    }),
    async execute(_toolCallId, params, signal) {
      // Use issues query - issueSearch is deprecated
      const searchQuery = `
        query SearchIssues($filter: IssueFilter, $first: Int) {
          issues(filter: $filter, first: $first) {
            nodes {
              id
              identifier
              title
              description
              state {
                name
                color
              }
              assignee {
                name
                email
              }
              team {
                name
                key
              }
              priority
              url
              createdAt
              updatedAt
            }
          }
        }
      `;

      // Check if query looks like an identifier (e.g., "BOL-13")
      const identifierMatch = params.query.match(/^([A-Z]+-\d+)$/i);
      
      let issues: any[] = [];
      
      if (identifierMatch) {
        // Search by identifier using issues filter
        const data = await linearQuery<{ issues: { nodes: any[] } }>(
          searchQuery,
          { filter: { identifier: { eq: params.query } }, first: 1 },
          signal
        );
        issues = data.issues.nodes;
      } else {
        // Search by title content
        const data = await linearQuery<{ issues: { nodes: any[] } }>(
          searchQuery,
          { filter: { title: { contains: params.query } }, first: Math.min(params.limit || 10, 50) },
          signal
        );
        issues = data.issues.nodes;
      }
      
      // If no results with filter, try getting recent issues and filter client-side
      if (issues.length === 0 && params.query.trim() !== "") {
        const allIssuesQuery = `
          query($first: Int) {
            issues(first: $first) {
              nodes {
                id
                identifier
                title
                description
                state { name color }
                assignee { name email }
                team { name key }
                priority
                url
                createdAt
                updatedAt
              }
            }
          }
        `;
        const allData = await linearQuery<{ issues: { nodes: any[] } }>(
          allIssuesQuery,
          { first: 50 },
          signal
        );
        const queryLower = params.query.toLowerCase();
        issues = allData.issues.nodes.filter(i => 
          i.title.toLowerCase().includes(queryLower) ||
          i.identifier.toLowerCase().includes(queryLower)
        ).slice(0, params.limit || 10);
      }
      
      if (issues.length === 0) {
        return {
          content: [{ type: "text", text: `No issues found for query: "${params.query}"` }],
          details: { query: params.query, results: [] },
        };
      }

      const formatted = issues.map(i => 
        `${i.identifier}: ${i.title}\n` +
        `  State: ${i.state?.name || "None"} | Team: ${i.team?.name || "None"} | Assignee: ${i.assignee?.name || "Unassigned"}\n` +
        `  Priority: ${i.priority} | URL: ${i.url}\n` +
        `  ${i.description ? i.description.substring(0, 100).replace(/\n/g, " ") + "..." : "No description"}`
      ).join("\n\n");

      return {
        content: [{ type: "text", text: `Found ${issues.length} issue(s):\n\n${formatted}` }],
        details: { query: params.query, results: issues },
      };
    },
  });

  // Get issue by identifier
  pi.registerTool({
    name: "linear_get_issue",
    label: "Get Linear Issue",
    description: "Get detailed information about a specific Linear issue by its identifier (e.g., 'TEAM-123')",
    parameters: Type.Object({
      identifier: Type.String({ description: "Issue identifier (e.g., 'ENG-123', 'PROJ-456')" }),
    }),
    async execute(_toolCallId, params, signal) {
      const query = `
        query GetIssue($identifier: String!) {
          issues(filter: { identifier: { eq: $identifier } }) {
            nodes {
              id
              identifier
              title
              description
              state {
                name
                color
              }
              assignee {
                name
                email
              }
              team {
                name
                key
              }
              project {
                name
              }
              priority
              estimate
              url
              createdAt
              updatedAt
              comments {
                nodes {
                  id
                  body
                  user {
                    name
                  }
                  createdAt
                }
              }
              children {
                nodes {
                  id
                  identifier
                  title
                  state {
                    name
                  }
                  assignee {
                    name
                  }
                }
              }
              parent {
                identifier
                title
              }
            }
          }
        }
      `;

      const data = await linearQuery<{ issues: { nodes: any[] } }>(
        query,
        { identifier: params.identifier },
        signal
      );

      const issue = data.issues.nodes[0];
      
      if (!issue) {
        return {
          content: [{ type: "text", text: `Issue ${params.identifier} not found` }],
          details: { identifier: params.identifier, found: false },
        };
      }

      const comments = issue.comments?.nodes?.length 
        ? `\n\nComments (${issue.comments.nodes.length}):\n` + 
          issue.comments.nodes.map((c: any) => `  - ${c.user?.name}: ${c.body.substring(0, 80).replace(/\n/g, " ")}`).join("\n")
        : "\n\nNo comments";

      const children = issue.children?.nodes?.length
        ? `\n\nSub-issues (${issue.children.nodes.length}):\n` +
          issue.children.nodes.map((child: any) => `  - ${child.identifier}: ${child.title} [${child.state?.name || "No state"}]${child.assignee ? ` (${child.assignee.name})` : ""}`).join("\n")
        : "\n\nNo sub-issues";

      const parent = issue.parent
        ? `\n\n📎 Parent issue: ${issue.parent.identifier} - ${issue.parent.title}`
        : "";

      const text = 
        `${issue.identifier}: ${issue.title}${parent}\n` +
        `URL: ${issue.url}\n\n` +
        `State: ${issue.state?.name || "None"}\n` +
        `Team: ${issue.team?.name || "None"} (${issue.team?.key})\n` +
        `Assignee: ${issue.assignee?.name || "Unassigned"}\n` +
        `Priority: ${issue.priority || "None"} | Estimate: ${issue.estimate || "None"}\n` +
        `Project: ${issue.project?.name || "None"}${children}\n\n` +
        `Description:\n${issue.description || "No description"}${comments}`;

      return {
        content: [{ type: "text", text }],
        details: { issue },
      };
    },
  });

  // Create issue
  pi.registerTool({
    name: "linear_create_issue",
    label: "Create Linear Issue",
    description: "Create a new issue in Linear. Requires team ID - use linear_get_teams to find available teams first. Can also create sub-issues by specifying a parent issue.",
    parameters: Type.Object({
      title: Type.String({ description: "Issue title" }),
      teamId: Type.String({ description: "Team ID (get from linear_get_teams)" }),
      description: Type.Optional(Type.String({ description: "Issue description (supports Markdown)" })),
      priority: Type.Optional(StringEnum(["0", "1", "2", "3", "4"] as const, { description: "Priority: 0=No priority, 1=Urgent, 2=High, 3=Normal, 4=Low" })),
      assigneeId: Type.Optional(Type.String({ description: "User ID to assign the issue to" })),
      projectId: Type.Optional(Type.String({ description: "Project ID to add the issue to" })),
      stateId: Type.Optional(Type.String({ description: "Workflow state ID" })),
      parentIdentifier: Type.Optional(Type.String({ description: "Parent issue identifier (e.g., 'ENG-123') to create this as a sub-issue" })),
    }),
    async execute(_toolCallId, params, signal) {
      // If parentIdentifier is provided, get the parent issue ID first
      let parentId: string | undefined;
      if (params.parentIdentifier) {
        const parentQuery = `
          query GetParentId($identifier: String!) {
            issues(filter: { identifier: { eq: $identifier } }) {
              nodes {
                id
              }
            }
          }
        `;
        const parentData = await linearQuery<{ issues: { nodes: Array<{ id: string }> } }>(
          parentQuery,
          { identifier: params.parentIdentifier },
          signal
        );
        parentId = parentData.issues.nodes[0]?.id;
        if (!parentId) {
          throw new Error(`Parent issue ${params.parentIdentifier} not found`);
        }
      }

      const mutation = `
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              title
              url
              team {
                name
              }
              parent {
                identifier
                title
              }
            }
          }
        }
      `;

      const input: Record<string, unknown> = {
        title: params.title,
        teamId: params.teamId,
      };

      if (params.description) input.description = params.description;
      if (params.priority) input.priority = parseInt(params.priority);
      if (params.assigneeId) input.assigneeId = params.assigneeId;
      if (params.projectId) input.projectId = params.projectId;
      if (params.stateId) input.stateId = params.stateId;
      if (parentId) input.parentId = parentId;

      const data = await linearQuery<{ issueCreate: { success: boolean; issue: any } }>(
        mutation,
        { input },
        signal
      );

      if (!data.issueCreate.success) {
        throw new Error("Failed to create issue");
      }

      const issue = data.issueCreate.issue;
      const subIssueText = issue.parent 
        ? `\n📎 Sub-issue of: ${issue.parent.identifier} - ${issue.parent.title}` 
        : "";

      return {
        content: [{ type: "text", text: `✅ Created ${issue.identifier}: ${issue.title}${subIssueText}\nTeam: ${issue.team?.name}\nURL: ${issue.url}` }],
        details: { issue },
      };
    },
  });

  // Create sub-issue (convenience wrapper)
  pi.registerTool({
    name: "linear_create_sub_issue",
    label: "Create Linear Sub-Issue",
    description: "Create a sub-issue (child issue) under an existing parent issue. The sub-issue will inherit the team from the parent by default.",
    parameters: Type.Object({
      parentIdentifier: Type.String({ description: "Parent issue identifier (e.g., 'ENG-123')" }),
      title: Type.String({ description: "Sub-issue title" }),
      description: Type.Optional(Type.String({ description: "Sub-issue description (supports Markdown)" })),
      priority: Type.Optional(StringEnum(["0", "1", "2", "3", "4"] as const, { description: "Priority: 0=No priority, 1=Urgent, 2=High, 3=Normal, 4=Low" })),
      assigneeId: Type.Optional(Type.String({ description: "User ID to assign the sub-issue to" })),
      teamId: Type.Optional(Type.String({ description: "Team ID (defaults to parent's team if not specified)" })),
    }),
    async execute(_toolCallId, params, signal) {
      // First get the parent issue to get its team and ID
      const parentQuery = `
        query GetParent($identifier: String!) {
          issues(filter: { identifier: { eq: $identifier } }) {
            nodes {
              id
              team {
                id
              }
            }
          }
        }
      `;

      const parentData = await linearQuery<{ issues: { nodes: Array<{ id: string; team: { id: string } }> } }>(
        parentQuery,
        { identifier: params.parentIdentifier },
        signal
      );

      const parent = parentData.issues.nodes[0];
      if (!parent) {
        throw new Error(`Parent issue ${params.parentIdentifier} not found`);
      }

      const mutation = `
        mutation CreateSubIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              title
              url
              team {
                name
              }
              parent {
                identifier
                title
              }
            }
          }
        }
      `;

      const input: Record<string, unknown> = {
        title: params.title,
        teamId: params.teamId || parent.team.id,
        parentId: parent.id,
      };

      if (params.description) input.description = params.description;
      if (params.priority) input.priority = parseInt(params.priority);
      if (params.assigneeId) input.assigneeId = params.assigneeId;

      const data = await linearQuery<{ issueCreate: { success: boolean; issue: any } }>(
        mutation,
        { input },
        signal
      );

      if (!data.issueCreate.success) {
        throw new Error("Failed to create sub-issue");
      }

      const issue = data.issueCreate.issue;

      return {
        content: [{ type: "text", text: `✅ Created sub-issue ${issue.identifier}: ${issue.title}\n📎 Parent: ${issue.parent.identifier} - ${issue.parent.title}\nTeam: ${issue.team?.name}\nURL: ${issue.url}` }],
        details: { issue },
      };
    },
  });

  // Update issue
  pi.registerTool({
    name: "linear_update_issue",
    label: "Update Linear Issue",
    description: "Update an existing Linear issue. Use issue identifier (e.g., 'TEAM-123') to identify the issue.",
    parameters: Type.Object({
      identifier: Type.String({ description: "Issue identifier (e.g., 'ENG-123')" }),
      title: Type.Optional(Type.String({ description: "New title" })),
      description: Type.Optional(Type.String({ description: "New description" })),
      stateId: Type.Optional(Type.String({ description: "New workflow state ID" })),
      priority: Type.Optional(StringEnum(["0", "1", "2", "3", "4"] as const, { description: "Priority: 0=No priority, 1=Urgent, 2=High, 3=Normal, 4=Low" })),
      assigneeId: Type.Optional(Type.String({ description: "User ID to assign to (use 'null' to unassign)" })),
    }),
    async execute(_toolCallId, params, signal) {
      // First get the issue ID from identifier
      const getQuery = `
        query GetIssueId($identifier: String!) {
          issues(filter: { identifier: { eq: $identifier } }) {
            nodes {
              id
            }
          }
        }
      `;

      const getData = await linearQuery<{ issues: { nodes: Array<{ id: string }> } }>(
        getQuery,
        { identifier: params.identifier },
        signal
      );

      const issueId = getData.issues.nodes[0]?.id;
      if (!issueId) {
        throw new Error(`Issue ${params.identifier} not found`);
      }

      const mutation = `
        mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue {
              id
              identifier
              title
              url
            }
          }
        }
      `;

      const input: Record<string, unknown> = {};
      if (params.title !== undefined) input.title = params.title;
      if (params.description !== undefined) input.description = params.description;
      if (params.stateId !== undefined) input.stateId = params.stateId;
      if (params.priority !== undefined) input.priority = parseInt(params.priority);
      if (params.assigneeId !== undefined) {
        input.assigneeId = params.assigneeId === "null" ? null : params.assigneeId;
      }

      const data = await linearQuery<{ issueUpdate: { success: boolean; issue: any } }>(
        mutation,
        { id: issueId, input },
        signal
      );

      if (!data.issueUpdate.success) {
        throw new Error("Failed to update issue");
      }

      const issue = data.issueUpdate.issue;

      return {
        content: [{ type: "text", text: `✅ Updated ${issue.identifier}: ${issue.title}\nURL: ${issue.url}` }],
        details: { issue },
      };
    },
  });

  // Get teams
  pi.registerTool({
    name: "linear_get_teams",
    label: "Get Linear Teams",
    description: "Get list of teams in your Linear workspace with their IDs, keys, and member counts. Use this to get teamId for creating issues.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal) {
      const query = `
        query GetTeams {
          teams {
            nodes {
              id
              name
              key
              description
              members {
                nodes {
                  id
                  name
                  email
                }
              }
              states {
                nodes {
                  id
                  name
                  color
                }
              }
            }
          }
        }
      `;

      const data = await linearQuery<{ teams: { nodes: any[] } }>(query, {}, signal);
      const teams = data.teams.nodes;

      const formatted = teams.map(t => {
        const states = t.states?.nodes?.map((s: any) => `${s.name} (${s.id})`).join(", ") || "None";
        return `${t.name} (Key: ${t.key})\n  ID: ${t.id}\n  Members: ${t.members?.nodes?.length || 0}\n  States: ${states}`;
      }).join("\n\n");

      return {
        content: [{ type: "text", text: `Teams (${teams.length}):\n\n${formatted}` }],
        details: { teams },
      };
    },
  });

  // Get projects
  pi.registerTool({
    name: "linear_get_projects",
    label: "Get Linear Projects",
    description: "Get list of projects in your Linear workspace. Useful for getting projectId when creating issues.",
    parameters: Type.Object({
      state: Type.Optional(StringEnum(["planned", "started", "paused", "completed", "canceled"] as const, { description: "Filter by project state" })),
    }),
    async execute(_toolCallId, params, signal) {
      const query = `
        query GetProjects($filter: ProjectFilter) {
          projects(filter: $filter) {
            nodes {
              id
              name
              description
              state
              progress
              startDate
              targetDate
              url
              teams {
                nodes {
                  name
                }
              }
            }
          }
        }
      `;

      const filter = params.state ? { state: { eq: params.state } } : undefined;
      const data = await linearQuery<{ projects: { nodes: any[] } }>(query, { filter }, signal);
      const projects = data.projects.nodes;

      if (projects.length === 0) {
        return {
          content: [{ type: "text", text: "No projects found" }],
          details: { projects: [] },
        };
      }

      const formatted = projects.map(p => 
        `${p.name}\n  ID: ${p.id}\n  State: ${p.state} | Progress: ${p.progress}%\n  ${p.targetDate ? `Target: ${p.targetDate} | ` : ""}URL: ${p.url}`
      ).join("\n\n");

      return {
        content: [{ type: "text", text: `Projects (${projects.length}):\n\n${formatted}` }],
        details: { projects },
      };
    },
  });

  // Add comment to issue
  pi.registerTool({
    name: "linear_add_comment",
    label: "Add Linear Comment",
    description: "Add a comment to an existing Linear issue",
    parameters: Type.Object({
      issueIdentifier: Type.String({ description: "Issue identifier (e.g., 'ENG-123')" }),
      body: Type.String({ description: "Comment text (supports Markdown)" }),
    }),
    async execute(_toolCallId, params, signal) {
      // First get the issue ID
      const getQuery = `
        query GetIssueId($identifier: String!) {
          issues(filter: { identifier: { eq: $identifier } }) {
            nodes {
              id
            }
          }
        }
      `;

      const getData = await linearQuery<{ issues: { nodes: Array<{ id: string }> } }>(
        getQuery,
        { identifier: params.issueIdentifier },
        signal
      );

      const issueId = getData.issues.nodes[0]?.id;
      if (!issueId) {
        throw new Error(`Issue ${params.issueIdentifier} not found`);
      }

      const mutation = `
        mutation CreateComment($input: CommentCreateInput!) {
          commentCreate(input: $input) {
            success
            comment {
              id
              body
              url
              user {
                name
              }
            }
          }
        }
      `;

      const data = await linearQuery<{ commentCreate: { success: boolean; comment: any } }>(
        mutation,
        { input: { issueId, body: params.body } },
        signal
      );

      if (!data.commentCreate.success) {
        throw new Error("Failed to add comment");
      }

      const comment = data.commentCreate.comment;

      return {
        content: [{ type: "text", text: `✅ Comment added to ${params.issueIdentifier} by ${comment.user?.name}\nURL: ${comment.url}` }],
        details: { comment },
      };
    },
  });

  // Get project milestones with their issues
  pi.registerTool({
    name: "linear_get_project_milestones",
    label: "Get Project Milestones",
    description: "Get all milestones of a Linear project with their associated issues. Use linear_get_projects to find project IDs first.",
    parameters: Type.Object({
      projectId: Type.String({ description: "Project ID (UUID, get from linear_get_projects)" }),
    }),
    async execute(_toolCallId, params, signal) {
      const query = `
        query GetProjectMilestones($id: String!) {
          project(id: $id) {
            id
            name
            url
            projectMilestones {
              nodes {
                id
                name
                description
                targetDate
                status
                issues {
                  nodes {
                    identifier
                    title
                    state { name }
                    team { key }
                    url
                  }
                }
              }
            }
          }
        }
      `;

      const data = await linearQuery<{ project: any }>(
        query,
        { id: params.projectId },
        signal
      );

      const project = data.project;
      if (!project) {
        return {
          content: [{ type: "text", text: `Project ${params.projectId} not found` }],
          details: { projectId: params.projectId, found: false },
        };
      }

      const milestones = project.projectMilestones?.nodes || [];
      if (milestones.length === 0) {
        return {
          content: [{ type: "text", text: `No milestones found for project: ${project.name}` }],
          details: { project, milestones: [] },
        };
      }

      const statusEmoji = (s: string) => {
        switch (s) {
          case "overdue": return "🔴";
          case "at_risk": return "🟠";
          case "on_track": return "🟢";
          case "completed": return "✅";
          default: return "⚪";
        }
      };

      let text = `Project: ${project.name}\nURL: ${project.url}\nMilestones: ${milestones.length}\n\n`;

      const milestoneDetails: any[] = [];
      for (const m of milestones) {
        const issues = m.issues?.nodes || [];
        const emoji = statusEmoji(m.status || "");
        const dateStr = m.targetDate ? ` (Target: ${m.targetDate})` : "";
        const desc = m.description ? m.description.replace(/\[([^\]]+)\]\(<([^>]+)>\)/g, '$1: $2').replace(/\n/g, " ") : "";

        text += `${emoji} **${m.name}** — ${m.status || "No status"}${dateStr}\n`;
        if (desc) text += `  ${desc}\n`;
        text += `  Issues (${issues.length}):\n`;

        for (const issue of issues) {
          text += `    - ${issue.identifier}: ${issue.title} [${issue.state?.name || "None"}] (Team: ${issue.team?.key || "-"})\n`;
        }
        text += "\n";

        milestoneDetails.push({
          id: m.id,
          name: m.name,
          description: m.description,
          targetDate: m.targetDate,
          status: m.status,
          issues: issues.map((i: any) => ({
            identifier: i.identifier,
            title: i.title,
            state: i.state?.name,
            team: i.team?.key,
            url: i.url,
          })),
        });
      }

      return {
        content: [{ type: "text", text }],
        details: { project: { id: project.id, name: project.name, url: project.url }, milestones: milestoneDetails },
      };
    },
  });

  // Command to test connection
  pi.registerCommand("linear-test", {
    description: "Test Linear API connection",
    handler: async (_args, ctx) => {
      if (!process.env.LINEAR_API_KEY) {
        ctx.ui.notify("❌ LINEAR_API_KEY not set", "error");
        return;
      }

      try {
        const query = `
          query {
            viewer {
              id
              name
              email
            }
          }
        `;

        const data = await linearQuery<{ viewer: { name: string; email: string } }>(query);
        ctx.ui.notify(`✅ Connected as ${data.viewer.name} (${data.viewer.email})`, "success");
      } catch (error) {
        ctx.ui.notify(`❌ Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
      }
    },
  });
}
