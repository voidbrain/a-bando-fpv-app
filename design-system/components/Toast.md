# Toast

Toast is the one-line confirmation that rises from the bottom centre and fades.

## Use

- `overlay` fill, `line` border, `radius-box`, 7 × 14px padding, at most 80vw wide. Enters with a 20px rise and fade over 0.2s.
- Short past-tense sentences: "Site saved", "Video synced to the log".
- Only one toast at a time; never for errors that need action (use a Notice).
- It is rendered by `app-toast-host`, the last element of the app root, outside every panel (a `position: fixed` parent
  would trap it under the panels), so it is always on top.

## Consumer provides

The message, through `ToastService`.

Source: `src/styles.scss (.toast), services/toast.service.ts`.
