'use client';

import { useState, useRef, useEffect } from 'react';

interface SearchResult {
  title: string;
}

interface SeedSearchProps {
  onSearch: (title: string) => void;
  isLoading: boolean;
}

export function SeedSearch({ onSearch, isLoading }: SeedSearchProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();
  const requestIdRef = useRef(0);
  const cacheRef = useRef<Map<string, SearchResult[]>>(new Map());

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    const cacheKey = trimmed.toLowerCase();
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setSuggestions(cached);
      setShowSuggestions(true);
      setIsSearching(false);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const requestId = ++requestIdRef.current;
    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const controller = new AbortController();
        const response = await fetch(
          `/api/wikipedia/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          if (response.status === 429) {
            if (requestId === requestIdRef.current) {
              setSuggestions([]);
              setIsSearching(false);
            }
            return;
          }

          throw new Error(`Search failed: ${response.status}`);
        }

        const data = await response.json() as SearchResult[];
        if (requestId === requestIdRef.current) {
          cacheRef.current.set(cacheKey, data);
          setSuggestions(data);
          setIsSearching(false);
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        console.error('Search error:', error);
        if (requestId === requestIdRef.current) {
          setSuggestions([]);
          setIsSearching(false);
        }
      }
    }, 100);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIndex >= 0 && suggestions[selectedIndex]) {
      handleSelect(suggestions[selectedIndex].title);
    } else if (query.trim()) {
      onSearch(query.trim());
      setShowSuggestions(false);
    }
  };

  const handleSelect = (title: string) => {
    setQuery(title);
    setShowSuggestions(false);
    setSelectedIndex(-1);
    onSearch(title);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[selectedIndex].title);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }
  };

  return (
    <div className="relative">
      <form onSubmit={handleSubmit} className="flex gap-3">
        <div className="relative flex-1">
          {/* Search icon */}
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-cyan-400/60">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggestions(true);
              setSelectedIndex(-1);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            onKeyDown={handleKeyDown}
            placeholder="Search any Wikipedia article..."
            className="w-full pl-12 pr-4 py-3.5 bg-slate-800/50 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 focus:bg-slate-800/80 transition-all"
            disabled={isLoading}
          />
          
          {/* Glow effect on focus */}
          <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-pink-500/10 opacity-0 focus-within:opacity-100 transition-opacity pointer-events-none" />
          
          {showSuggestions && (
            <div className="absolute z-50 w-full mt-2 glass-strong rounded-xl shadow-2xl overflow-hidden border border-white/10">
              {isSearching && (
                <div className="flex items-center gap-3 px-4 py-3 text-sm text-cyan-300">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                  Searching...
                </div>
              )}

              {!isSearching && suggestions.length > 0 && (
                <ul>
                  {suggestions.map((suggestion, index) => (
                    <li key={suggestion.title}>
                      <button
                        type="button"
                        onClick={() => handleSelect(suggestion.title)}
                        className={`w-full px-4 py-3 text-left text-white hover:bg-gradient-to-r hover:from-cyan-500/20 hover:to-purple-500/20 transition-all flex items-center gap-3 ${
                          index === selectedIndex ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20' : ''
                        }`}
                      >
                        <svg className="w-4 h-4 text-cyan-400/60 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="truncate">{suggestion.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          className="btn-primary px-8 py-3.5 text-white font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-cyan-500/20"
        >
          {isLoading ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Diving...</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>Explore</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}
