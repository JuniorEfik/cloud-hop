import serverless from "serverless-http";
import { server } from "../../apps/api/dist/src/server.js";

export const handler = serverless(server, {
  request(request) {
    const functionPrefix = "/.netlify/functions/api";
    if (request.url?.startsWith(functionPrefix)) {
      request.url = `/api${request.url.slice(functionPrefix.length)}`;
    }
  },
});
