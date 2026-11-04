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
import { t } from '../utils/i18n';
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
        placeholder: t('settings.placeholderPat'),
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
      },
    });
    this.ownerInput = el('input', {
      attrs: {
        type: 'text',
        placeholder: t('settings.placeholderOwner'),
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
      },
    });
    this.repoInput = el('input', {
      attrs: {
        type: 'text',
        placeholder: t('settings.placeholderRepo'),
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
      },
    });
    this.branchInput = el('input', {
      attrs: {
        type: 'text',
        placeholder: t('settings.placeholderBranch'),
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
      },
    });
    this.pathInput = el('input', {
      attrs: {
        type: 'text',
        placeholder: t('settings.placeholderPath'),
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
      attrs: { type: 'text', placeholder: t('settings.placeholderVapid'), autocomplete: 'off' },
    });
    this.gamepadEnabled = el('input', { attrs: { type: 'checkbox' } });
    this.lockEnabled = el('input', { attrs: { type: 'checkbox' } });
    this.lockEnabled.disabled = true;
    this.lockButton = el('button', {
      className: 'button',
      text: t('settings.registerLock'),
      attrs: { type: 'button' },
    });
    this.lockButton.addEventListener('click', () => {
      void this.handleLockToggle();
    });

    this.themeSelect = el('select', { className: 'settings-select' });
    for (const value of ['auto', 'light', 'dark'] as const) {
      this.themeSelect.appendChild(el('option', { text: t(`theme.${value}`), attrs: { value } }));
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
    this.advancedToggle.appendChild(el('span', { text: t('settings.advanced') }));
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
      attrs: { type: 'button', 'aria-label': t('settings.closeAria') },
    });
    closeButton.appendChild(svg(ICON_CLOSE));
    closeButton.addEventListener('click', () => this.close());

    const title = el('h2', {
      className: 'modal__title',
      attrs: { id: this.titleId },
      text: t('settings.heading'),
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
    const save = this.saveButton(t('settings.saveGeneral'), () => {
      void this.handleSaveGeneral();
    });
    return this.section(t('settings.general'), [
      field(t('settings.theme'), this.themeSelect),
      el('div', { className: 'settings-actions', children: [save] }),
    ]);
  }

  private buildSync(): HTMLElement {
    const testButton = el('button', {
      className: 'button',
      text: t('settings.testConnection'),
      attrs: { type: 'button' },
    });
    testButton.addEventListener('click', () => {
      void this.handleTest();
    });

    const saveButton = this.saveButton(t('settings.saveSync'), () => {
      void this.handleSaveSync();
    });

    const syncNowButton = el('button', {
      className: 'button',
      text: t('settings.syncNow'),
      attrs: { type: 'button' },
    });
    syncNowButton.addEventListener('click', () => this.callbacks.onSyncNow());

    return this.section(t('settings.sync'), [
      field(t('settings.enableSync'), this.syncEnabled),
      this.tokenStatus,
      field(t('settings.pat'), this.patInput, t('settings.tokenHelp')),
      field(t('settings.owner'), this.ownerInput),
      field(t('settings.repo'), this.repoInput),
      field(t('settings.branch'), this.branchInput),
      field(t('settings.filePath'), this.pathInput),
      el('div', {
        className: 'settings-actions',
        children: [testButton, saveButton, syncNowButton],
      }),
      this.statusEl,
    ]);
  }

  private buildNotifications(): HTMLElement {
    const save = this.saveButton(t('settings.saveNotifications'), () => {
      void this.handleSaveNotifications();
    });
    return this.section(t('settings.notifications'), [
      field(t('settings.localNotifications'), this.notificationsEnabled),
      el('div', { className: 'settings-actions', children: [save] }),
    ]);
  }

  private buildSecurity(): HTMLElement {
    return this.section(t('settings.security'), [
      field(t('settings.appLock'), this.lockEnabled),
      el('div', { className: 'settings-actions', children: [this.lockButton] }),
    ]);
  }

  private buildData(): HTMLElement {
    const exportButton = el('button', {
      className: 'button',
      text: t('settings.exportJson'),
      attrs: { type: 'button' },
    });
    exportButton.addEventListener('click', () => this.callbacks.onExport());

    const importButton = el('button', {
      className: 'button',
      text: t('settings.importJson'),
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
      text: t('settings.manageCategories'),
      attrs: { type: 'button' },
    });
    categoriesButton.addEventListener('click', () => this.callbacks.onOpenCategories?.());

    const recentlyDeletedButton = el('button', {
      className: 'button',
      text: t('settings.recentlyDeleted'),
      attrs: { type: 'button' },
    });
    recentlyDeletedButton.addEventListener('click', () => this.callbacks.onOpenRecentlyDeleted?.());

    const persistButton = el('button', {
      className: 'button',
      text: t('settings.requestPersist'),
      attrs: { type: 'button' },
    });
    persistButton.addEventListener('click', () => {
      void this.handleRequestPersist();
    });

    return this.section(t('settings.data'), [
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
      text: t('settings.installHub'),
      attrs: { type: 'button' },
    });
    installButton.addEventListener('click', () => this.callbacks.onInstall?.());
    return this.section(t('settings.install'), [
      el('p', {
        className: 'settings-help',
        text: t('settings.installHelp'),
      }),
      el('div', { className: 'settings-actions', children: [installButton] }),
    ]);
  }

  private buildAdvanced(): HTMLElement {
    const save = this.saveButton(t('settings.saveAdvanced'), () => {
      void this.handleSaveAdvanced();
    });
    this.advancedRegion.appendChild(field(t('settings.vapid'), this.vapidInput));
    this.advancedRegion.appendChild(field(t('settings.gamepad'), this.gamepadEnabled));
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
      ? t('settings.reregisterLock')
      : t('settings.registerLock');
    this.themeSelect.value = config.theme;
    this.statusEl.textContent = '';
    this.statusEl.removeAttribute('data-tone');

    // The token field never re-displays a saved value (DESIGN.md §6.12).
    this.hasSavedToken = Boolean(config.github_pat);
    this.replacingToken = false;
    this.patInput.value = '';
    this.renderTokenStatus();

    this.storageStatus.textContent = config.storage_persisted
      ? t('settings.storagePersistent')
      : t('settings.storageNotPersistent');
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
      el('span', { className: 'settings-token-status__label', text: t('settings.tokenSaved') }),
    );

    const replace = el('button', {
      className: 'button',
      text: t('common.replace'),
      attrs: { type: 'button' },
    });
    replace.addEventListener('click', () => {
      this.replacingToken = true;
      this.renderTokenStatus();
      this.patInput.focus();
    });

    const remove = el('button', {
      className: 'button button--danger',
      text: t('common.remove'),
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
      this.setStatus(t('settings.generalSaved'), 'ok');
    } catch {
      this.setStatus(t('settings.saveFailed'), 'error');
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
      this.setStatus(t('settings.syncSaved'), 'ok');
      this.render();
    } catch {
      this.setStatus(t('settings.saveFailed'), 'error');
    }
  }

  private async handleSaveNotifications(): Promise<void> {
    try {
      await this.store.updateConfig({ notifications_enabled: this.notificationsEnabled.checked });
      this.callbacks.onSaved();
      this.setStatus(t('settings.notificationsSaved'), 'ok');
    } catch {
      this.setStatus(t('settings.saveFailed'), 'error');
    }
  }

  private async handleSaveAdvanced(): Promise<void> {
    try {
      await this.store.updateConfig({
        vapid_public_key: this.vapidInput.value.trim(),
        gamepad_enabled: this.gamepadEnabled.checked,
      });
      this.callbacks.onSaved();
      this.setStatus(t('settings.advancedSaved'), 'ok');
    } catch {
      this.setStatus(t('settings.saveFailed'), 'error');
    }
  }

  private async handleRemoveToken(): Promise<void> {
    try {
      await this.store.updateConfig({ github_pat: '' });
      this.render();
      this.setStatus(t('settings.tokenRemoved'), 'ok');
    } catch {
      this.setStatus(t('settings.tokenRemoveFailed'), 'error');
    }
  }

  /** Request durable storage and reflect the result (G-52). */
  private async handleRequestPersist(): Promise<void> {
    if (!this.callbacks.onRequestPersist) {
      return;
    }
    this.setStatus(t('settings.requestingPersist'), 'pending');
    try {
      await this.callbacks.onRequestPersist();
      this.render();
      this.setStatus(t('settings.persistRequested'), 'ok');
    } catch {
      this.setStatus(t('settings.persistFailed'), 'error');
    }
  }

  /** Show the current storage usage/quota estimate (G-52). */
  setQuota(usage: number, quota: number): void {
    this.quotaStatus.textContent =
      quota > 0
        ? t('settings.quota', { usage: formatBytes(usage), quota: formatBytes(quota) })
        : t('settings.quotaNoTotal', { usage: formatBytes(usage) });
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
      this.setStatus(t('settings.lockFailed'), 'error');
    }
  }

  private async handleTest(): Promise<void> {
    const gh = this.readConfig();
    if (!gh.token || !gh.owner || !gh.repo) {
      this.setStatus(t('settings.enterDetails'), 'error');
      return;
    }

    this.setStatus(t('settings.testing'), 'pending');
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
        t('settings.confirmInit'),
        t('settings.confirmInitLabel'),
      );
      if (!confirmed) {
        return;
      }

      this.setStatus(t('settings.initRemote'), 'pending');
      await this.callbacks.onInitialize(gh);
      this.setStatus(t('settings.remoteInitialized'), 'ok');
    } catch {
      this.setStatus(t('settings.testFailed'), 'error');
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
