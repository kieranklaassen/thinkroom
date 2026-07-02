export type FlashData = {
  notice?: string
  alert?: string
}

export type SharedProps = {
  /** True when the page is rendered inside the Ruby Native iOS/Android shell. */
  nativeApp: boolean
  /** True when the server marked this page as a form (native back skips it). */
  nativeForm: boolean
}
