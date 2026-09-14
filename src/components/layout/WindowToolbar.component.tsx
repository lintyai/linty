import { PanelLeft, Search, X } from "lucide-react";
import { useAppStore } from "@/store/app.store";
import { SETTINGS_SECTIONS, type AppView, type SettingsSection } from "@/store/slices/navigation.slice";

const TITLES: Record<AppView, string> = {
  dashboard: "Overview", history: "History", apps: "Apps", settings: "Settings",
  "system-check": "System Check", shortcuts: "Shortcuts", about: "About Linty",
};

export function WindowToolbar() {
  const { currentView, sidebarVisible, toggleSidebar, searchQuery, setSearchQuery, settingsSection, setSettingsSection } = useAppStore();
  return (
    <header data-tauri-drag-region className={`window-toolbar ${sidebarVisible ? "" : "sidebar-hidden"}`}>
      <button className="icon-button" onClick={toggleSidebar} aria-label={sidebarVisible ? "Hide sidebar" : "Show sidebar"} aria-expanded={sidebarVisible} aria-controls="app-sidebar" title="Toggle sidebar (⌃⌘S)">
        <PanelLeft size={17} />
      </button>
      <h1 data-tauri-drag-region>{TITLES[currentView]}</h1>
      <div data-tauri-drag-region className="toolbar-space" />
      {currentView === "history" && (
        <div className="search-field history-search">
          <Search size={14} aria-hidden="true" />
          <input id="history-search" type="search" aria-label="Search transcripts or apps" placeholder="Search transcripts or apps" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} spellCheck={false}
            onKeyDown={(e) => { if (e.key === "Escape" && searchQuery) { e.preventDefault(); e.stopPropagation(); setSearchQuery(""); } }} />
          {searchQuery ? <button className="search-clear" aria-label="Clear search" onClick={() => setSearchQuery("")}><X size={12} /></button> : <kbd>⌘F</kbd>}
        </div>
      )}
      {currentView === "settings" && (
        <select className="native-select" aria-label="Settings category" value={settingsSection} onChange={(e) => setSettingsSection(e.target.value as SettingsSection)}>
          {SETTINGS_SECTIONS.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
        </select>
      )}
    </header>
  );
}
