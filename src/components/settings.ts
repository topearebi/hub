/**
 * Hub Settings Modal
 * ------------------
 * BYOS configuration, connection testing, and manual JSON portability
 * (PRD §5.4). The modal owns the form and delegates network/IO actions to
 * callbacks so the sync layer stays testable and decoupled.
 */

import { el, svg } from '../utils/dom';
import type { AppConfig } from '../types/schemas';
import type { ConnectionResult, GitHubConfig } from '../core/sync';

const ICON_CLOSE = 'M18 6 6 18M6 6l12 12';

export interface SettingsStore {
  readonly appConfig: AppConfig;
  updateConfig(patch: Partial<AppConfig>): Promise<AppConfig>;
}

export interface SettingsCallbacks {
  onClose: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onTestConnection: (config: GitHubConfig) => Promise<ConnectionResult>;
  onCheckFile: (config: GitHubConfig) => Promise<boolean>;
  onInitialize: (config: GitHubConfig) => Promise<void>;
  /** Invoked after settings are persisted (used to trigger a sync pull). */
  onSaved: () => void;
  /** Invoked by the "Sync now" control to pull remote changes on demand. */
  onSyncNow: () => void;
  /** Register a WebAuthn platform credential to enable the app lock. */
  onRegisterLock: () => Promise<void>;
  /** Disable the app lock and clear its credential. */
  onDisableLock: () => Promise<void>;
}

/** Wrap an input in a labelled field. */
function field(labelText: string, input: HTMLElement): HTMLElement {
  const label = el('label', { className: 'field' });
  label.appendChild(el('span', { className: 'field__label', text: labelText }));
  label.appendChild(input);
  return label;
}

export class SettingsModal {
  readonly element: HTMLElement;

  private readonly syncEnabled: HTMLInputElement;
  private readonly patInput: HTMLInputElement;
  private readonly ownerInput: HTMLInputElement;
  private readonly repoInput: HTMLInputElement;
  private readonly branchInput: HTMLInputElement;
  private readonly pathInput: HTMLInputElement;
  private readonly statusEl: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly notificationsEnabled: HTMLInputElement;
  private readonly vapidInput: HTMLInputElement;
  private readonly gamepadEnabled: HTMLInputElement;
  private readonly lockEnabled: HTMLInputElement;
  private readonly lockButton: HTMLButtonElement;

