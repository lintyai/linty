import { Select } from "@/components/shared/Select.component";
import { PanelLeft } from "lucide-react";
import { useAppStore } from "@/store/app.store";
import {
  getPageDefinition,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@/config/navigation.config";

export function WindowToolbar() {
  const {
    currentView,
    sidebarVisible,
    toggleSidebar,
    settingsSection,
    setSettingsSection,
  } = useAppStore();
  return (
    <header
      data-tauri-drag-region
      className={`window-toolbar ${sidebarVisible ? "" : "sidebar-hidden"}`}
    >
      <button
        className="icon-button"
        onClick={toggleSidebar}
        aria-label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
        aria-expanded={sidebarVisible}
        aria-controls="app-sidebar"
        title="Toggle sidebar (⌃⌘S)"
      >
        <PanelLeft size={17} />
      </button>
      <span className="toolbar-title" data-tauri-drag-region>
        {getPageDefinition(currentView).label}
      </span>
      <div data-tauri-drag-region className="toolbar-space" />
      {currentView === "settings" && (
        <Select<SettingsSection>
          label="Settings category"
          value={settingsSection}
          onChange={setSettingsSection}
          options={SETTINGS_SECTIONS.map((section) => ({
            value: section.id,
            label: section.label,
          }))}
        />
      )}
    </header>
  );
}
