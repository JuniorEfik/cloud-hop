import { config } from "./config.js";
import { server } from "./server.js";

server.listen(config.apiPort, config.apiHost, () => {
  console.log(`NEAR Arcade API listening at http://${config.apiHost}:${config.apiPort}`);
  console.log(
    `Account sponsor: ${config.sponsorConfigured ? "configured" : "not configured"}`,
  );
  console.log(
    `Replay verifier: ${config.verifierConfigured ? "configured" : "not configured"}`,
  );
  console.log(
    `Gas relayer: ${config.relayerConfigured ? "configured" : "not configured"}`,
  );
});
