# Project-specific units

Units the base `assets/unit-dictionary.yaml` doesn't cover. Append at Phase 2 with `source=extension`.

```yaml
- { name: pipeline-rail-item,   category: container,  aliases: [rail-item, pipeline-card], source: src/shell/Rail.tsx }
- { name: iter-stages,          category: state,      aliases: [stage-chips], source: src/features/pipeline/IterStages.tsx }
- { name: focus-livelog,        category: state,      aliases: [livelog-row], source: src/features/pipeline/TicketCard.tsx }
- { name: focus-diff-chip,      category: state,      aliases: [diff-chip], source: src/features/pipeline/FocusDiffChip.tsx }
- { name: focus-column,         category: container,  aliases: [focus, board-focus], source: src/features/pipeline/FocusColumn.tsx }
- { name: ticket,               category: container,  aliases: [ticket-card], source: src/features/pipeline/TicketCard.tsx }
- { name: ticket-drawer,        category: feedback,   aliases: [ticket-detail], source: src/features/pipeline/TicketDrawer.tsx }
- { name: qa-drawer,            category: feedback,   aliases: [qa-chat], source: src/features/qa/QADrawer.tsx }
- { name: ready-banner,         category: feedback,   aliases: [merge-banner], source: src/features/pipeline/ReadyBanner.tsx }
- { name: sync-status-bar,      category: state,      aliases: [sync-chip], source: src/features/pipeline/SyncStatusBar.tsx }
- { name: sync-conflict-modal,  category: feedback,   aliases: [sync-conflict], source: src/features/pipeline/SyncConflictModal.tsx }
- { name: audit-timeline,       category: state,      aliases: [state-history], source: src/features/pipeline/AuditTimeline.tsx }
- { name: run-history,          category: container,  aliases: [pipeline-runs], source: src/features/pipeline/RunHistory.tsx }
- { name: history-drawer,       category: feedback,   aliases: [pipeline-history-drawer], source: src/features/pipeline/PipelineHistoryDrawer.tsx }
- { name: diff-modal,           category: feedback,   aliases: [worktree-diff], source: src/features/pipeline/DiffModal.tsx }
- { name: run-button,           category: input,      aliases: [pipeline-run-btn], source: src/features/pipeline/RunButton.tsx }
- { name: overflow-menu,        category: navigation, aliases: [focus-overflow], source: src/features/pipeline/OverflowMenu.tsx }
- { name: create-card,          category: container,  aliases: [create-pipeline], source: src/features/pipelineCreate/CreateCard.tsx }
- { name: empty-tickets,        category: state,      aliases: [focus-empty], source: src/features/pipeline/EmptyTickets.tsx }
- { name: empty-project,        category: state,      aliases: [no-project], source: src/features/pipeline/EmptyProject.tsx }
- { name: init-popup,           category: feedback,   aliases: [init-card], source: src/features/init/InitPopup.tsx }
- { name: settings-popover,     category: feedback,   aliases: [settings-modal], source: src/features/settings/SettingsPopover.tsx }
- { name: project-tab,          category: input,      aliases: [settings-project], source: src/features/settings/ProjectTab.tsx }
- { name: ai-tab,               category: input,      aliases: [settings-ai], source: src/features/settings/AITab.tsx }
- { name: notifications-tab,    category: input,      aliases: [settings-notif], source: src/features/settings/NotificationsTab.tsx }
- { name: update-tab,           category: state,      aliases: [settings-update], source: src/features/settings/UpdateTab.tsx }
- { name: sw-update-banner,     category: feedback,   aliases: [pwa-update], source: src/features/system/SwUpdateBanner.tsx }
- { name: topbar,               category: navigation, aliases: [appbar], source: src/shell/TopBar.tsx }
- { name: proj-switcher,        category: navigation, aliases: [project-menu], source: src/shell/TopBar.tsx }
- { name: browse-modal,         category: feedback,   aliases: [folder-picker], source: src/shell/TopBar.tsx }
- { name: parallel-chip,        category: state,      aliases: [n-m-chip], source: src/shell/TopBar.tsx }
- { name: sidebar,              category: navigation, aliases: [rail], source: src/shell/Rail.tsx }
- { name: inbox-strip,          category: navigation, aliases: [notif-strip], source: src/features/notifications/InboxColumn.tsx }
- { name: inbox-panel,          category: container,  aliases: [notif-list], source: src/features/notifications/InboxColumn.tsx }
- { name: confirm-dialog,       category: feedback,   aliases: [confirm], source: src/ui/ConfirmDialog.tsx }
```
