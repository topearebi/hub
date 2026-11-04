/**
 * Hub Settings Modal (G-42, DESIGN.md §6.12)
 * ------------------------------------------
 * Grouped into clearly-scoped sections — General, Sync, Notifications, Security,
 * Data, Install & updates and an Advanced disclosure — each with its own Save
 * button (never one ambiguous Save for everything). The GitHub token field never
 * re-displays a saved value: it shows "Token saved" with Replace / Remove and
 * carries scoped-token help text.
 *
 * The modal owns the form and delegates network/IO actions to callbacks so the
 * sync layer stays testable and decoupled.
 */

import { el, svg } from '../utils/dom';
import { confirmDialog, Dialog } from '../utils/dialog';
import { formatBytes } from '../core/pwa';
import type { AppConfig } from '../types/schemas';
import type { ConnectionResult, GitHubConfig } from '../core/sync';

const ICON_CLOSE = 'M18 6 6 18M6 6l12 12';
const ICON_CHEVRON = 'M6 9l6 6 6-6';

let settingsDialogSeq = 0;

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
  /** Encrypt a newly entered token, returning the `enc1:` envelope to persist. */
  encryptToken: (plaintext: string) => Promise<string>;
  /** Open the Recently deleted dialog (Data section). */
  onOpenRecentlyDeleted?: () => void;
  /** Open the category manager (Data section). */
  onOpenCategories?: () => void;
  /** Show platform install guidance (Install & updates section). */
  onInstall?: () => void;
  /** Request durable storage (Data section). */
  onRequestPersist?: () => Promise<void>;
  /** Read the current persistence state and storage quota estimate (Data section). */
  onRefreshStorage?: () => Promise<{ usage: number; quota: number } | null>;
}

/** Wrap an input in a labelled field. */
function field(labelText: string, input: HTMLElement, help?: string): HTMLElement {
  const label = el('label', { className: 'field' });
  label.appendChild(el('span', { className: 'field__label', text: labelText }));
  label.appendChild(input);
  if (help) {
    label.appendChild(el('span', { className: 'field__help', text: help }));
  }
  return label;
}

export class SettingsModal {
  readonly element: HTMLElement;

  private readonly dialog: Dialog;
  private readonly titleId: string;
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
  private readonly themeSelect: HTMLSelectElement;
  private readonly tokenStatus: HTMLElement;
  private readonly storageStatus: HTMLElement;
  private readonly quotaStatus: HTMLElement;
  private readonly advancedRegion: HTMLElement;
  private readonly advancedToggle: HTMLButtonElement;

  /** True when a token is already stored (the field must not re-display it). */
  private hasSavedToken = false;
  /** True when the user asked to replace the stored token. */
  private replacingToken = false;

  constructor(
    private readonly store: SettingsStore,
    private readonly callbacks: SettingsCallbacks,
  ) {
    settingsDialogSeq += 1;
    this.titleId = `settings-title-${settingsDialogSeq}`;
    this.dialog = new Dialog({
      labelledBy: this.titleId,
      onRequestClose: () => this.close(),
    });

    this.syncEnabled = el('input', { attrs: { type: 'checkbox' } });
    this.patInput = el('input', {
      attrs: {
        type: 'password',
        autocomplete: 'off',
        placeholder: 'ghp_…',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
      },
    });
    this.ownerInput = el('input', {
      attrs: {
        type: 'text',
        placeholder: 'username',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
      },
    });
    this.repoInput = el('input', {
      attrs: {
        type: 'text',
        placeholder: 'my-hub-config',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
      },
    });
    this.branchInput = el('input', {
      attrs: {
        type: 'text',
        placeholder: 'main',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
      },
    });
    this.pathInput = el('input', {
      attrs: {
        type: 'text',
        placeholder: '.hub/data.json',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
      },
    });
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

    this.themeSelect = el('select', { className: 'settings-select' });
    for (const [value, label] of [
      ['auto', 'Auto (follow system)'],
      ['light', 'Light'],
      ['dark', 'Dark'],
    ] as const) {
      this.themeSelect.appendChild(el('option', { text: label, attrs: { value } }));
    }

    this.tokenStatus = el('div', { className: 'settings-token-status' });
    this.storageStatus = el('p', { className: 'settings-status' });
    this.quotaStatus = el('p', { className: 'settings-status' });

    this.advancedRegion = el('div', { className: 'settings-advanced__region' });
    this.advancedRegion.hidden = true;
    this.advancedToggle = el('button', {
      className: 'settings-advanced__toggle',
      attrs: { type: 'button', 'aria-expanded': 'false' },
    });
    this.advancedToggle.appendChild(svg(ICON_CHEVRON, { size: 16 }));
    this.advancedToggle.appendChild(el('span', { text: 'Advanced' }));
    this.advancedToggle.addEventListener('click', () => this.toggleAdvanced());

    this.element = this.build();
  }

