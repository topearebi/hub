import { describe, expect, it } from 'vitest';

import { ProfileEditor } from '../profile-editor';
import { DEFAULT_APP_CONFIG } from '../../types/schemas';
import type { ProfileItem } from '../../types/schemas';

describe('ProfileEditor', () => {
  it('clears an existing avatar via the Remove control', async () => {
    const profile: ProfileItem = {
      id: 'p1',
      created_at: 1,
      updated_at: 1,
      name: 'Me',
      avatar: 'data:image/png;base64,AAAA',
    };
    const captured: { patch?: Partial<ProfileItem> } = {};
    const editor = new ProfileEditor(
      { activeProfile: profile, appConfig: DEFAULT_APP_CONFIG },
      {
        onSave: (patch) => {
          captured.patch = patch;
        },
        onDelete: () => undefined,
      },
    );
    document.body.appendChild(editor.element);
    editor.open();

    const removeButton = editor.element.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove avatar"]',
    );
    expect(removeButton).not.toBeNull();
    expect(removeButton?.hidden).toBe(false);
    removeButton?.click();

    const saveButton = Array.from(editor.element.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save',
    );
    saveButton?.click();
    await Promise.resolve();

    // An empty string clears the stored avatar (falsy => fallback rendering).
    expect(captured.patch?.avatar).toBe('');
  });
});
