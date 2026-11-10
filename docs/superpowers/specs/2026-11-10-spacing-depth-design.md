# Spacing and depth

The user requests a minimal Ark UI with consistent padding/margins, rounded corners, subtle 3D depth and fewer words where icons communicate actions. This is a visual pass over the existing desktop workspace, not a navigation or engine change.

## Design

- Palette: Primary #0E1013, Content #131518, Sidebar #17191C, Raised #2C2F36, Secondary #FAFAF9, Accent #00A896. Keep existing brand fonts: Outfit 600 for names/titles, Hanken Grotesk 400 for body and metadata.
- Layout: left-aligned rail, thread sidebar, working pane, workspace tools. Maintain resizable columns and 32px action targets. Use a 4px subdivision of the existing 8px grid: 4/8/12/16/24px. Use 16px content insets in compact windows and 24px in wider windows.
- Radius hierarchy: 4px small details, 6px controls/rows, 10px cards/menus/project tiles, 14px composer/dialogs/workspace frame; circular avatars and pills remain circular.
- Depth: columns remain tonal and flush. Controls get a thin top light and short shadow, inputs an inset shadow, contextual cards a restrained lift, floating menus/dialogs stronger shadows. No animation or decorative gradients.
- Reduce repeated action text with existing line icons and a small set of matching icons. Preserve accessible names, keyboard focus and tooltips. Keep explicit labels on primary and destructive confirmation actions.

```text
rail | thread list | tabs                       | workspace icons
     |            | title / quiet metadata      | team / files / git
     |            | conversation or task board  | tool content
     |            | [ rounded inset composer ]  |
```

## Approaches

1. Global shadow on every rounded surface: simple but obscures hierarchy and makes dense developer tools noisy.
2. Shared tokens with targeted elevation and spacing: selected, reuses existing components and keeps editing, terminals and native browser geometry intact.
3. Replace the workspace layout: unnecessary for the requested polish and risks unrelated behavior.

The plan was checked against the brief: use relief only on interactive or floating surfaces, avoid an identical card treatment everywhere, and retain Ark's existing brand. User direction authorizes this reversible visual implementation; preserve all pre-existing local work.

## Verification

Run typecheck, lint, the complete offline test suite and build. Launch dev with an isolated profile and an idle completed fixture thread, inspect at 1200x760 and the supported minimum 960x600, verify composer, task toggle, menus, tool tabs and focus. Never run live engine tests.
