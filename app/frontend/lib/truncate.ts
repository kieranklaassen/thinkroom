export const truncate = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length)}…` : text
