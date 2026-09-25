'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import type { WikiNode, CrawlResult, PathResult } from '@/types/graph';
import { buildAdjacency } from '@/lib/adjacency';
import { useNodeSummary } from './useNodeSummary';

interface NodeDetailPanelProps {
  node: WikiNode | null;
  data: CrawlResult | null;
  onClose: () => void;
  onExpand: (nodeId: string) => void;
  isExpanding?: boolean;
  isExpanded?: boolean;
  pathSelection?: { from: string; to: string; result: PathResult | null } | null;
  onFindPath?: (from: string, to: string) => void;
  onPathNodeClick?: (nodeId: string) => void;
  onClearPath?: () => void;
}

function NodeDetailPanel({
  node,
  data,
  onClose,
  onExpand,
  isExpanding = false,
  isExpanded = false,
  pathSelection = null,
  onFindPath = () => undefined,
  onPathNodeClick = () => undefined,
  onClearPath = () => undefined,
}: NodeDetailPanelProps) {
  const [pathPickerOpen, setPathPickerOpen] = useState(false);
  const [pathQuery, setPathQuery] = useState('');
  const [highlightedPathOption, setHighlightedPathOption] = useState(0);
  const connectedNodes = useMemo(() => {
    if (!node || !data) return [];
    const nodesById = new Map(data.nodes.map((candidate) => [candidate.id, candidate]));
    return (buildAdjacency(data.edges).get(node.id) ?? [])
      .map((connectedId) => nodesById.get(connectedId))
      .filter((connectedNode): connectedNode is WikiNode => Boolean(connectedNode));
  }, [data, node]);

  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useNodeSummary(node?.id ?? null);

  const pathOptions = useMemo(() => {
    if (!node || !data) return [];
    const query = pathQuery.trim().toLocaleLowerCase();
    return data.nodes
      .filter((candidate) => candidate.id !== node.id)
      .filter((candidate) => !query || candidate.title.toLocaleLowerCase().includes(query))
      .slice(0, 8);
  }, [data, node, pathQuery]);

  useEffect(() => {
    setPathPickerOpen(false);
    setPathQuery('');
    setHighlightedPathOption(0);
  }, [node?.id]);

  useEffect(() => {
    setHighlightedPathOption((current) => Math.min(current, Math.max(pathOptions.length - 1, 0)));
  }, [pathOptions.length]);

  const choosePathTarget = (target: WikiNode) => {
    if (!node) return;
    onFindPath(node.id, target.id);
    setPathPickerOpen(false);
    setPathQuery('');
  };

  if (!node || !data) return null;

  const community = data.communities.find(c => c.id === node.communityId);

  return (
    <div className="node-detail mobile-sheet reduce-effects absolute right-4 top-4 w-80 glass-strong shadow-2xl overflow-hidden border border-cyan-500/20 animate-in slide-in-from-right" role="region" aria-label={`${node.title} page details`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-cyan-500/10 to-purple-500/10">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="node-detail-mark flex-shrink-0">
            <div className="w-full h-full flex items-center justify-center">
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
          type="button"
          onClick={onClose}
          aria-label="Close node details"
          className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-all"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
        {/* Summary: thumbnail, description, extract */}
        {(summaryLoading || summary?.thumbnail) && (
          <div data-testid="node-summary-thumbnail" className="relative w-full aspect-[16/9] overflow-hidden rounded-xl bg-slate-800/60">
            {summary?.thumbnail ? (
              <Image
                src={summary.thumbnail.source}
                alt=""
                width={summary.thumbnail.width}
                height={summary.thumbnail.height}
                unoptimized
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <div data-testid="node-summary-thumbnail-skeleton" className="h-full w-full animate-pulse bg-slate-700/40" />
            )}
          </div>
        )}

        {summaryLoading ? (
          <div data-testid="node-summary-skeleton" className="space-y-2">
            <div className="h-3 w-1/2 animate-pulse rounded bg-slate-700/40" />
            <div className="h-3 w-full animate-pulse rounded bg-slate-700/40" />
            <div className="h-3 w-full animate-pulse rounded bg-slate-700/40" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-700/40" />
          </div>
        ) : summaryError ? (
          <p data-testid="node-summary-error" className="text-sm text-amber-400/90 italic">Couldn&apos;t load a preview for this page.</p>
        ) : (
          <>
            {summary?.description && (
              <p className="text-xs uppercase tracking-wide text-cyan-400/80">{summary.description}</p>
            )}
            <p data-testid="node-summary-extract" className="text-sm text-slate-300 leading-relaxed">
              {summary?.extract || 'No preview available for this page.'}
            </p>
          </>
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

        <div className="space-y-2">
          <button
            type="button"
            aria-expanded={pathPickerOpen}
            aria-controls="path-target-list"
            onClick={() => setPathPickerOpen((open) => !open)}
            className="w-full rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2.5 text-left text-sm font-medium text-cyan-200 transition hover:bg-cyan-400/20 hover:text-white"
          >
            Find path to...
          </button>
          {pathPickerOpen && (
            <div className="relative">
              <input
                autoFocus
                role="combobox"
                aria-label="Find path to a node"
                aria-controls="path-target-list"
                aria-expanded="true"
                aria-activedescendant={pathOptions[highlightedPathOption] ? `path-target-${pathOptions[highlightedPathOption].id}` : undefined}
                value={pathQuery}
                onChange={(event) => {
                  setPathQuery(event.target.value);
                  setHighlightedPathOption(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setPathPickerOpen(false);
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setHighlightedPathOption((current) => Math.min(current + 1, pathOptions.length - 1));
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setHighlightedPathOption((current) => Math.max(current - 1, 0));
                  } else if (event.key === 'Enter' && pathOptions[highlightedPathOption]) {
                    event.preventDefault();
                    choosePathTarget(pathOptions[highlightedPathOption]);
                  }
                }}
                placeholder="Search crawled nodes"
                className="w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none ring-cyan-400 placeholder:text-slate-500 focus:ring-2"
              />
              <div id="path-target-list" role="listbox" className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-slate-950 shadow-xl">
                {pathOptions.length > 0 ? pathOptions.map((candidate, index) => (
                  <button
                    key={candidate.id}
                    id={`path-target-${candidate.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === highlightedPathOption}
                    onMouseEnter={() => setHighlightedPathOption(index)}
                    onClick={() => choosePathTarget(candidate)}
                    className={`block w-full truncate px-3 py-2 text-left text-xs ${index === highlightedPathOption ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-300 hover:bg-white/5'}`}
                  >
                    {candidate.title}
                  </button>
                )) : (
                  <p className="px-3 py-2 text-xs text-slate-500">No matching crawled nodes</p>
                )}
              </div>
            </div>
          )}
        </div>

        {pathSelection && (
          <div className="space-y-3 rounded-xl border border-cyan-400/25 bg-cyan-400/5 p-3" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Shortest path</h4>
              <button type="button" onClick={onClearPath} className="text-xs text-slate-400 underline hover:text-white">Clear</button>
            </div>
            {pathSelection.result ? (
              <>
                <p className="text-xs text-slate-400">{pathSelection.result.length} {pathSelection.result.length === 1 ? 'hop' : 'hops'}</p>
                <ol className="space-y-1">
                  {pathSelection.result.path.map((nodeId, index) => {
                    const pathNode = data.nodes.find((candidate) => candidate.id === nodeId);
                    return (
                      <li key={nodeId} className="flex items-center gap-2 text-xs">
                        <span className="w-4 shrink-0 text-right text-slate-500">{index + 1}.</span>
                        <button type="button" onClick={() => onPathNodeClick(nodeId)} className="truncate text-left text-cyan-200 hover:text-white hover:underline">
                          {pathNode?.title ?? nodeId}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-amber-200">
                No path within the crawled graph. Try Expand on a node or increase depth.
              </p>
            )}
          </div>
        )}

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
        <div className="node-detail-actions pt-2">
          <button
            type="button"
            onClick={() => onExpand(node.id)}
            disabled={isExpanding || isExpanded}
            className="node-explore-button"
          >
            {isExpanding ? (
              <><span className="node-action-spinner" aria-hidden="true" /> Finding new connections</>
            ) : isExpanded ? (
              <><span aria-hidden="true">✓</span> Explored</>
            ) : (
              <>Explore deeper <span aria-hidden="true">↗</span></>
            )}
          </button>
          <a
            href={node.url}
            target="_blank"
            rel="noopener noreferrer"
            className="node-wikipedia-link"
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Wikipedia
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}

export const MemoizedNodeDetailPanel = memo(NodeDetailPanel);

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
