import type { Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

/**
 * In-process periodic worker (ADR-0010). Ticks never overlap; a failing tick is logged and the
 * next tick runs normally. Disabled when WORKERS_ENABLED=false (tests call the work directly).
 */
export abstract class PeriodicTask implements OnApplicationBootstrap, OnApplicationShutdown {
  protected abstract readonly logger: Logger;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  protected constructor(
    private readonly taskName: string,
    private readonly enabled: boolean,
    private readonly intervalMs: number,
  ) {}

  protected abstract tick(): Promise<void>;

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      if (this.running || this.stopped) return;
      this.running = this.tick()
        .catch((error: unknown) => {
          this.logger.error(
            `${this.taskName} tick failed: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error.stack : undefined,
          );
        })
        .finally(() => {
          this.running = undefined;
        });
    }, this.intervalMs);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
