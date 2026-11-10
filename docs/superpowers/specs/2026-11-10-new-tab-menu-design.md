# New tab menu

Replace the separate Browser and Terminal buttons in the workspace tab strip with a single `+` next to the tabs, following the supplied reference. The user confirmed that only terminals and browser belong in this menu.

Use the existing Menu component with optional search, icons and shortcut hints. Show the installed shells as `New terminal: <shell>`, `New browser tab`, and `Show terminal` / `Hide terminal` with the existing Ctrl+` shortcut. Keep terminals in the bottom panel and retain one browser tab per project. Search filters these actions; no new global search or agent commands.

The popup must fit the viewport, work with keyboard navigation, close on Escape/outside click/selection and restore focus appropriately. Register it as an overlay so the native browser page cannot cover it. Starting a chosen shell must reveal the panel and create exactly that shell in the selected project/worktree root.

Reuse Ark's dark surfaces, muted line icons, fonts and 4px corners. No dependencies or main/preload changes. Verify store behavior with unit tests and menu interaction in the dev app using a temporary profile.
