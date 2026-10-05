import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_ORIGIN}/`,
    },
  ];
}
