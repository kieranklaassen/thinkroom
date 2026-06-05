import { RiffrecRecorder } from 'riffrec'

/** Riffrec-powered feedback recording: screen + voice + clicks + console/
 *  network signals, zipped client-side and downloaded — nothing uploads. */
export function FeedbackButton() {
  return (
    <RiffrecRecorder
      className="feedback-button"
      startLabel="Feedback"
      stopLabel="Stop & save"
      disabledLabel="Feedback"
      consentTitle="Record feedback for Pruf"
      consentDescription="Records this tab’s screen, your voice, clicks, and console/network signals into a zip that downloads to your machine. Nothing is uploaded."
      consentLabel="I understand what's being recorded"
      onSessionComplete={(result) =>
        console.info('riffrec session saved:', result?.filesPresent.join(', ') ?? '(no files)')
      }
    />
  )
}
