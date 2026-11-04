/**
 * Hub Brand Area
 * --------------
 * The centered branding above the search pill. Renders the active profile's
 * custom logo when configured, otherwise its custom Hub title, otherwise a
 * sensible fallback.
 */

import { clearChildren, el } from '../utils/dom';
import { t } from '../utils/i18n';
import type { ProfileItem } from '../types/schemas';

export class Brand {
  readonly element: HTMLElement;

  constructor() {
    this.element = el('div', { className: 'brand-area' });
  }

  /** Re-render for the given profile (or the fallback when none). */
  render(profile: ProfileItem | null): void {
    clearChildren(this.element);

    if (profile?.logo) {
      this.element.appendChild(
        el('img', {
          className: 'brand-area__logo',
          attrs: { src: profile.logo, alt: profile.name || t('brand.fallback') },
        }),
      );
      return;
    }

    const title = profile?.hub_title?.trim() || profile?.name?.trim() || t('brand.fallback');
    this.element.appendChild(el('h1', { className: 'brand-area__title', text: title }));
  }
}
