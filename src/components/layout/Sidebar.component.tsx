import { useState, useRef, useEffect, useMemo } from "react";
import { Clock, BarChart3, ShieldCheck, Settings, Keyboard, Search, Mic, Cpu, Volume2, Palette, Shield, Sparkles, Accessibility, Cloud, Info, Loader2, AudioLines, Languages, ArrowDownToLine, Layers3, BookOpen } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { useAppStore } from "@/store/app.store";
import { useUpdater } from "@/hooks/useUpdater.hook";
import { SETTINGS_SECTIONS, type AppView, type SettingsSection } from "@/store/slices/navigation.slice";
import { formatTriggerLabel } from "@/lib/trigger.util";

interface SearchItem {
  label: string;
  category: string;
  keywords: string;
  view: AppView;
  section?: SettingsSection;
  icon: React.ReactNode;
}

const SEARCH_ITEMS: SearchItem[] = [
  // Pages
  { label: "History", category: "Pages", keywords: "transcripts past recordings", view: "history", icon: <Clock size={14} /> },
  { label: "Dictation by app", category: "Pages", keywords: "apps applications usage statistics words per app", view: "apps", icon: <Layers3 size={14} /> },
  { label: "Dictionary", category: "Pages", keywords: "dictionary vocabulary corrections words learn spelling names", view: "dictionary", icon: <BookOpen size={14} /> },
  { label: "Overview", category: "Pages", keywords: "stats overview analytics", view: "dashboard", icon: <BarChart3 size={14} /> },
  { label: "System Check", category: "Pages", keywords: "permissions microphone accessibility diagnostics", view: "system-check", icon: <ShieldCheck size={14} /> },
  { label: "Keyboard Shortcuts", category: "Pages", keywords: "hotkeys keys bindings", view: "shortcuts", icon: <Keyboard size={14} /> },
  { label: "Settings", category: "Pages", keywords: "preferences configuration", view: "settings", icon: <Settings size={14} /> },
  { label: "About", category: "Pages", keywords: "version update website github licenses", view: "about", icon: <Info size={14} /> },

  // Settings > General
  { label: "Refine transcription", section: "general", category: "Settings", keywords: "grammar punctuation ai fix correction", view: "settings", icon: <Sparkles size={14} /> },
  { label: "After Transcription", section: "general", category: "Settings", keywords: "paste auto clipboard output", view: "settings", icon: <Settings size={14} /> },

  // Settings > Audio
  { label: "Input Device", section: "audio", category: "Settings", keywords: "microphone mic audio source", view: "settings", icon: <Volume2 size={14} /> },
  { label: "Sample Quality", section: "audio", category: "Settings", keywords: "audio quality sample rate khz", view: "settings", icon: <Volume2 size={14} /> },

  // Settings > Models
  { label: "Speech Engine", section: "models", category: "Settings", keywords: "stt local cloud groq whisper model transcription", view: "settings", icon: <Cpu size={14} /> },
  { label: "Groq API Key", section: "models", category: "Settings", keywords: "api key cloud groq token", view: "settings", icon: <Cloud size={14} /> },

  // Settings > Appearance
  { label: "Theme", section: "appearance", category: "Settings", keywords: "dark light mode appearance", view: "settings", icon: <Palette size={14} /> },
  { label: "Accent Color", section: "appearance", category: "Settings", keywords: "color theme accent highlight", view: "settings", icon: <Palette size={14} /> },

  // Settings > Privacy
  { label: "History Retention", section: "privacy", category: "Settings", keywords: "storage history retention delete", view: "settings", icon: <Shield size={14} /> },
  { label: "Storage Location", section: "privacy", category: "Settings", keywords: "local storage save data privacy", view: "settings", icon: <Shield size={14} /> },
  { label: "Attribute Dictations to Apps", section: "privacy", category: "Settings", keywords: "analytics applications words time privacy usage", view: "settings", icon: <Shield size={14} /> },
  { label: "Dictionary & learning", section: "privacy", category: "Settings", keywords: "dictionary apply learn words automatically corrections", view: "settings", icon: <Shield size={14} /> },

  { label: "Transcription language", category: "Settings", keywords: "language spoken english auto-detect", view: "settings", section: "language", icon: <Languages size={14} /> },

  // System Check
  { label: "Microphone Access", category: "System Check", keywords: "mic permission grant recording", view: "system-check", icon: <Mic size={14} /> },
  { label: "Accessibility Permission", category: "System Check", keywords: "accessibility paste fn key permission", view: "system-check", icon: <Accessibility size={14} /> },
  { label: "Microphone Test", category: "System Check", keywords: "test mic recording audio check", view: "system-check", icon: <Mic size={14} /> },

  // Shortcuts
  { label: "Push-to-talk", category: "Shortcuts", keywords: "fn hold record shortcut hotkey", view: "shortcuts", icon: <Keyboard size={14} /> },
  { label: "Search History", category: "Shortcuts", keywords: "cmd f find search shortcut", view: "shortcuts", icon: <Keyboard size={14} /> },
  { label: "Quit App", category: "Shortcuts", keywords: "cmd q quit exit close shortcut", view: "shortcuts", icon: <Keyboard size={14} /> },
];

