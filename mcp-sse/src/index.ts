import express, { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

// Setup HTTP server with SSE
const app: Express = express();

// Track multiple clients
const clients: Map<
  string,
  {
    transport: SSEServerTransport;
    server: McpServer;
  }
> = new Map();

// Function to configure a server with all our tools
function setupServer(server: McpServer): void {
  // Add echo tool
  server.tool(
    "echo",
    { message: z.string().optional().default("hi") },
    async ({ message }) => ({
      content: [{ type: "text", text: `Echo: ${message || "hi"}` }],
    })
  );

  // Add fetch tool
  server.tool("fetch", { url: z.string().url() }, async ({ url }) => {
    try {
      const headers = {
        "User-Agent": "MCP Test Server (github.com/modelcontextprotocol)",
      };

      const response = await fetch(url, { headers });

      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${response.status} ${response.statusText}`,
            },
          ],
          isError: true,
        };
      }

      const text = await response.text();
      return {
        content: [{ type: "text", text }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  });
}

// Instead of using /sse/:clientId? (which causes the error)
// Use two separate routes

// Route without clientId
app.get("/sse", async (req: Request, res: Response) => {
  const clientId = uuidv4(); // Generate a new ID
  handleSseConnection(clientId, req, res);
});

// Route with clientId
app.get("/sse/:clientId", async (req: Request, res: Response) => {
  const clientId = req.params.clientId;
  handleSseConnection(clientId, req, res);
});

// Shared handler function
async function handleSseConnection(
  clientId: string,
  req: Request,
  res: Response
) {
  // Create a new server instance for this client
  const clientServer = new McpServer({
    name: "mcp-echo-fetch-server",
    version: "1.0.0",
  });

  // Set up all tools on this server instance
  setupServer(clientServer);

  const transport = new SSEServerTransport("/messages/" + clientId, res);

  // Rest of your connection handling code...
  clients.set(clientId, {
    transport,
    server: clientServer,
  });

  res.setHeader("X-Client-ID", clientId);
  console.log(`Client connected: ${clientId}`);

  res.on("close", () => {
    clients.delete(clientId);
    console.log(`Client disconnected: ${clientId}`);
  });

  await clientServer.connect(transport);
}

// Message handling endpoint with client ID
app.post("/messages/:clientId", async (req: Request, res: Response) => {
  const clientId = req.params.clientId;
  const client = clients.get(clientId);

  if (client) {
    await client.transport.handlePostMessage(req, res);
  } else {
    res.status(404).json({ error: "Client not found" });
  }
});

// Start server on port 3001
app.listen(3001, () => {
  console.log("Multi-client MCP server listening on port 3001");
});
