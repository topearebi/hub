/**
 * Hub Telemetry Badge
 * -------------------
 * Renders the left cluster of the system header: client IP, location label,
 * and current weather. Falls back to a muted "Offline" badge when telemetry is
 * unavailable so the header never blocks or breaks.
 */

import { clearChildren, el } from '../utils/dom';
import type { TelemetryData } from '../core/telemetry';

export class TelemetryBadge {
  readonly element: HTMLElement;

  constructor() {
    this.element = el('div', {
      className: 'telemetry',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    this.renderOffline();
  }

  /** Render a telemetry snapshot, or the offline fallback when `null`. */
  render(data: TelemetryData | null): void {
    if (!data) {
      this.renderOffline();
      return;
    }

    clearChildren(this.element);
    this.element.appendChild(el('span', { className: 'telemetry__item', text: data.ip || '—' }));
    this.element.appendChild(el('span', { className: 'telemetry__item', text: data.location }));
    this.element.appendChild(
      el('span', {
        className: 'telemetry__item',
        text: `${data.weatherLabel} ${Math.round(data.temperature)}°C`,
      }),
    );
  }

  private renderOffline(): void {
    clearChildren(this.element);
    this.element.appendChild(
      el('span', {
        className: 'telemetry__item telemetry__item--muted',
        text: 'Offline',
      }),
    );
  }
}