  /** Populate the form from config and reveal the modal. */
  open(): void {
    this.render();
    void this.refreshStorage();
    this.dialog.open();
  }

  close(): void {
    this.dialog.close();
    this.callbacks.onClose();
  }

  /** Open the modal and immediately trigger the import file picker. */
  triggerImport(): void {
    this.open();
    this.fileInput.click();
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

    const title = el('h2', {
      className: 'modal__title',
      attrs: { id: this.titleId },
      text: 'Settings',
    });
    const header = el('header', { className: 'modal__header', children: [title, closeButton] });

    const body = el('div', {
      className: 'modal__body',
      children: [
        this.buildGeneral(),
        this.buildSync(),
        this.buildNotifications(),
        this.buildSecurity(),
        this.buildData(),
        this.buildInstall(),
        this.buildAdvanced(),
      ],
    });

    this.dialog.content.appendChild(header);
    this.dialog.content.appendChild(body);
    return this.dialog.overlay;
  }

  private buildGeneral(): HTMLElement {
    const save = this.saveButton('Save general', () => {
      void this.handleSaveGeneral();
    });
    return this.section('General', [
      field('Theme', this.themeSelect),
      el('div', { className: 'settings-actions', children: [save] }),
    ]);
  }

  private buildSync(): HTMLElement {
    const testButton = el('button', {
      className: 'button',
      text: 'Test connection',
      attrs: { type: 'button' },
    });
    testButton.addEventListener('click', () => {
      void this.handleTest();
    });

    const saveButton = this.saveButton('Save sync settings', () => {
      void this.handleSaveSync();
    });

    const syncNowButton = el('button', {
      className: 'button',
      text: 'Sync now',
      attrs: { type: 'button' },
    });
    syncNowButton.addEventListener('click', () => this.callbacks.onSyncNow());

    const tokenHelp =
      'Needs Contents: read & write on the sync repository only. Hub stores it encrypted on this device.';

    return this.section('Sync (GitHub)', [
      field('Enable background sync', this.syncEnabled),
      this.tokenStatus,
      field('GitHub token (PAT)', this.patInput, tokenHelp),
      field('Repository owner', this.ownerInput),
      field('Repository name', this.repoInput),
      field('Branch', this.branchInput),
      field('File path', this.pathInput),
      el('div', {
        className: 'settings-actions',
        children: [testButton, saveButton, syncNowButton],
      }),
      this.statusEl,
    ]);
  }

  private buildNotifications(): HTMLElement {
    const save = this.saveButton('Save notifications', () => {
      void this.handleSaveNotifications();
    });
    return this.section('Notifications & reminders', [
      field('Local notifications & reminders', this.notificationsEnabled),
      el('div', { className: 'settings-actions', children: [save] }),
    ]);
  }

  private buildSecurity(): HTMLElement {
    return this.section('Security', [
      field('App lock (device screen lock / biometrics)', this.lockEnabled),
      el('div', { className: 'settings-actions', children: [this.lockButton] }),
    ]);
  }

  private buildData(): HTMLElement {
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

    const categoriesButton = el('button', {
      className: 'button',
      text: 'Manage categories',
      attrs: { type: 'button' },
    });
    categoriesButton.addEventListener('click', () => this.callbacks.onOpenCategories?.());

    const recentlyDeletedButton = el('button', {
      className: 'button',
      text: 'Recently deleted',
      attrs: { type: 'button' },
    });
    recentlyDeletedButton.addEventListener('click', () => this.callbacks.onOpenRecentlyDeleted?.());

    const persistButton = el('button', {
      className: 'button',
      text: 'Request persistent storage',
      attrs: { type: 'button' },
    });
    persistButton.addEventListener('click', () => {
      void this.handleRequestPersist();
    });

    return this.section('Data', [
      el('div', {
        className: 'settings-actions',
        children: [exportButton, importButton, this.fileInput],
      }),
      el('div', {
        className: 'settings-actions',
        children: [categoriesButton, recentlyDeletedButton],
      }),
      this.storageStatus,
      this.quotaStatus,
      el('div', { className: 'settings-actions', children: [persistButton] }),
    ]);
  }

