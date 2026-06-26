---
title: "feat: Show live pointers from Read mode"
type: feat
date: 2026-06-26
issue: 80
---

# Show live pointers from Read mode

## Outcome

People reading a document can point at its prose by hovering, and collaborators see that movement live as a labeled cursor.

## Requirements

1. Mouse and pen hover in Read mode publish the nearest document position through the existing Yjs awareness channel.
2. Remote peers render the reader's position live with their name/color and a visual distinction from an editing caret.
3. Read hover never focuses the editor, changes the ProseMirror selection, writes document content, or persists state.
4. Leaving the editor, switching modes, blurring the window, or unmounting clears the pointer.
5. Touch movement is ignored because it has no hover state.
6. Positions use Yjs relative positions so concurrent edits do not strand the pointer.

## Implementation

- Add a Milkdown ProseMirror decoration plugin for a dedicated `readPointer` awareness field.
- Bind pointer movement only while the page's effective mode is Read, throttled to one update per animation frame and deduplicated by ProseMirror position.
- Clear the ordinary cursor when entering Read mode so peers never see an editing caret and read pointer simultaneously.
- Add restrained dashed-caret styling and browser coverage with two live sessions.

## Verification

- TypeScript and full Rails suite (the existing locked-reader channel test proves awareness relay remains authorized).
- Two-browser local test: reader hover appears/moves for editor, pointer leave clears it, content remains unchanged.
- Desktop and locked-link Read mode checks; touch viewport confirms no overflow or accidental editor interaction.
- Production smoke test and temporary-document cleanup.
