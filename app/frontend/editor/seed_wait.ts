interface SeedWaitOptions {
  /** Only a writer can be granted the claim, so only a writer asks. */
  canRequest: boolean
  retryMs: number
  answerTimeoutMs: number
  request: () => void
}

/** Waiting for another client to apply the seed, asking for its claim meanwhile. */
export class SeedWait {
  /** No 'synced' until content arrives or this client is granted the claim. */
  waiting = false
  private readonly options: SeedWaitOptions
  private timer: ReturnType<typeof setTimeout> | null = null
  private requested = false

  constructor(options: SeedWaitOptions) {
    this.options = options
  }

  start(): void {
    this.stop()
    this.waiting = true
    if (!this.options.canRequest) return
    this.timer = setTimeout(() => {
      // Answered with a whole new handshake: content, a grant, or still pending.
      this.requested = true
      this.options.request()
      this.timer = setTimeout(() => this.start(), this.options.answerTimeoutMs)
    }, this.options.retryMs)
  }

  stop(): void {
    this.waiting = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Whether the handshake now arriving may answer a request. One handshake
   *  uses that up. */
  takeRequest(): boolean {
    const requested = this.requested
    this.requested = false
    return requested
  }
}
