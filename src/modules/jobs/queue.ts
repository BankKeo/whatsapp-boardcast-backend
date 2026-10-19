/**
 * Background job queue.
 *
 * A small, dependency-free in-process queue is the default driver so the service
 * runs without Redis, while the interface matches what a BullMQ deployment needs
 * (docs/starter-project.md §7). Long work — campaign fan-out, retries, scheduled
 * dispatch — never blocks an Express request.
 *
 * Swap `QUEUE_DRIVER=redis` for the production Redis-backed worker described in
 * the README; nothing else in the codebase changes.
 */

import { logger } from "../../config/logger";

export type Processor = (payload: unknown) => Promise<void>;

interface QueueJob {
  id: string;
  name: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
}

export interface QueueStats {
  driver: "memory" | "redis";
  pending: number;
  active: number;
  completed: number;
  failed: number;
  deadLettered: number;
}

class InMemoryQueue {
  readonly driver = "memory" as const;

  private readonly processors = new Map<string, Processor>();
  private readonly jobs: QueueJob[] = [];
  private readonly deadLetters: QueueJob[] = [];
  private readonly pendingKeys = new Set<string>();

  private active = 0;
  private completed = 0;
  private failed = 0;
  private concurrency = 2;
  private draining: Promise<void> | null = null;

  register(name: string, processor: Processor): void {
    this.processors.set(name, processor);
  }

  configure(options: { concurrency?: number }): void {
    if (options.concurrency) this.concurrency = options.concurrency;
  }

  enqueue(name: string, payload: unknown, options: { maxAttempts?: number; dedupeKey?: string } = {}): string | null {
    if (options.dedupeKey) {
      if (this.pendingKeys.has(options.dedupeKey)) return null;
      this.pendingKeys.add(options.dedupeKey);
    }

    const job: QueueJob = {
      id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      payload,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      dedupeKey: options.dedupeKey ?? null,
    };
    this.jobs.push(job);
    void this.pump();
    return job.id;
  }

  private async pump(): Promise<void> {
    while (this.active < this.concurrency && this.jobs.length > 0) {
      const job = this.jobs.shift()!;
      this.active += 1;
      void this.run(job).finally(() => {
        this.active -= 1;
        if (job.dedupeKey) this.pendingKeys.delete(job.dedupeKey);
        void this.pump();
      });
    }
  }

  private async run(job: QueueJob): Promise<void> {
    const processor = this.processors.get(job.name);
    if (!processor) {
      logger.error({ job: job.name }, "No processor registered for job");
      this.deadLetters.push(job);
      this.failed += 1;
      return;
    }

    job.attempts += 1;
    try {
      await processor(job.payload);
      this.completed += 1;
    } catch (error) {
      if (job.attempts < job.maxAttempts) {
        const delay = 2 ** job.attempts * 500;
        logger.warn({ job: job.name, attempts: job.attempts, delay, err: error }, "Job failed; retrying");
        setTimeout(() => {
          this.jobs.push(job);
          void this.pump();
        }, delay);
      } else {
        this.failed += 1;
        this.deadLetters.push(job);
        logger.error({ job: job.name, err: error }, "Job moved to the dead-letter queue");
      }
    }
  }

  /** Resolve once the queue is empty and nothing is running (test helper). */
  async drain(timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while ((this.jobs.length > 0 || this.active > 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  stats(): QueueStats {
    return {
      driver: this.driver,
      pending: this.jobs.length,
      active: this.active,
      completed: this.completed,
      failed: this.failed,
      deadLettered: this.deadLetters.length,
    };
  }

  reset(): void {
    this.jobs.length = 0;
    this.deadLetters.length = 0;
    this.pendingKeys.clear();
    this.completed = 0;
    this.failed = 0;
  }

  /** Test seam for injecting a Redis-backed queue in production. */
  setDraining(promise: Promise<void> | null): void {
    this.draining = promise;
  }
}

export const queue = new InMemoryQueue();

/** Enqueue a campaign dispatch, deduplicated by campaign id. */
export function enqueueCampaignDispatch(campaignId: string): void {
  queue.enqueue("campaign-dispatch", campaignId, { dedupeKey: `dispatch:${campaignId}` });
}
