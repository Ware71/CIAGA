import type { MetadataRoute } from "next";
import { WEB_URL } from "@/lib/legal";

const routes = [
  { path: "", priority: 1 },
  { path: "/legal", priority: 0.5 },
  { path: "/privacy", priority: 0.4 },
  { path: "/terms", priority: 0.4 },
  { path: "/cookies", priority: 0.3 },
  { path: "/acceptable-use", priority: 0.3 },
  { path: "/copyright", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return routes.map((r) => ({
    url: `${WEB_URL}${r.path}`,
    lastModified,
    changeFrequency: r.path === "" ? "monthly" : "yearly",
    priority: r.priority,
  }));
}
