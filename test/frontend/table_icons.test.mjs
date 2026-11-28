import assert from 'node:assert/strict'
import test from 'node:test'
import { tableButtonIcon } from '../../app/frontend/editor/table_icons.ts'

// A stretch of path data that only this icon draws.
const ICONS = [
  ['M12 5v14M5 12h14', ['add_row', 'add_col']],
  ['M3 6h18M8 6V4', ['delete_row', 'delete_col']],
  ['M4 12h10', ['align_col_left']],
  ['M7 12h10', ['align_col_center']],
  ['M10 12h10', ['align_col_right']],
  ['circle cx="9" cy="6"', ['col_drag_handle', 'row_drag_handle']],
]

test('every table button draws its own icon', () => {
  for (const [path, buttons] of ICONS) {
    for (const button of buttons) {
      const drawn = ICONS.filter(([candidate]) => tableButtonIcon(button).includes(candidate))
      assert.deepEqual(drawn.map(([candidate]) => candidate), [path], button)
    }
  }
})
