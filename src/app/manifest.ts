import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Klidka · příprava na zákrok",
    short_name: "Klidka",
    description: "Předoperační příprava s anesteziologickou ambulancí.",
    lang: "cs",
    start_url: "/",
    display: "standalone",
    // Neutrální, dokud nemáme paletu.
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
