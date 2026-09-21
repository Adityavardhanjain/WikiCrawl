'use client';

interface CrawlControlsProps {
  depth: number;
  maxNodes: number;
  onDepthChange: (depth: number) => void;
  onMaxNodesChange: (maxNodes: number) => void;
  onGoDeeper?: () => void;
  canGoDeeper?: boolean;
  disabled?: boolean;
}

export function CrawlControls({
  depth,
  maxNodes,
  onDepthChange,
  onMaxNodesChange,
  onGoDeeper,
  canGoDeeper = false,
  disabled = false,
}: CrawlControlsProps) {
  return (
    <div className="flex items-end gap-6">
      <div className="flex-1">
        <div className="flex justify-between items-center mb-2">
          <label htmlFor="crawl-depth" className="text-sm font-medium text-atlas-muted">
            Crawl Depth
          </label>
          <span id="crawl-depth-value" className="text-sm text-cyan-400 font-medium">{depth} hop{depth !== 1 ? 's' : ''}</span>
        </div>
        <input
          id="crawl-depth"
          aria-label="Crawl depth"
          aria-valuetext={`${depth} hop${depth !== 1 ? 's' : ''}`}
          type="range"
          min="1"
          max="3"
          step="1"
          value={depth}
          onChange={(e) => onDepthChange(Number(e.target.value))}
          disabled={disabled}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="flex justify-between text-xs text-atlas-dim mt-1">
          <span>1 hop</span>
          <span>2 hops</span>
          <span>3 hops</span>
        </div>
      </div>

      <div className="flex-1">
        <div className="flex justify-between items-center mb-2">
          <label htmlFor="max-nodes" className="text-sm font-medium text-atlas-muted">
            Max Nodes
          </label>
          <span id="max-nodes-value" className="text-sm text-cyan-400 font-medium">{maxNodes}</span>
        </div>
        <input
          id="max-nodes"
          aria-label="Maximum crawled nodes"
          aria-valuetext={`${maxNodes} maximum nodes`}
          type="range"
          min="50"
          max="500"
          step="50"
          value={maxNodes}
          onChange={(e) => onMaxNodesChange(Number(e.target.value))}
          disabled={disabled}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="flex justify-between text-xs text-atlas-dim mt-1">
          <span>50</span>
          <span>250</span>
          <span>500</span>
        </div>
      </div>

      {onGoDeeper && (
        <button
          type="button"
          onClick={onGoDeeper}
          disabled={disabled || !canGoDeeper}
          className="h-10 whitespace-nowrap rounded-lg border border-cyan-400/40 px-3 text-sm font-medium text-cyan-200 transition hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Go deeper
        </button>
      )}
    </div>
  );
}
