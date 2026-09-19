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
  const connectedNodes = data.nodes.filter((candidate) => data.edges.some((edge) => (
    (edge.source === node.id && edge.target === candidate.id) ||
    (edge.target === node.id && edge.source === candidate.id)
  )));

  return (
    <div className="node-detail absolute right-4 top-4 w-80 glass-strong rounded-2xl shadow-2xl overflow-hidden border border-cyan-500/20 animate-in slide-in-from-right">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-cyan-500/10 to-purple-500/10">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-500 p-[2px] flex-shrink-0">
            <div className="w-full h-full bg-slate-900 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
          <h3 className="text-lg font-bold text-white truncate">
            {node.title}
          </h3>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-all"
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
          <p className="text-sm text-slate-300 leading-relaxed">
            {node.extract}
          </p>
        ) : (
          <p className="text-sm text-slate-500 italic">
            No preview available. Click to load more details.
          </p>
        )}

        <div className="flex items-center gap-3 border-y border-white/10 py-3 text-xs text-slate-400">
          <span><strong className="text-white">{connectedNodes.length}</strong> connections</span>
          <span><strong className="text-white">{node.depth >= 0 ? node.depth : '?'}</strong> depth</span>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="PageRank" value={node.pagerank.toFixed(4)} color="cyan" />
          <MetricCard label="Cluster" value={community?.label?.slice(0, 18) || 'Unclustered'} color="yellow" />
        </div>

        {connectedNodes.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2 tracking-wide">Connected topics</h4>
            <div className="space-y-1">
              {connectedNodes.slice(0, 6).map((connectedNode) => (
                <p key={connectedNode.id} className="truncate text-xs text-slate-300">{connectedNode.title}</p>
              ))}
            </div>
          </div>
        )}

        {/* Community Members */}
        {community && community.size > 1 && (
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2 tracking-wide">
              Cluster Members
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {community.topPages.map(title => (
                <span
                  key={title}
                  className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
                    title === node.title
                      ? 'bg-gradient-to-r from-cyan-500 to-purple-500 text-white'
                      : 'bg-slate-800/80 text-slate-300 border border-white/5'
                  }`}
                >
                  {title}
                </span>
              ))}
              {community.size > 3 && (
                <span className="text-xs px-2.5 py-1 text-slate-500">
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
            className="flex-1 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded-xl text-center transition-all border border-white/10 hover:border-cyan-500/30"
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Wikipedia
            </span>
          </a>
          <button
            onClick={() => onExpand(node.id)}
            disabled={isExpanding}
            className="flex-1 btn-primary px-3 py-2.5 text-white text-sm rounded-xl transition-all flex items-center justify-center gap-2"
          >
            {isExpanding ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Diving...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Expand</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  const colorClasses: Record<string, string> = {
    cyan: 'text-cyan-400',
    purple: 'text-purple-400',
    pink: 'text-pink-400',
    yellow: 'text-yellow-400',
  };
  
  return (
    <div className="glass rounded-xl p-3">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-sm font-semibold truncate ${color ? colorClasses[color] : 'text-white'}`} title={value}>
        {value}
      </div>
    </div>
  );
}
