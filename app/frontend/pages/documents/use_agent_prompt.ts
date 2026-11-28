import { useCallback, useEffect, useRef, useState } from 'react'

/** Copy agent prompt: copy on click; reveal the text when the clipboard
 *  refuses (permissions policy, native web view) so it can be copied by hand. */
export function useAgentPrompt() {
  const [origin, setOrigin] = useState('')
  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])
  const agentInstruction =
    `Create a Thinkroom document for me: POST ${origin}/api/docs with JSON ` +
    `{"title": "…", "format": "markdown", "content": "# …"} ` +
    `or use "format": "html" with HTML content, plus an X-Agent-Name header. ` +
    `The response includes the share URL — open it and we'll collaborate live. ` +
    `Fetch the share URL (Accept: text/plain) for the full API guide.`
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'refused'>('idle')
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const copyInstruction = useCallback(() => {
    clearTimeout(copyTimer.current)
    const refused = () => setCopyState('refused')
    try {
      void navigator.clipboard.writeText(agentInstruction).then(() => {
        setCopyState('copied')
        copyTimer.current = setTimeout(() => setCopyState('idle'), 2400)
      }, refused)
    } catch {
      refused()
    }
  }, [agentInstruction])
  useEffect(() => () => clearTimeout(copyTimer.current), [])

  return { agentInstruction, copyState, copyInstruction }
}
