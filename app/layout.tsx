import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import './globals.css';
import { Providers } from './providers';

const bodyStyle = {
  '--font-display': '"Space Grotesk", "Inter", "Segoe UI", Arial, sans-serif',
  '--font-mono': '"IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
} as CSSProperties;

export const metadata: Metadata = {
  title: 'WikiCrawl - Internet Rabbit Hole Generator',
  description: 'Explore Wikipedia through interactive graph visualization. Start from any article and discover connections between topics.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={bodyStyle}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
