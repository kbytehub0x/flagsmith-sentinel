import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { flagsmithClient } from './flagsmith-client.js';
import { refactorEngine } from './refactor-engine.js';
import path from 'path';

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'flagsmith-sentinel-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'flagsmith_list_flags',
          description:
            'Lists all feature flags in the Flagsmith project, including enabled states, types, and lifecycle metrics (active, rolling out, stale).',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'flagsmith_get_flag',
          description:
            'Retrieves detailed configuration, multivariate splits, and targeting state for a specific feature flag.',
          inputSchema: {
            type: 'object',
            properties: {
              flag_name: {
                type: 'string',
                description: 'The unique key/name of the feature flag.',
              },
            },
            required: ['flag_name'],
          },
        },
        {
          name: 'flagsmith_create_flag',
          description:
            'Provisions a new feature flag in Flagsmith from a user story or feature request.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Unique flag name in snake_case (e.g., fast_checkout_v2).',
              },
              description: {
                type: 'string',
                description: 'Purpose and scope of the feature flag.',
              },
              default_enabled: {
                type: 'boolean',
                description: 'Initial state of the flag. Defaults to false.',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Categorization tags (e.g., ["ai", "checkout"]).',
              },
            },
            required: ['name', 'description'],
          },
        },
        {
          name: 'flagsmith_toggle_flag',
          description:
            'Enables or disables an existing feature flag in Flagsmith across environments.',
          inputSchema: {
            type: 'object',
            properties: {
              flag_name: {
                type: 'string',
                description: 'The unique key/name of the flag to toggle.',
              },
              enabled: {
                type: 'boolean',
                description: 'True to activate the flag, false to deactivate.',
              },
            },
            required: ['flag_name', 'enabled'],
          },
        },
        {
          name: 'flagsmith_audit_stale_flags',
          description:
            'Audits all feature flags in Flagsmith to identify stale, dead, or completed experiment flags that can be safely retired.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'flagsmith_scan_codebase',
          description:
            'Scans a local repository directory for occurrences of Flagsmith feature flag checks (hasFeature, isFeatureEnabled, etc.).',
          inputSchema: {
            type: 'object',
            properties: {
              directory_path: {
                type: 'string',
                description: 'Absolute or relative path to the codebase to scan. Defaults to sample-codebase.',
              },
            },
          },
        },
        {
          name: 'flagsmith_refactor_stale_flag',
          description:
            'Autonomously refactors source code to remove a dead or 100% rolled-out feature flag, keeping the winning code branch and removing dead imports.',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'Target file path to refactor.',
              },
              flag_name: {
                type: 'string',
                description: 'Name of the feature flag to remove.',
              },
              keep_branch: {
                type: 'string',
                enum: ['ENABLED', 'DISABLED'],
                description: 'Which code branch to preserve (ENABLED retains the if-block; DISABLED retains else-block).',
              },
              apply_changes: {
                type: 'boolean',
                description: 'Whether to write changes to disk or only return the diff preview.',
              },
            },
            required: ['file_path', 'flag_name', 'keep_branch'],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === 'flagsmith_list_flags') {
        const flags = await flagsmithClient.listFlags();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(flags, null, 2),
            },
          ],
        };
      }

      if (name === 'flagsmith_get_flag') {
        const flagName = String(args?.flag_name);
        const flag = await flagsmithClient.getFlag(flagName);
        if (!flag) {
          return {
            content: [{ type: 'text', text: `Error: Flag '${flagName}' not found.` }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(flag, null, 2) }],
        };
      }

      if (name === 'flagsmith_create_flag') {
        const newFlag = await flagsmithClient.createFlag({
          name: String(args?.name),
          description: String(args?.description),
          default_enabled: Boolean(args?.default_enabled),
          tags: (args?.tags as string[]) || [],
        });
        return {
          content: [
            {
              type: 'text',
              text: `✅ Successfully created flag in Flagsmith:\n${JSON.stringify(newFlag, null, 2)}`,
            },
          ],
        };
      }

      if (name === 'flagsmith_toggle_flag') {
        const flagName = String(args?.flag_name);
        const enabled = Boolean(args?.enabled);
        const updated = await flagsmithClient.toggleFlag(flagName, enabled);
        return {
          content: [
            {
              type: 'text',
              text: `🔄 Flag '${flagName}' updated. State is now: ${enabled ? 'ENABLED 🟢' : 'DISABLED 🔴'}\n${JSON.stringify(updated, null, 2)}`,
            },
          ],
        };
      }

      if (name === 'flagsmith_audit_stale_flags') {
        const audits = await flagsmithClient.auditStaleFlags();
        return {
          content: [
            {
              type: 'text',
              text: `🔍 Flagsmith Stale Flag Audit Results (${audits.length} candidates found):\n\n` +
                audits
                  .map(
                    (a, i) =>
                      `[${i + 1}] Flag: "${a.flag.name}" (Active: ${a.flag.days_active} days)\n` +
                      `    Status: ${a.flag.lifecycle_status}\n` +
                      `    Reason: ${a.reason}\n` +
                      `    Recommended Action: ${a.recommendation} (Risk: ${a.risk_level})\n`
                  )
                  .join('\n'),
            },
          ],
        };
      }

      if (name === 'flagsmith_scan_codebase') {
        const defaultPath = path.join(process.cwd(), 'src', 'sample-codebase');
        const targetDir = args?.directory_path ? String(args.directory_path) : defaultPath;
        const usages = refactorEngine.scanDirectory(targetDir);
        return {
          content: [
            {
              type: 'text',
              text: `📁 Codebase Scan for Flagsmith invocations in "${targetDir}":\nFound ${usages.length} references:\n\n` +
                usages
                  .map(
                    (u, i) =>
                      `[${i + 1}] Flag: "${u.flagName}" (${u.patternType})\n` +
                      `    File: ${path.relative(process.cwd(), u.filePath)}:${u.lineNumber}\n` +
                      `    Code: ${u.snippet}\n`
                  )
                  .join('\n'),
            },
          ],
        };
      }

      if (name === 'flagsmith_refactor_stale_flag') {
        const filePath = String(args?.file_path);
        const flagName = String(args?.flag_name);
        const keepBranch = (args?.keep_branch as 'ENABLED' | 'DISABLED') || 'ENABLED';
        const applyChanges = Boolean(args?.apply_changes);

        const diff = refactorEngine.refactorFile(filePath, flagName, keepBranch);
        if (!diff) {
          return {
            content: [
              {
                type: 'text',
                text: `No references to flag '${flagName}' found to refactor in ${filePath}.`,
              },
            ],
          };
        }

        if (applyChanges) {
          refactorEngine.applyRefactor(filePath, diff.refactoredContent);
        }

        return {
          content: [
            {
              type: 'text',
              text: `🛠️ ${applyChanges ? 'APPLIED REFACTOR' : 'PREVIEW REFACTOR'} for flag "${flagName}":\n` +
                `Summary: ${diff.diffSummary}\n\n` +
                `--- [BEFORE] ---\n${diff.originalContent}\n` +
                `--- [AFTER] ---\n${diff.refactoredContent}\n`,
            },
          ],
        };
      }

      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Tool error: ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function runStdioServer() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Flagsmith Sentinel MCP] Server started on stdio');
}

// Auto-run if executed directly as entrypoint
if (process.argv[1]?.endsWith('mcp-server.ts') || process.argv[1]?.endsWith('mcp-server.js')) {
  runStdioServer().catch((err) => {
    console.error('Fatal MCP Server error:', err);
    process.exit(1);
  });
}
