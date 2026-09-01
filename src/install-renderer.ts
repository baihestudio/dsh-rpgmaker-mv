import { spinner } from '@clack/prompts';

import { renderNdjsonEvent, renderPlainEvent, type InstallationEventListener, type InstallationRendererMode, type SessionEvent } from './install-events';

export interface InstallationRendererIO {
  stdout: { write: (text: string) => unknown };
  stderr?: { write: (text: string) => unknown };
}

function boundedError(message: string | undefined, limit = 2_000): string | undefined {
  const detail = message?.trim();
  if (!detail) return undefined;
  return detail.length <= limit ? detail : `[diagnostic truncated]\n${detail.slice(-limit)}`;
}

/**
 * One renderer for the shared event stream.  Clack owns terminal decoration;
 * it never owns phase/session state.  Plain and NDJSON modes are append-only
 * and therefore safe for redirection and automation.
 */
export function createInstallationRenderer(mode: InstallationRendererMode, io: InstallationRendererIO): InstallationEventListener {
  if (mode === 'ndjson') return (event) => io.stdout.write(renderNdjsonEvent(event));
  if (mode === 'plain') return (event) => io.stdout.write(`${renderPlainEvent(event)}\n`);
  const progress = spinner();
  let running = false;
  return (event: SessionEvent) => {
    if (event.kind === 'session' && event.status === 'started') return;
    if (event.kind === 'phase' && event.status === 'started') {
      const label = `${event.ordinal ?? '?'}${event.totalPhases ? `/${event.totalPhases}` : ''} ${event.phase ?? 'installation'}${event.operationLabel ? ` — ${event.operationLabel}` : ''}`;
      if (!running) {
        progress.start(label);
        running = true;
      } else progress.message(label);
      return;
    }
    if (event.kind === 'phase' && event.status !== 'started') {
      const label = `${event.phase ?? 'phase'} ${event.status}`;
      if (running) progress.message(label);
      return;
    }
    if (event.kind === 'session' && event.status !== 'started') {
      if (running) {
        const detail = boundedError(event.error?.message);
        if (event.status === 'succeeded') progress.stop('Installation complete');
        else if (event.status === 'cancelled') progress.stop(detail ? `Installation cancelled: ${detail}` : 'Installation cancelled');
        else progress.error(detail ? `Installation failed: ${detail}` : 'Installation failed');
        running = false;
      }
    }
  };
}
