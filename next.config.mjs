/** @type {import('next').NextConfig} */
const nextConfig = {
  // Site 100% estático, publicado no GitHub Pages
  output: "export",
  // Em produção o Pages serve em /apuracao-2026/
  basePath: process.env.NODE_ENV === "production" ? "/apuracao-2026" : "",
  images: { unoptimized: true },
  trailingSlash: true,
};
export default nextConfig;
