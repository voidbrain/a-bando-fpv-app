# ContextMenu

ContextMenu is the right-click menu, built from what is under the pointer.

## Use

- `.ctx` on `panel-solid`, `radius-menu`, `shadow-menu`, min 170px wide. An optional `.head` names the thing (section-label style).
- Items are plain left-aligned buttons; hover `wash-menu`. A destructive item is last and uses `danger-text`.
- Labels are verbs plus object where needed ("Duplicate", "Add floor above", "Delete building").

## Consumer provides

The items for the element under the pointer (or the ground), and closing on Esc, outside click or a choice.

Source: `src/app/ui/studio/bando-editor.ts (.ctx)`.
