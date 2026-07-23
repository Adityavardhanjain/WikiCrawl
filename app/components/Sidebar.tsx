'use client';

import type { CrawlResult, WikiNode } from '@/types/graph';
import { getCommunityColor } from '@/lib/graphAnalysis';

interface SidebarProps {
  data: CrawlResult;
  onNodeSelect: (nodeId: string) => void;
  onCommunitySelect: (communityId: number) => void;
  focusedNode: string | null;
}

export function Sidebar({
  data,
  onNodeSelect,
  onCommunitySelect,
  focusedNode,
}: SidebarProps) {
  // Top pages by PageRank
  const topPages = [...data.nodes]
    .sort((a, b) => b.pagerank - a.pagerank)
    .slice(0, 10);

  // Color mode toggle
  const colorModeSections = [
    { id: 'community', label: 'Community' },
    { id: 'depth', label: 'Depth' },
  ];

  return (
    <div className="w-80 bg-gray-900 border-l border-gray-700 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-1">WikiCrawl</h2>
        <p className="text-sm text-gray-400">
          {data.nodes.length} nodes · {data.edges.length} edges · {data.communities.length} communities
        </p>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Top Pages Section */}
        <div className="p-4 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            Top Pages by PageRank
          </h3>
          <ul className="space-y-1">
            {topPages.map((node, index) => (
              <li key={node.id}>
                <button
                  onClick={() => onNodeSelect(node.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    focusedNode === node.id
                      ? 'bg-cyan-600 text-white'
                      : 'hover:bg-gray-800 text-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-4">{index + 1}.</span>
                    <span className="flex-1 truncate text-sm">{node.title}</span>
                    {node.id === data.seedId && (
                      <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">
                        Seed
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-500 pl-6">
                    PR: {node.pagerank.toFixed(4)} · In: {node.inDegree} · Out: {node.outDegree}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Communities Section */}
        <div className="p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Communities
          </h3>
          <ul className="space-y-2">
            {data.communities.slice(0, 10).map((community) => (
              <li key={community.id}>
                <button
                  onClick={() => onCommunitySelect(community.id)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{
                        backgroundColor: getCommunityColor(
                          community.id,
                          data.communities.length
                        ),
                      }}
                    />
                    <span className="flex-1 text-sm text-gray-300 truncate">
                      {community.label}
                    </span>
                    <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
                      {community.size}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 pl-5 truncate">
                    {community.topPages.slice(0, 2).join(', ')}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
        <p>Crawled: {new Date(data.crawledAt).toLocaleString()}</p>
      </div>
    </div>
  );
}
