import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // The monorepo root, absolute (Next warns on a relative path), so standalone output includes workspace packages.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  // Compile the shared workspace package (it ships TS source, no build step).
  transpilePackages: ["@homestorm/shared"],
  webpack: (config) => {
    // Resolve `.js` specifiers to their `.ts`/`.tsx` source. The shared package
    // and our own lib use NodeNext-style `.js` import extensions; webpack needs
    // this alias to map them onto the actual TypeScript files.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
