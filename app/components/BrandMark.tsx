'use client';

interface BrandMarkProps {
  size?: 'small' | 'large';
}

export function BrandMark({ size = 'small' }: BrandMarkProps) {
  return (
    <div className={`brand-lockup brand-lockup-${size}`} aria-label="WikiCrawl">
      <svg className="brand-mark" viewBox="0 0 120 92" role="img" aria-label="WikiCrawl network mark">
        <g className="brand-mark-lines" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 18 49 46 77 24 103 16" />
          <path d="M49 46 34 73M49 46l34 28M77 24l6 50" />
        </g>
        <g className="brand-mark-nodes" fill="currentColor">
          <circle cx="18" cy="18" r="8" />
          <circle cx="49" cy="46" r="9" />
          <circle cx="77" cy="24" r="8" />
          <circle cx="103" cy="16" r="9" />
          <circle cx="34" cy="73" r="8" />
          <circle cx="83" cy="74" r="9" />
        </g>
      </svg>
      <span className="brand-wordmark">WIKI CRAWL</span>
      <span className="brand-tagline">MAP KNOWLEDGE</span>
    </div>
  );
}
