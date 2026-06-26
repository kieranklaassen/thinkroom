import { useCallback, useEffect, useState } from 'react'
import {
  RiffrecRecorder,
  downloadSessionArchive,
  type SessionResult,
} from 'riffrec'
import { csrfToken } from '../lib/csrf'

const LAST_RUN_KEY = 'thinkroom.feedbackRunId'

function rememberedRunId(): number | null {
  try {
    const stored = window.localStorage.getItem(LAST_RUN_KEY) ?? ''
    if (!/^[1-9]\d*$/.test(stored)) {
      forgetRememberedRun()
      return null
    }
    const id = Number(stored)
    if (Number.isSafeInteger(id)) return id
    forgetRememberedRun()
    return null
  } catch {
    return null
  }
}

function forgetRememberedRun() {
  try {
    window.localStorage.removeItem(LAST_RUN_KEY)
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

function rememberRun(id: number) {
  try {
    window.localStorage.setItem(LAST_RUN_KEY, String(id))
  } catch {
    // Upload success does not depend on local status persistence.
  }
}

type FeedbackRunStatus = {
  id: number
  status: 'uploaded' | 'running' | 'finished' | 'failed'
  cursor_status?: string
  agent_url?: string
  branch_name?: string
  pr_url?: string
  error?: string
}

function statusMessage(run: FeedbackRunStatus | null, uploading: boolean): string | null {
  if (uploading) return 'Uploading feedback…'
  if (!run) return null
  if (run.status === 'uploaded') return 'Feedback uploaded. Starting Cursor…'
  if (run.status === 'running') return 'Cursor is building your pull request…'
  if (run.status === 'finished') return run.pr_url ? 'Pull request ready.' : 'Cursor finished.'
  return run.error || 'Automation stopped before completing.'
}

export function FeedbackButton({ automationEnabled = false }: { automationEnabled?: boolean }) {
  const [pendingArchive, setPendingArchive] = useState<SessionResult | null>(null)
  const [run, setRun] = useState<FeedbackRunStatus | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pollGeneration, setPollGeneration] = useState(0)
  const [runId, setRunId] = useState<number | null>(() => {
    if (!automationEnabled || typeof window === 'undefined') return null
    return rememberedRunId()
  })

  useEffect(() => {
    if (!automationEnabled || !runId) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const refresh = async () => {
      try {
        const response = await fetch(`/feedback_runs/${runId}`, {
          headers: { Accept: 'application/json' },
        })
        if ([401, 403, 404].includes(response.status)) {
          if (cancelled) return
          forgetRememberedRun()
          setRunId(null)
          setRun(null)
          setUploadError('Previous automation status is no longer available.')
          return
        }
        if (!response.ok) throw new Error('Could not refresh automation status.')
        const nextRun = (await response.json()) as FeedbackRunStatus
        if (cancelled) return
        setRun(nextRun)
        if (nextRun.status === 'uploaded' || nextRun.status === 'running') {
          setUploadError(nextRun.error ?? null)
          timer = setTimeout(refresh, nextRun.error ? 10_000 : 3_000)
        } else {
          setUploadError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setUploadError(error instanceof Error ? error.message : 'Could not refresh automation status.')
          timer = setTimeout(refresh, 10_000)
        }
      }
    }

    void refresh()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [automationEnabled, pollGeneration, runId])

  const uploadArchive = useCallback(async (result: SessionResult) => {
    setPendingArchive(result)
    setUploading(true)
    setUploadError(null)

    const body = new FormData()
    body.append('archive', result.archive, result.filename)
    body.append('filename', result.filename)
    body.append('session_id', result.sessionId)

    try {
      const response = await fetch('/feedback_runs', {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken() },
        body,
      })
      const payload = (await response.json()) as FeedbackRunStatus & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not upload feedback.')

      setRun(payload)
      setRunId(payload.id)
      setPollGeneration((generation) => generation + 1)
      rememberRun(payload.id)
      setPendingArchive(payload.status === 'failed' ? result : null)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not upload feedback.')
    } finally {
      setUploading(false)
    }
  }, [])

  const handleSessionComplete = useCallback((result: SessionResult) => {
    if (automationEnabled) return uploadArchive(result)
    console.info('riffrec session saved:', result.filesPresent.join(', '))
  }, [automationEnabled, uploadArchive])

  const message = statusMessage(run, uploading)

  return (
    <div className="feedback-flow">
      <RiffrecRecorder
        className="feedback-button"
        startLabel="Feedback"
        stopLabel={automationEnabled ? 'Stop & upload' : 'Stop & save'}
        disabledLabel="Feedback"
        download={!automationEnabled}
        consentTitle="Record feedback for Thinkroom"
        consentDescription={
          automationEnabled
            ? 'Records this tab’s screen, your voice, clicks, and console/network signals. The private ZIP uploads to Thinkroom and starts a Cursor agent that prepares a pull request.'
            : 'Records this tab’s screen, your voice, clicks, and console/network signals into a ZIP that downloads to your machine. Nothing is uploaded.'
        }
        consentLabel="I understand what's being recorded"
        onSessionComplete={handleSessionComplete}
      />
      {(message || uploadError || pendingArchive) && (
        <div
          className={`feedback-status${run?.status === 'failed' || uploadError ? ' is-error' : ''}`}
          role={run?.status === 'failed' || uploadError ? 'alert' : 'status'}
          aria-live="polite"
        >
          <span>{uploadError || message}</span>
          <span className="feedback-status-actions">
            {pendingArchive && !uploading && (
              <>
                <button type="button" onClick={() => void uploadArchive(pendingArchive)}>
                  Retry upload
                </button>
                <button
                  type="button"
                  onClick={() => downloadSessionArchive(pendingArchive.filename, pendingArchive.archive)}
                >
                  Download ZIP
                </button>
              </>
            )}
            {run?.agent_url && run.status === 'running' && (
              <a href={run.agent_url} target="_blank" rel="noreferrer">Open Cursor</a>
            )}
            {run?.pr_url && (
              <a href={run.pr_url} target="_blank" rel="noreferrer">Open pull request</a>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
