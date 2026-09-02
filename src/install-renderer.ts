import { renderPlainEvent, type InstallationEventListener, type InstallationRendererMode } from './install-events';

export interface InstallationRendererIO {
  stdout: { write: (text: string) => unknown };
}

function boundedError(message: string | undefined, limit = 2_000): string | undefined {
  const detail = message?.trim();
  if (!detail) return undefined;
  return detail.length <= limit ? detail : `[diagnostic truncated]\n${detail.slice(-limit)}`;
}

/** One append-only renderer for every terminal, redirected, and test run. */
export function createInstallationRenderer(_mode: InstallationRendererMode, io: InstallationRendererIO): InstallationEventListener {
  return (event) => {
    const rendered = renderPlainEvent(event);
    const detail = event.kind === 'session' && event.status !== 'succeeded'
      ? boundedError(event.error?.message)
      : undefined;
    io.stdout.write(`${detail && !rendered.includes(detail) ? `${rendered}: ${detail}` : rendered}\n`);
  };
}
