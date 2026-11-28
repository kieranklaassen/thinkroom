interface Props {
  className: string
}

export function VersionUpdateButton({ className }: Props) {
  return (
    <button type="button" className={className} onClick={() => window.location.reload()}>
      New version · Update
    </button>
  )
}
