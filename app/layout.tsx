import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { Analytics } from '@vercel/analytics/next';

export const metadata: Metadata = {
  title: 'WikiCrawl - Internet Rabbit Hole Generator',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wiki-crawl.vercel.app'),
  applicationName: 'WikiCrawl',
  description: 'Map the links around a Wikipedia article. Explore page neighborhoods, graph patterns, and unexpected connections.',
  openGraph: {
    type: 'website',
    siteName: 'WikiCrawl',
    title: 'WikiCrawl | Wikipedia, mapped',
    description: 'Map the links around a Wikipedia article and explore the connections in an interactive graph.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WikiCrawl | Wikipedia, mapped',
    description: 'Map the links around a Wikipedia article and explore the connections in an interactive graph.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="app-fonts">
        <Providers>
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
