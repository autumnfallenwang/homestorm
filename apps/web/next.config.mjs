/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: "../../",
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
