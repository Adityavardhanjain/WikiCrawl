'use client';

interface CrawlControlsProps {
  depth: number;
  maxNodes: number;
  onDepthChange: (depth: number) => void;
  onMaxNodesChange: (maxNodes: number) => void;
  disabled?: boolean;
}

export function CrawlControls({
  depth,
  maxNodes,
  onDepthChange,
  onMaxNodesChange,
  disabled = false,
}: CrawlControlsProps) {
  return (
    <div className="flex gap-6">
      <div className="flex-1">
        <div className="flex justify-between items-center mb-2">
          <label className="text-sm font-medium text-gray-300">
            Crawl Depth
          </label>
          <span className="text-sm text-cyan-400 font-medium">{depth} hop{depth !== 1 ? 's' : ''}</span>
        </div>
        <input
          type="range"
          min="1"
          max="3"
          step="1"
          value={depth}
          onChange={(e) => onDepthChange(Number(e.target.value))}
          disabled={disabled}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>1 hop</span>
          <span>2 hops</span>
          <span>3 hops</span>
        </div>
      </div>

      <div className="flex-1">
        <div className="flex justify-between items-center mb-2">
          <label className="text-sm font-medium text-gray-300">
            Max Nodes
          </label>
          <span className="text-sm text-cyan-400 font-medium">{maxNodes}</span>
        </div>
        <input
          type="range"
          min="50"
          max="500"
          step="50"
          value={maxNodes}
          onChange={(e) => onMaxNodesChange(Number(e.target.value))}
          disabled={disabled}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>50</span>
          <span>250</span>
          <span>500</span>
        </div>
      </div>
    </div>
  );
}