  private buildInstall(): HTMLElement {
    const installButton = el('button', {
      className: 'button',
      text: 'Install Hub',
      attrs: { type: 'button' },
    });
    installButton.addEventListener('click', () => this.callbacks.onInstall?.());
    return this.section('Install & updates', [
      el('p', {
        className: 'settings-help',
        text: 'Install Hub for one-tap access and offline use.',
      }),
      el('div', { className: 'settings-actions', children: [installButton] }),
    ]);
  }

  private buildAdvanced(): HTMLElement {
    const save = this.saveButton('Save advanced', () => {
      void this.handleSaveAdvanced();
    });
    this.advancedRegion.appendChild(field('Web Push public key (VAPID)', this.vapidInput));
    this.advancedRegion.appendChild(field('Gamepad navigation', this.gamepadEnabled));
    this.advancedRegion.appendChild(el('div', { className: 'settings-actions', children: [save] }));
    return el('section', {
      className: 'settings-section settings-advanced',
      children: [this.advancedToggle, this.advancedRegion],
    });
  }

  private section(title: string, children: HTMLElement[]): HTMLElement {
    return el('section', {
      className: 'settings-section',
      children: [el('h3', { className: 'settings-section__title', text: title }), ...children],
    });
  }

  private saveButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = el('button', {
      className: 'button button--primary',
      text: label,
      attrs: { type: 'button' },
    });
    button.addEventListener('click', onClick);
    return button;
  }

  private toggleAdvanced(): void {
    const open = this.advancedRegion.hidden === true;
    this.advancedRegion.hidden = !open;
    this.advancedToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.advancedToggle.classList.toggle('is-open', open);
  }

  /* ---------------------------------------------------------------- */
  /* Behaviour                                                        */
  /* ---------------------------------------------------------------- */

  private render(): void {
    const config = this.store.appConfig;
    this.syncEnabled.checked = config.sync_enabled;
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
    this.themeSelect.value = config.theme;
    this.statusEl.textContent = '';
    this.statusEl.removeAttribute('data-tone');

    // The token field never re-displays a saved value (DESIGN.md §6.12).
    this.hasSavedToken = Boolean(config.github_pat);
    this.replacingToken = false;
    this.patInput.value = '';
    this.renderTokenStatus();

    this.storageStatus.textContent = config.storage_persisted
      ? 'Storage is persistent — your browser will not clear Hub’s data.'
      : 'Storage is not yet persistent. Your browser may clear Hub’s data when space is low.';
    this.quotaStatus.textContent = '';
  }

  /** Refresh the persistence state and quota estimate from the browser. */
  private async refreshStorage(): Promise<void> {
    if (!this.callbacks.onRefreshStorage) {
      return;
    }
    try {
      const estimate = await this.callbacks.onRefreshStorage();
      if (estimate) {
        this.setQuota(estimate.usage, estimate.quota);
      }
    } catch {
      // Quota is informational; failure is non-fatal.
    }
  }

  private renderTokenStatus(): void {
    this.tokenStatus.replaceChildren();
    if (!this.hasSavedToken || this.replacingToken) {
      this.tokenStatus.hidden = true;
      this.patInput.hidden = false;
      return;
    }
    this.tokenStatus.hidden = false;
    // Hide only the input; the label and scoped-token help stay visible.
    this.patInput.hidden = true;
    this.tokenStatus.appendChild(
      el('span', { className: 'settings-token-status__label', text: 'Token saved' }),
    );

    const replace = el('button', {
      className: 'button',
      text: 'Replace',
      attrs: { type: 'button' },
    });
    replace.addEventListener('click', () => {
      this.replacingToken = true;
      this.renderTokenStatus();
      this.patInput.focus();
    });

    const remove = el('button', {
      className: 'button button--danger',
      text: 'Remove',
      attrs: { type: 'button' },
    });
    remove.addEventListener('click', () => {
      void this.handleRemoveToken();
    });

    this.tokenStatus.appendChild(replace);
    this.tokenStatus.appendChild(remove);
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

  private async handleSaveGeneral(): Promise<void> {
    try {
      await this.store.updateConfig({ theme: this.themeSelect.value as AppConfig['theme'] });
      this.callbacks.onSaved();
      this.setStatus('General settings saved.', 'ok');
    } catch {
      this.setStatus('Could not save settings. Try again.', 'error');
    }
  }

  private async handleSaveSync(): Promise<void> {
    const gh = this.readConfig();
    try {
      const patch: Partial<AppConfig> = {
        sync_enabled: this.syncEnabled.checked,
        github_owner: gh.owner,
        github_repo: gh.repo,
        github_branch: gh.branch,
        github_file_path: gh.filePath,
      };
      // Only overwrite the token when the user entered a new one. The token is
      // encrypted before it is persisted (SCHEMAS.md §3.5); the plaintext never
      // reaches IndexedDB.
      if (gh.token.length > 0) {
        patch.github_pat = await this.callbacks.encryptToken(gh.token);
      }
      await this.store.updateConfig(patch);
      this.callbacks.onSaved();
      this.setStatus('Sync settings saved.', 'ok');
      this.render();
    } catch {
      this.setStatus('Could not save settings. Try again.', 'error');
    }
  }

  private async handleSaveNotifications(): Promise<void> {
    try {
      await this.store.updateConfig({ notifications_enabled: this.notificationsEnabled.checked });
      this.callbacks.onSaved();
      this.setStatus('Notification settings saved.', 'ok');
    } catch {
      this.setStatus('Could not save settings. Try again.', 'error');
    }
  }

  private async handleSaveAdvanced(): Promise<void> {
    try {
      await this.store.updateConfig({
        vapid_public_key: this.vapidInput.value.trim(),
        gamepad_enabled: this.gamepadEnabled.checked,
      });
      this.callbacks.onSaved();
      this.setStatus('Advanced settings saved.', 'ok');
    } catch {
      this.setStatus('Could not save settings. Try again.', 'error');
    }
  }

  private async handleRemoveToken(): Promise<void> {
    try {
      await this.store.updateConfig({ github_pat: '' });
      this.render();
      this.setStatus('Token removed.', 'ok');
    } catch {
      this.setStatus('Could not remove the token.', 'error');
    }
  }

  /** Request durable storage and reflect the result (G-52). */
  private async handleRequestPersist(): Promise<void> {
    if (!this.callbacks.onRequestPersist) {
      return;
    }
    this.setStatus('Requesting persistent storage…', 'pending');
    try {
      await this.callbacks.onRequestPersist();
      this.render();
      this.setStatus('Persistent storage requested.', 'ok');
    } catch {
      this.setStatus('Could not request persistent storage.', 'error');
    }
  }

  /** Show the current storage usage/quota estimate (G-52). */
  setQuota(usage: number, quota: number): void {
    this.quotaStatus.textContent =
      quota > 0
        ? `Using ${formatBytes(usage)} of ${formatBytes(quota)} available.`
        : `Using ${formatBytes(usage)}.`;
  }

  /** Enable an app lock (register credential) or disable and clear it. */
  private async handleLockToggle(): Promise<void> {
    try {
      if (this.store.appConfig.app_lock_enabled) {
        await this.callbacks.onDisableLock();
      } else {
        await this.callbacks.onRegisterLock();
      }
      this.render();
    } catch {
      this.setStatus('Could not update the app lock.', 'error');
    }
  }

  private async handleTest(): Promise<void> {
    const gh = this.readConfig();
    if (!gh.token || !gh.owner || !gh.repo) {
      this.setStatus('Enter a token, owner, and repository first.', 'error');
      return;
    }

    this.setStatus('Testing connection…', 'pending');
    try {
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
    } catch {
      this.setStatus('Connection test failed. Check your details.', 'error');
    }
  }

  private setStatus(message: string, tone: 'ok' | 'error' | 'pending'): void {
    this.statusEl.textContent = message;
    this.statusEl.setAttribute('data-tone', tone);
  }

  /** Show a nested confirmation dialog and resolve with the user's choice. */
  private confirm(message: string, confirmLabel: string): Promise<boolean> {
    return confirmDialog({ message, confirmLabel, nested: true });
  }
}