  constructor(
    private readonly store: SettingsStore,
    private readonly callbacks: SettingsCallbacks,
  ) {
    this.syncEnabled = el('input', { attrs: { type: 'checkbox' } });
    this.patInput = el('input', {
      attrs: { type: 'password', autocomplete: 'off', placeholder: 'ghp_…' },
    });
    this.ownerInput = el('input', { attrs: { type: 'text', placeholder: 'username' } });
    this.repoInput = el('input', { attrs: { type: 'text', placeholder: 'my-hub-config' } });
    this.branchInput = el('input', { attrs: { type: 'text', placeholder: 'main' } });
    this.pathInput = el('input', { attrs: { type: 'text', placeholder: '.hub/data.json' } });
    this.statusEl = el('p', {
      className: 'settings-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    this.fileInput = el('input', { attrs: { type: 'file', accept: 'application/json' } });
    this.fileInput.hidden = true;

    this.notificationsEnabled = el('input', { attrs: { type: 'checkbox' } });
    this.vapidInput = el('input', {
      attrs: { type: 'text', placeholder: 'BEl62i…', autocomplete: 'off' },
    });
    this.gamepadEnabled = el('input', { attrs: { type: 'checkbox' } });
    this.lockEnabled = el('input', { attrs: { type: 'checkbox' } });
    this.lockEnabled.disabled = true;
    this.lockButton = el('button', {
      className: 'button',
      text: 'Register app lock',
      attrs: { type: 'button' },
    });
    this.lockButton.addEventListener('click', () => {
      void this.handleLockToggle();
    });

    this.element = this.build();
  }

  /** Populate the form from config and reveal the modal. */
  open(): void {
    this.render();
    this.element.classList.add('is-open');
    this.patInput.focus();
  }

  close(): void {
    this.element.classList.remove('is-open');
    this.callbacks.onClose();
  }

  /* ---------------------------------------------------------------- */
  /* DOM construction                                                 */
  /* ---------------------------------------------------------------- */

  private build(): HTMLElement {
    const closeButton = el('button', {
      className: 'icon-button modal__close',
      attrs: { type: 'button', 'aria-label': 'Close settings' },
    });
    closeButton.appendChild(svg(ICON_CLOSE));
    closeButton.addEventListener('click', () => this.close());

    const title = el('h2', { className: 'modal__title', text: 'Settings' });
    const header = el('header', { className: 'modal__header', children: [title, closeButton] });

    const testButton = el('button', {
      className: 'button',
      text: 'Test connection',
      attrs: { type: 'button' },
    });
    testButton.addEventListener('click', () => {
      void this.handleTest();
    });

    const saveButton = el('button', {
      className: 'button button--primary',
      text: 'Save',
      attrs: { type: 'button' },
    });
    saveButton.addEventListener('click', () => {
      void this.handleSave();
    });

    const syncNowButton = el('button', {
      className: 'button',
      text: 'Sync now',
      attrs: { type: 'button' },
    });
    syncNowButton.addEventListener('click', () => this.callbacks.onSyncNow());

    const syncActions = el('div', {
      className: 'settings-actions',
      children: [testButton, saveButton, syncNowButton],
    });

    const syncSection = el('section', {
      className: 'settings-section',
      children: [
        el('h3', { className: 'settings-section__title', text: 'Sync (BYOS)' }),
        field('Enable background sync', this.syncEnabled),
        field('GitHub token (PAT)', this.patInput),
        field('Repository owner', this.ownerInput),
        field('Repository name', this.repoInput),
        field('Branch', this.branchInput),
        field('File path', this.pathInput),
        syncActions,
        this.statusEl,
      ],
    });

    const exportButton = el('button', {
      className: 'button',
      text: 'Export JSON',
      attrs: { type: 'button' },
    });
    exportButton.addEventListener('click', () => this.callbacks.onExport());

    const importButton = el('button', {
      className: 'button',
      text: 'Import JSON',
      attrs: { type: 'button' },
    });
    importButton.addEventListener('click', () => this.fileInput.click());

    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) {
        this.callbacks.onImport(file);
      }
      this.fileInput.value = '';
    });

    const portabilityActions = el('div', {
      className: 'settings-actions',
      children: [exportButton, importButton, this.fileInput],
    });

    const portabilitySection = el('section', {
      className: 'settings-section',
      children: [
        el('h3', { className: 'settings-section__title', text: 'Data portability' }),
        portabilityActions,
      ],
    });

    const appSection = el('section', {
      className: 'settings-section',
      children: [
        el('h3', { className: 'settings-section__title', text: 'App features' }),
        field('Local notifications & reminders', this.notificationsEnabled),
        field('Web Push public key (VAPID)', this.vapidInput),
        field('Gamepad navigation', this.gamepadEnabled),
        field('App lock (device screen lock / biometrics)', this.lockEnabled),
        el('div', { className: 'settings-actions', children: [this.lockButton] }),
      ],
    });

    const body = el('div', {
      className: 'modal__body',
      children: [syncSection, appSection, portabilitySection],
    });

    const dialog = el('div', {
      className: 'modal',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
      children: [header, body],
    });

