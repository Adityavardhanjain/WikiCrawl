'use client';

import type { WikiNode, CrawlResult } from '@/types/graph';

interface NodeDetailPanelProps {
  node: WikiNode | null;
  data: CrawlResult | null;
  onClose: () => void;
  onExpand: (nodeId: string) => void;
  isExpanding?: boolean;
}

export function NodeDetailPanel({
  node,
  data,
  onClose,
  onExpand,
  isExpanding = false,
}: NodeDetailPanelProps) {
  if (!node || !data) return null;

  const community = data.communities.find(c => c.id === node.communityId);

  return (
    <div className="absolute right-4 top-4 w-80 bg-gray-900/95 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white truncate flex-1 mr-2">
          {node.title}
        </h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
        {/* Extract */}
        {node.extract ? (
          <p className="text-sm text-gray-300 leading-relaxed">
            {node.extract}
          </p>
        ) : (
          <p className="text-sm text-gray-500 italic">
            No preview available. Click to load more details.
          </p>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="PageRank" value={node.pagerank.toFixed(4)} />
          <MetricCard label="Betweenness" value={node.betweenness.toFixed(4)} />
          <MetricCard label="In-Degree" value={node.inDegree.toString()} />
          <MetricCard label="Out-Degree" value={node.outDegree.toString()} />
          <MetricCard label="Depth" value={node.depth >= 0 ? node.depth.toString() : '?'} />
          <MetricCard label="Community" value={community?.label || `Group ${node.communityId}`} />
        </div>

        {/* Community Members */}
        {community && community.size > 1 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">
              Community Members
            </h4>
            <div className="flex flex-wrap gap-1">
              {community.topPages.map(title => (
                <span
                  key={title}
                  className={`text-xs px-2 py-1 rounded ${
                    title === node.title
                      ? 'bg-cyan-600 text-white'
                      : 'bg-gray-700 text-gray-300'
                  }`}
                >
                  {title}
                </span>
              ))}
              {community.size > 3 && (
                <span className="text-xs px-2 py-1 text-gray-500">
                  +{community.size - 3} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <a
            href={node.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg text-center transition-colors"
          >
            View on Wikipedia
          </a>
          <button
            onClick={() => onExpand(node.id)}
            disabled={isExpanding}
            className="flex-1 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isExpanding ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Expanding...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Expand from here</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800 rounded-lg p-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm text-white font-medium truncate" title={value}>
        {value}
      </div>
    </div>
  );
}
