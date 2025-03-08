import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import { z } from "zod";

const server = new McpServer({
  name: "WeatherServer",
  version: "1.0.0",
});

const API_KEY = "b8c8251b2313715b71e7bb5c52c0423a";

server.tool("get_weather", { city: z.string() }, async ({ city }) => {
  const url = `http://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${API_KEY}&units=metric`;
  try {
    const response = await axios.get(url);
    const data = response.data;
    const temp = data.main.temp;
    const desc = data.weather[0].description;
    return {
      content: [{ type: "text", text: `${city}: ${temp}°C, ${desc}` }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: "Couldn't fetch weather data." }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  //   console.log("Weather server running on stdio");
}

main().catch(console.error);