    const overlay = el('div', { className: 'modal-overlay', children: [dialog] });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        this.close();
      }
    });

    return overlay;
  }

  /* ---------------------------------------------------------------- */
  /* Behaviour                                                        */
  /* ---------------------------------------------------------------- */

  private render(): void {
    const config = this.store.appConfig;
    this.syncEnabled.checked = config.sync_enabled;
    this.patInput.value = config.github_pat ?? '';
    this.ownerInput.value = config.github_owner ?? '';
    this.repoInput.value = config.github_repo ?? '';
    this.branchInput.value = config.github_branch;
    this.pathInput.value = config.github_file_path;
    this.notificationsEnabled.checked = config.notifications_enabled;
    this.vapidInput.value = config.vapid_public_key ?? '';
    this.gamepadEnabled.checked = config.gamepad_enabled;
    this.lockEnabled.checked = config.app_lock_enabled;
    this.lockButton.textContent = config.app_lock_enabled
      ? 'Re-register app lock'
      : 'Register app lock';
    this.statusEl.textContent = '';
    this.statusEl.removeAttribute('data-tone');
  }

  private readConfig(): GitHubConfig {
    return {
      token: this.patInput.value.trim(),
      owner: this.ownerInput.value.trim(),
      repo: this.repoInput.value.trim(),
      branch: this.branchInput.value.trim() || 'main',
      filePath: this.pathInput.value.trim() || '.hub/data.json',
    };
  }

  private async handleSave(): Promise<void> {
    const gh = this.readConfig();
    await this.store.updateConfig({
      sync_enabled: this.syncEnabled.checked,
      github_pat: gh.token,
      github_owner: gh.owner,
      github_repo: gh.repo,
      github_branch: gh.branch,
      github_file_path: gh.filePath,
      notifications_enabled: this.notificationsEnabled.checked,
      vapid_public_key: this.vapidInput.value.trim(),
      gamepad_enabled: this.gamepadEnabled.checked,
    });
    // Let the host pull remote data and re-evaluate feature toggles.
    this.callbacks.onSaved();
    this.setStatus('Settings saved.', 'ok');
  }

  /** Enable an app lock (register credential) or disable and clear it. */
  private async handleLockToggle(): Promise<void> {
    if (this.store.appConfig.app_lock_enabled) {
      await this.callbacks.onDisableLock();
    } else {
      await this.callbacks.onRegisterLock();
    }
    this.render();
  }

  private async handleTest(): Promise<void> {
    const gh = this.readConfig();
    if (!gh.token || !gh.owner || !gh.repo) {
      this.setStatus('Enter a token, owner, and repository first.', 'error');
      return;
    }

    this.setStatus('Testing connection…', 'pending');
    const result = await this.callbacks.onTestConnection(gh);
    this.setStatus(result.message, result.ok && result.canWrite ? 'ok' : 'error');
    if (!result.ok || !result.canWrite) {
      return;
    }

    const exists = await this.callbacks.onCheckFile(gh);
    if (exists) {
      return;
    }

    const confirmed = await this.confirm(
      'Target file not found in the remote repository. Do you want Hub to initialize it with your current local data?',
      'Confirm & Initialize',
    );
    if (!confirmed) {
      return;
    }

    this.setStatus('Initializing remote file…', 'pending');
    await this.callbacks.onInitialize(gh);
    this.setStatus('Remote file initialized.', 'ok');
  }

  private setStatus(message: string, tone: 'ok' | 'error' | 'pending'): void {
    this.statusEl.textContent = message;
    this.statusEl.setAttribute('data-tone', tone);
  }

  /** Show a nested confirmation dialog and resolve with the user's choice. */
  private confirm(message: string, confirmLabel: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const text = el('p', { className: 'modal__message', text: message });

      const cancelButton = el('button', {
        className: 'button',
        text: 'Cancel',
        attrs: { type: 'button' },
      });
      const confirmButton = el('button', {
        className: 'button button--primary',
        text: confirmLabel,
        attrs: { type: 'button' },
      });
      const actions = el('div', {
        className: 'modal__actions',
        children: [cancelButton, confirmButton],
      });

      const dialog = el('div', { className: 'modal modal--sm', children: [text, actions] });
      const overlay = el('div', {
        className: 'modal-overlay modal-overlay--nested',
        attrs: { role: 'alertdialog', 'aria-modal': 'true' },
        children: [dialog],
      });
      document.body.appendChild(overlay);

      const finish = (value: boolean): void => {
        overlay.remove();
        resolve(value);
      };
      cancelButton.addEventListener('click', () => finish(false));
      confirmButton.addEventListener('click', () => finish(true));
    });
  }
}
