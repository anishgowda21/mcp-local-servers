# MCP Server

This repository contains a collection of simple Model Context Protocol (MCP) servers designed for local execution. The included servers, such as mcp-filesystem (a clone of Anthropic's official filesystem server) and mcp-cmd-exec, can be combined with the Claude Desktop App to create a low-power Claude Code without an API KEY.

By running these servers, you can integrate them with the Claude Desktop App to perform tasks like file manipulation and command execution.

[This project](https://github.com/anishgowda21/github-viewer) is fully built by Claude Desktop App (including git management) using the `mcp-filesystem` and `mcp-cmd-exec` servers.

## Overview

MCP servers enable local execution of commands, file operations, and other utilities, communicating via the Model Context Protocol. This repo provides a starting point for developers to experiment with or extend these servers.

## Included Servers

`mcp-filesystem`: A clone of Anthropic’s official filesystem server, allowing file read/write operations within specified directories. Ideal for managing local files through Claude.
`mcp-cmd-exec`: Executes shell commands in pre-approved directories with security constraints. Pairs well with mcp-filesystem for a complete local tooling setup.
`mcp-sse`: A SSE server for simple fetch and echo can be used with cursor now.
`mcp-weather-node`: A weather server, For fetching weather data via APIs.

## Getting Started

To use these repos in your system, you need `Node v18` or higher and Claude Desktop installed.

Then u can clone

```
git clone https://github.com/anishgowda21/mcp-local-servers
cd mcp-local-servers
```

and build the projects.

```
cd <server name>
npm run build
```

and edit the claude config file to look like below.

```
{
  "globalShortcut": "",
  "mcpServers": {
    "file-system": {
      "command": "node",
      "args": [
        "/ABSOLUTE PATH/mcp-local-servers/mcp-filesystem/dist/index.js",
        "/Allowed dir absloute path"
      ]
    },
    "cmd-exec": {
      "command": "node",
      "args": [
        "/ABSOLUTE PATH/mcp-local-servers/mcp-cmd-exec/dist/index.js",
        "/Allowed dir absloute path"
      ]
    }
  }
}

```

and restart the Claude app and enjoy.
