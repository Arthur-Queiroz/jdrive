# Frontend and UX Specification

## Technology

- Svelte
- Vite
- TypeScript
- Static SPA

## Design Goals

- Minimal
- Fast
- Responsive
- Mobile-friendly
- Clear upload feedback
- Low visual complexity

## Login Screen

Contains:

- Product name
- Username field
- Password field
- Login button
- Authentication error state

Unauthenticated users must not see file-list content.

## Main Screen

Recommended sections:

1. Header
2. Search
3. Storage usage
4. Upload drop zone
5. Upload queue / progress
6. File list

## Upload Drop Zone

Must support:

- Click to select
- Drag enter feedback
- Drag leave feedback
- Drop multiple files

## Upload Queue

Each file should have its own row/card with:

- File name
- Size
- State
- Progress bar
- Percentage
- Error message when relevant

Required states:

```text
queued
uploading
completed
failed
```

## File List

Each item should show:

- Original name
- Human-readable size
- Upload date
- Download action
- Delete action

## Storage Indicator

Example:

```text
3.2 GB / 10 GB
32%
```

A visual progress bar is recommended.

## Search

- Search field on the main screen.
- Case-insensitive partial matching.
- Debounced requests are recommended but not mandatory.

## Delete Confirmation

Before deletion, display a simple confirmation that includes the file name.

## Responsive Behavior

Mobile:

- Single-column layout
- Large touch targets
- File metadata may wrap
- Actions remain easily accessible

Desktop:

- More compact table/list presentation is acceptable.