function SidebarSearch() {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? SEARCH_ITEMS.filter((item) => `${item.label} ${item.keywords} ${item.category}`.toLowerCase().includes(q)) : [];
  }, [query]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => {
    if (isOpen) document.getElementById(`nav-result-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);
  const select = (item: SearchItem) => {
    if (item.section) useAppStore.getState().setSettingsSection(item.section);
    else useAppStore.getState().setCurrentView(item.view);
    setQuery(""); setIsOpen(false); inputRef.current?.blur();
  };
  return (
    <div className="sidebar-search" ref={containerRef} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsOpen(false); }}>
      <div className="search-field">
        <Search size={13} aria-hidden="true" />
        <input ref={inputRef} id="navigation-search" aria-label="Search Linty" role="combobox" aria-autocomplete="list" aria-expanded={isOpen && !!query.trim()} aria-controls={isOpen && query.trim() ? "navigation-results" : undefined} aria-activedescendant={isOpen && results.length ? `nav-result-${activeIndex}` : undefined}
          placeholder="Search Linty" value={query} spellCheck={false}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setIsOpen(false); setQuery(""); }
            if (!results.length) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setIsOpen(true); setActiveIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length); }
            if (e.key === "Enter" && isOpen) { e.preventDefault(); select(results[activeIndex]); }
          }} />
        {!query && <kbd>⌘K</kbd>}
      </div>
      {isOpen && query.trim() && <div id="navigation-results" role="listbox" aria-label="Search results" className="navigation-results">
        {results.length ? results.map((item, i) => <div key={item.label} id={`nav-result-${i}`} role="option" aria-selected={i === activeIndex} className="navigation-result" onMouseDown={(e) => e.preventDefault()} onClick={() => select(item)} onMouseEnter={() => setActiveIndex(i)}>
          {item.icon}<span>{item.label}<small>{item.category}</small></span>
        </div>) : <p className="search-no-results">No matches. Try “language” or “microphone”.</p>}
      </div>}
    </div>
  );
}

function VersionIndicator() {
  const [version, setVersion] = useState("");
  const { updateStatus, updateVersion, updateProgress, setCurrentView } = useAppStore();
  const { checkForUpdate, downloadAndInstall } = useUpdater();
  useEffect(() => { getVersion().then(setVersion).catch(() => {}); }, []);
  return <div className="sidebar-version">
    <button onClick={() => setCurrentView("about")} title="About Linty">Linty {version}</button>
    {updateStatus === "checking" && <Loader2 size={12} className="animate-spin" aria-label="Checking for updates" />}
    {updateStatus === "downloading" && <span role="status">{updateProgress}%</span>}
    {updateStatus === "available" && <button className="text-accent" onClick={downloadAndInstall} title={`Install version ${updateVersion}`}><ArrowDownToLine size={12} /> Update</button>}
    {updateStatus === "error" && <button className="text-error" onClick={() => checkForUpdate()}>Retry update</button>}
  </div>;
}

export function Sidebar() {
  const { currentView, setCurrentView, settingsSection, setSettingsSection, triggerKey } = useAppStore();
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current?.querySelector(currentView === "settings" ? '.settings-navigation [aria-current]' : '[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [currentView, settingsSection]);
  const nav = (view: AppView, label: string, icon: React.ReactNode) => <button key={view} className="nav-button" aria-current={currentView === view ? "page" : undefined} onClick={() => setCurrentView(view)}>{icon}<span>{label}</span></button>;
  return (
    <aside id="app-sidebar" className="app-sidebar">
      <div data-tauri-drag-region className="sidebar-titlebar" />
      <div className="sidebar-brand"><span className="brand-symbol"><AudioLines size={20} /></span><span className="brand-name">Linty</span></div>
      <SidebarSearch />
      <nav ref={navRef} aria-label="Main navigation" className="sidebar-navigation">
        <p className="nav-group-label">Workspace</p>
        {nav("dashboard", "Overview", <BarChart3 size={16} />)}
        {nav("history", "History", <Clock size={16} />)}
        {nav("apps", "Apps", <Layers3 size={16} />)}
        {nav("dictionary", "Dictionary", <BookOpen size={16} />)}
        <p className="nav-group-label utilities-label">Utilities</p>
        {nav("shortcuts", "Shortcuts", <Keyboard size={16} />)}
        {nav("system-check", "System Check", <ShieldCheck size={16} />)}
        {nav("settings", "Settings", <Settings size={16} />)}
        {currentView === "settings" && <div className="settings-navigation" aria-label="Settings categories">
          {SETTINGS_SECTIONS.map((section) => <button key={section.id} onClick={() => setSettingsSection(section.id)} aria-current={settingsSection === section.id ? "true" : undefined}>{section.label}</button>)}
        </div>}
        {nav("about", "About", <Info size={16} />)}
      </nav>
      <div className="sidebar-tip"><Keyboard size={16} /><div><span>Hold <kbd>{formatTriggerLabel(triggerKey)}</kbd> to dictate</span><p>Release to paste your words.</p></div></div>
      <VersionIndicator />
    </aside>
  );
}
