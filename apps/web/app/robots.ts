import type { MetadataRoute } from "next";
import { WEB_URL } from "@/lib/legal";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${WEB_URL}/sitemap.xml`,
    host: WEB_URL,
  };
}
