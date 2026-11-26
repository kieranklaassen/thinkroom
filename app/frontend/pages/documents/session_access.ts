import type { SaveState } from '../../editor/cable_provider'

/** The write access the editor session keeps. Following a change remounts the
 *  editor, which drops what it has not saved. While that is a large edit, lost
 *  access only makes the editor read-only, so the text can be copied. */
export const sessionAccess = (held: boolean, current: boolean, saveState: SaveState): boolean =>
  saveState === null ? current : held
