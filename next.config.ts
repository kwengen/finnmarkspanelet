import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Panelet er ett selvstendig HTML-dokument under public/finnmark/, slik
      // at det kan åpnes rett fra disk under utvikling. Her er det hele
      // nettstedet, så det serveres på rot.
      { source: "/", destination: "/finnmark/index.html" },
      // Den gamle adressen fra TinkrFlows beholdes så innkommende lenker ikke
      // dør i overgangen.
      { source: "/finnmark", destination: "/finnmark/index.html" },
    ];
  },
};

export default nextConfig;
