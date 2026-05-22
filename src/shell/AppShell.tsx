import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { SwUpdateBanner } from "../features/system/SwUpdateBanner";

export function AppShell({
  rootClassName = "",
  density = "medium",
  topBar = <TopBar />,
  bannerStack,
  rail,
  main,
  aside,
  overlay,
  mobileTabBar,
}: {
  rootClassName?: string;
  density?: "compact" | "medium";
  topBar?: ReactNode;
  bannerStack?: ReactNode;
  rail: ReactNode;
  main: ReactNode;
  aside?: ReactNode;
  overlay?: ReactNode;
  mobileTabBar?: ReactNode;
}) {
  return (
    <div className={"board-root " + rootClassName} data-density={density}>
      <header>{topBar}</header>
      {bannerStack}
      <div className="board-body">
        <nav aria-label="Pipelines">{rail}</nav>
        <main>{main}</main>
        {aside ? <aside aria-label="Inbox">{aside}</aside> : null}
      </div>
      {mobileTabBar ? <nav aria-label="Sections">{mobileTabBar}</nav> : null}
      {overlay}
      <SwUpdateBanner />
    </div>
  );
}
