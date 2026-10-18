"use client";

import { useCallback, useEffect, useState } from "react";
import { UniverseProvider, useUniverse } from "@/state/universe-context";
import { HeaderBar } from "@/components/ui/HeaderBar";
import { FilterPanel } from "@/components/ui/FilterPanel";
import { DetailPanel } from "@/components/ui/DetailPanel";
import { StatsBar } from "@/components/ui/StatsBar";
import { ImportDialog } from "@/components/ui/ImportDialog";
import { ConnectionPanel } from "@/components/ui/ConnectionPanel";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import { SceneStage } from "@/components/ui/SceneStage";

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setMobile(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return mobile;
}

function Shell() {
  const { select, selectionId } = useUniverse();
  const isMobile = useIsMobile();
  const [importOpen, setImportOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [filtersOpenMobile, setFiltersOpenMobile] = useState(false);
  const [overviewOpenMobile, setOverviewOpenMobile] = useState(false);

  const closeImport = useCallback(() => setImportOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (importOpen) setImportOpen(false);
      else if (connectionOpen) setConnectionOpen(false);
      else if (privacyOpen) setPrivacyOpen(false);
      else if (filtersOpenMobile) setFiltersOpenMobile(false);
      else if (overviewOpenMobile) setOverviewOpenMobile(false);
      else if (selectionId) select(null, false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    importOpen,
    connectionOpen,
    privacyOpen,
    filtersOpenMobile,
    overviewOpenMobile,
    selectionId,
    select,
  ]);

  const showDetail = !isMobile || selectionId !== null || overviewOpenMobile;

  const closeDetail = useCallback(() => {
    select(null, false);
    setOverviewOpenMobile(false);
  }, [select]);

  return (
    <div
      className="relative h-dvh w-screen overflow-hidden bg-[#04050c] font-sans text-slate-100 antialiased"
      data-testid="universe-app"
    >
      <SceneStage onOpenImport={() => setImportOpen(true)} />
      <HeaderBar
        onOpenImport={() => setImportOpen(true)}
        onOpenConnection={() => setConnectionOpen(true)}
      />
      <FilterPanel />
      {filtersOpenMobile && (
        <FilterPanel
          variant="mobile"
          onClose={() => setFiltersOpenMobile(false)}
        />
      )}
      {showDetail && (
        <DetailPanel isMobile={isMobile} onClose={closeDetail} />
      )}
      <StatsBar
        onOpenFilters={() => setFiltersOpenMobile(true)}
        onOpenOverview={() => setOverviewOpenMobile(true)}
        onOpenPrivacy={() => setPrivacyOpen(true)}
      />
      <ImportDialog open={importOpen} onClose={closeImport} />
      <ConnectionPanel open={connectionOpen} onClose={() => setConnectionOpen(false)} />
      <PrivacyNote open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </div>
  );
}

export default function UniverseApp() {
  return (
    <UniverseProvider>
      <Shell />
    </UniverseProvider>
  );
}
