import { useState, useRef, useEffect, useMemo } from "react";
import {
  Clock,
  BarChart3,
  ShieldCheck,
  Settings,
  Keyboard,
  Search,
  Mic,
  Cpu,
  Volume2,
  Palette,
  Shield,
  Sparkles,
  Accessibility,
  Cloud,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { useAppStore } from "@/store/app.store";
import type { AppView } from "@/store/slices/navigation.slice";
import { cn } from "@/lib/utils";

/* ── Nav items ── */

interface NavItem {
  view: AppView;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { view: "dashboard", label: "Dashboard", icon: <BarChart3 size={16} /> },
  { view: "history", label: "History", icon: <Clock size={16} /> },
  { view: "system-check", label: "System Check", icon: <ShieldCheck size={16} /> },
  { view: "shortcuts", label: "Shortcuts", icon: <Keyboard size={16} /> },
  { view: "settings", label: "Settings", icon: <Settings size={16} /> },
];

/* ── Searchable items ── */

interface SearchItem {
  label: string;
  category: string;
  keywords: string;
  view: AppView;
  icon: React.ReactNode;
}

const SEARCH_ITEMS: SearchItem[] = [
  // Pages
  { label: "History", category: "Pages", keywords: "transcripts past recordings", view: "history", icon: <Clock size={14} /> },
  { label: "Dashboard", category: "Pages", keywords: "stats overview analytics", view: "dashboard", icon: <BarChart3 size={14} /> },
  { label: "System Check", category: "Pages", keywords: "permissions microphone accessibility diagnostics", view: "system-check", icon: <ShieldCheck size={14} /> },
  { label: "Keyboard Shortcuts", category: "Pages", keywords: "hotkeys keys bindings", view: "shortcuts", icon: <Keyboard size={14} /> },
  { label: "Settings", category: "Pages", keywords: "preferences configuration", view: "settings", icon: <Settings size={14} /> },

  // Settings > General
  { label: "LLM Correction", category: "Settings", keywords: "grammar punctuation ai fix correction", view: "settings", icon: <Sparkles size={14} /> },
  { label: "After Transcription", category: "Settings", keywords: "paste auto clipboard output", view: "settings", icon: <Settings size={14} /> },

  // Settings > Audio
  { label: "Input Device", category: "Settings", keywords: "microphone mic audio source", view: "settings", icon: <Volume2 size={14} /> },
  { label: "Sample Quality", category: "Settings", keywords: "audio quality sample rate khz", view: "settings", icon: <Volume2 size={14} /> },

  // Settings > Models
  { label: "Speech Engine", category: "Settings", keywords: "stt local cloud groq whisper model transcription", view: "settings", icon: <Cpu size={14} /> },
  { label: "Groq API Key", category: "Settings", keywords: "api key cloud groq token", view: "settings", icon: <Cloud size={14} /> },

  // Settings > Appearance
  { label: "Theme", category: "Settings", keywords: "dark light mode appearance", view: "settings", icon: <Palette size={14} /> },
  { label: "Accent Color", category: "Settings", keywords: "color theme accent highlight", view: "settings", icon: <Palette size={14} /> },

  // Settings > Privacy
  { label: "Transcript Retention", category: "Settings", keywords: "storage history retention delete", view: "settings", icon: <Shield size={14} /> },
  { label: "Store Transcripts Locally", category: "Settings", keywords: "local storage save data privacy", view: "settings", icon: <Shield size={14} /> },
  { label: "Usage Statistics", category: "Settings", keywords: "analytics telemetry anonymous privacy", view: "settings", icon: <Shield size={14} /> },

  // System Check
  { label: "Microphone Access", category: "System Check", keywords: "mic permission grant recording", view: "system-check", icon: <Mic size={14} /> },
  { label: "Accessibility Permission", category: "System Check", keywords: "accessibility paste fn key permission", view: "system-check", icon: <Accessibility size={14} /> },
  { label: "Microphone Test", category: "System Check", keywords: "test mic recording audio check", view: "system-check", icon: <Mic size={14} /> },

  // Shortcuts
  { label: "Push-to-talk", category: "Shortcuts", keywords: "fn hold record shortcut hotkey", view: "shortcuts", icon: <Keyboard size={14} /> },
  { label: "Search History", category: "Shortcuts", keywords: "cmd f find search shortcut", view: "shortcuts", icon: <Keyboard size={14} /> },
  { label: "Quit App", category: "Shortcuts", keywords: "cmd q quit exit close shortcut", view: "shortcuts", icon: <Keyboard size={14} /> },
];

/* ── Components ── */

function NavButton({
  isActive,
  onClick,
  icon,
  label,
}: {
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-all duration-150",
        isActive
          ? "bg-bg-active font-medium text-text-primary"
          : "font-normal text-text-secondary hover:bg-bg-hover hover:text-text-primary active:bg-bg-active",
      )}
    >
      <span
        className={cn(
          "flex h-5 w-5 items-center justify-center transition-colors duration-150",
          isActive ? "text-accent" : "text-text-muted",
        )}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

function SidebarSearch({ onNavigate }: { onNavigate: (view: AppView) => void }) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return SEARCH_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q),
    );
  }, [query]);

  // Group results by category
  const grouped = useMemo(() => {
    const map = new Map<string, SearchItem[]>();
    for (const item of results) {
      const list = map.get(item.category) || [];
      list.push(item);
      map.set(item.category, list);
    }
    return map;
  }, [results]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectItem = (item: SearchItem) => {
    onNavigate(item.view);
    setQuery("");
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!results.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectItem(results[activeIndex]);
    } else if (e.key === "Escape") {
      setQuery("");
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={containerRef} className="relative px-2.5 pb-2">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => query.trim() && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search..."
          spellCheck={false}
          className={cn(
            "w-full rounded-lg border border-border-subtle bg-bg-elevated/50 py-[5px] pl-[30px] pr-2.5",
            "text-[12px] text-text-primary placeholder:text-text-muted",
            "outline-none transition-all duration-150",
            "focus:border-border-focus focus:bg-bg-elevated",
          )}
        />
      </div>

      {/* Results dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute left-2.5 right-2.5 top-full z-50 mt-1 max-h-[280px] overflow-y-auto rounded-lg border border-border-subtle bg-dropdown-bg shadow-[0_8px_30px_var(--color-shadow)]">
          {Array.from(grouped.entries()).map(([category, items]) => {
            return (
              <div key={category}>
                <div className="px-3 pt-2 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                    {category}
                  </span>
                </div>
                {items.map((item) => {
                  const flatIndex = results.indexOf(item);
                  return (
                    <button
                      key={`${item.category}-${item.label}`}
                      onClick={() => selectItem(item)}
                      onMouseEnter={() => setActiveIndex(flatIndex)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-[6px] text-left transition-colors duration-100",
                        flatIndex === activeIndex
                          ? "bg-dropdown-active text-text-primary"
                          : "text-text-secondary hover:bg-dropdown-hover",
                      )}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted">
                        {item.icon}
                      </span>
                      <span className="text-[12px] truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* No results */}
      {isOpen && query.trim() && results.length === 0 && (
        <div className="absolute left-2.5 right-2.5 top-full z-50 mt-1 rounded-lg border border-border-subtle bg-dropdown-bg shadow-[0_8px_30px_var(--color-shadow)] px-3 py-3">
          <span className="text-[12px] text-text-muted">No results found</span>
        </div>
      )}
    </div>
  );
}

