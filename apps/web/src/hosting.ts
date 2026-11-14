export const isNetlifyDeployment = (hostname: string): boolean =>
  hostname === "netlify.app" || hostname.endsWith(".netlify.app");
