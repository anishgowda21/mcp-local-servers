#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import os from "os";

// Track running processes and their outputs
interface RunningProcess {
  process: any;
  output: string;
  error: string;
  running: boolean;
  startTime: number;
  workingDir: string;
  command: string;
}

const runningProcesses = new Map<string, RunningProcess>();

// Command line argument parsing
const args = process.argv.slice(2);
let allowedDirectories: string[] = [];

if (args.length > 0) {
  // Parse allowed directories
  allowedDirectories = args.map((dir) =>
    path.normalize(
      path.resolve(
        dir.startsWith("~") ? path.join(os.homedir(), dir.slice(1)) : dir
      )
    )
  );
} else {
  // Default to current directory
  allowedDirectories = [process.cwd()];
  console.error(
    "No directories specified. Using current directory:",
    process.cwd()
  );
}

// Security check
function isPathAllowed(requestedPath: string) {
  const normalizedPath = path.normalize(path.resolve(requestedPath));
  return allowedDirectories.some((dir) => normalizedPath.startsWith(dir));
}

// Schema definitions
const ExecuteCommandArgsSchema = z.object({
  command: z.string().describe("The command to execute"),
  workingDir: z
    .string()
    .optional()
    .describe(
      "Working directory for the command (defaults to current directory)"
    ),
  timeout: z
    .number()
    .optional()
    .default(60)
    .describe("Timeout in seconds (default: 60)"),
});

const ReadOutputArgsSchema = z.object({
  processId: z.string().describe("The process ID returned from executeCommand"),
  clear: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Whether to remove the process from memory after reading (default: false)"
    ),
});

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

// Server setup
const server = new Server(
  {
    name: "command-execution-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Command execution utilities
async function executeCommand(
  command: string,
  workingDir: string,
  timeout: number
): Promise<string> {
  // Default to current directory if none provided
  const effectiveWorkingDir = workingDir || process.cwd();

  // Security check
  if (!isPathAllowed(effectiveWorkingDir)) {
    throw new Error(
      `Working directory not allowed: ${effectiveWorkingDir}. Allowed directories: ${allowedDirectories.join(
        ", "
      )}`
    );
  }

  // Parse command string into command and args
  const parts = command.split(" ");
  const cmd = parts[0];
  const args = parts.slice(1);

  // Create a unique process ID
  const processId = uuidv4();
  const timeoutMs = timeout * 1000;

  try {
    // Spawn process
    const process = spawn(cmd, args, { cwd: effectiveWorkingDir });

    // Store process info
    runningProcesses.set(processId, {
      process,
      output: "",
      error: "",
      running: true,
      startTime: Date.now(),
      workingDir: effectiveWorkingDir,
      command: command,
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (runningProcesses.has(processId)) {
        const proc = runningProcesses.get(processId);
        if (proc) {
          if (proc.running) {
            proc.process.kill();
            proc.running = false;
            proc.error += "\nProcess terminated due to timeout.";
            runningProcesses.set(processId, proc);
          }
        }
      }
    }, timeoutMs);

    // Collect output
    process.stdout.on("data", (data) => {
      if (runningProcesses.has(processId)) {
        const proc = runningProcesses.get(processId);
        if (proc) {
          proc.output += data.toString();
          runningProcesses.set(processId, proc);
        }
      }
    });

    // Collect errors
    process.stderr.on("data", (data) => {
      if (runningProcesses.has(processId)) {
        const proc = runningProcesses.get(processId);
        if (proc) {
          proc.error += data.toString();
          runningProcesses.set(processId, proc);
        }
      }
    });

    // Handle process completion
    process.on("close", (code) => {
      clearTimeout(timeoutId);
      if (runningProcesses.has(processId)) {
        const proc = runningProcesses.get(processId);
        if (proc) {
          proc.running = false;
          runningProcesses.set(processId, proc);
        }
      }
    });

    return processId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to start command: ${errorMessage}`);
  }
}

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "execute_command",
        description:
          "Execute shell commands in specified working directories with security constraints. " +
          "Returns a process ID for tracking command execution. " +
          "Commands are restricted to pre-approved directories for security. " +
          "Requires explicit user confirmation for potentially dangerous commands including: " +
          "- delete operations (rm, rmdir, unlink) " +
          "- move operations (mv) " +
          "- format operations (mkfs) " +
          "- system modification (chmod, chown) " +
          "- network-altering commands (iptables, route) " +
          "- package management (apt, yum, npm uninstall) " +
          "For long-running processes (servers, daemons, continuous programs): " +
          "- Advise users to execute these directly in their terminal instead " +
          "- Provide the exact path and command to run in their terminal " +
          "- Warn that running through this interface will send processes to background " +
          "- Explain that termination would require manual process hunting and killing " +
          "- Specifically caution about commands like 'npm start', 'python server.py', 'node app.js' " +
          "Use 'read_output' command with the returned process ID to retrieve command results.",
        inputSchema: zodToJsonSchema(ExecuteCommandArgsSchema) as ToolInput,
      },
      {
        name: "read_output",
        description:
          "Retrieve the output from a previously executed command. " +
          "Provides stdout, stderr, and status information. " +
          "Can be called repeatedly to check progress of long-running commands.",
        inputSchema: zodToJsonSchema(ReadOutputArgsSchema) as ToolInput,
      },
      {
        name: "list_allowed_directories",
        description:
          "Returns the list of directories that this server is allowed to execute commands in.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "execute_command": {
        const parsed = ExecuteCommandArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(
            `Invalid arguments for execute_command: ${parsed.error}`
          );
        }

        const processId = await executeCommand(
          parsed.data.command,
          parsed.data.workingDir || process.cwd(),
          parsed.data.timeout
        );

        return {
          content: [
            {
              type: "text",
              text: `Command started with process ID: ${processId}\nCommand: ${
                parsed.data.command
              }\nWorking directory: ${
                parsed.data.workingDir || process.cwd()
              }\n\nUse read_output with this ID to get results.`,
            },
          ],
        };
      }

      case "read_output": {
        const parsed = ReadOutputArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for read_output: ${parsed.error}`);
        }

        if (!runningProcesses.has(parsed.data.processId)) {
          return {
            content: [
              {
                type: "text",
                text: `No process found with ID: ${parsed.data.processId}`,
              },
            ],
            isError: true,
          };
        }

        const proc = runningProcesses.get(parsed.data.processId);
        if (!proc) {
          throw new Error("Proc is undefined");
        }
        const runtime = Math.round((Date.now() - proc.startTime) / 1000);
        const status = proc.running ? "Running" : "Completed";

        // Prepare response
        const response = `Process ID: ${parsed.data.processId}
          Command: ${proc.command}
          Status: ${status}
          Working Directory: ${proc.workingDir}
          Runtime: ${runtime} seconds

          === STDOUT ===
          ${proc.output || "(No output)"}

          === STDERR ===
          ${proc.error || "(No errors)"}`;

        // Clear output if requested
        if (parsed.data.clear && !proc.running) {
          runningProcesses.delete(parsed.data.processId);
        }

        return {
          content: [{ type: "text", text: response }],
        };
      }

      case "list_allowed_directories": {
        return {
          content: [
            {
              type: "text",
              text: `Allowed directories for command execution:\n${allowedDirectories.join(
                "\n"
              )}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Start server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Command Execution MCP Server running on stdio");
  console.error("Allowed directories:", allowedDirectories);
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