/* ── Sidebar ── */

export function Sidebar() {
  const currentView = useAppStore((s) => s.currentView);
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  return (
    <aside className="flex h-full w-[var(--sidebar-width)] shrink-0 flex-col border-r border-border-subtle bg-bg-secondary">
      {/* Traffic light spacing + drag region */}
      <div data-tauri-drag-region className="h-[52px] shrink-0" />

      {/* App identity */}
      <div className="px-3.5 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
          Linty
        </span>
      </div>

      {/* Search */}
      <SidebarSearch onNavigate={setCurrentView} />

      {/* Navigation */}
      <nav className="flex flex-col gap-0.5 px-2.5">
        {NAV_ITEMS.map((item) => (
          <NavButton
            key={item.view}
            isActive={currentView === item.view}
            onClick={() => setCurrentView(item.view)}
            icon={item.icon}
            label={item.label}
          />
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User status */}
      <div className="px-2.5 pb-3">
        <div className="border-t border-border-subtle mb-2" />
        <button
          onClick={() => open("https://colbin.com")}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-normal text-text-secondary hover:bg-bg-hover hover:text-text-primary active:bg-bg-active transition-all duration-150"
        >
          <div className="relative shrink-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
              U
            </div>
            <div className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full border-2 border-bg-secondary bg-success" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="truncate text-[13px] text-text-primary">User</span>
            <span className="text-[11px] text-text-muted">Online</span>
          </div>
        </button>
      </div>
    </aside>
  );
}
