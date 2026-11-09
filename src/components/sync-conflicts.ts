import { getSyncMetadata, getAll } from '../core/db';
import { refreshConflictLocal, resolveSyncConflict } from '../core/sync-conflicts';
import { canonical } from '../core/sync-merge';
import type { SyncConflict } from '../core/sync-merge';
import type { AppConfig, HubStoragePayload } from '../types/schemas';
import { targetKey, toGitHubConfig } from '../core/sync';
import { Dialog } from '../utils/dialog';
import { btn, el } from '../utils/dom';
import { t } from '../utils/i18n';
import { showToast } from './toast';

interface ConflictStore {
  readonly appConfig: AppConfig;
  getPayload(): HubStoragePayload;
  applyPayload(payload: HubStoragePayload, before?: HubStoragePayload): Promise<void>;
}
/** All conflict versions remain local until a user explicitly chooses one. */
export async function openConflictInbox(
  store: ConflictStore,
  onResolved: () => void,
): Promise<void> {
  const target = targetKey(toGitHubConfig(store.appConfig, ''));
  let conflicts: SyncConflict[] = [];
  const dialog = new Dialog({
    label: t('sync.review'),
    onRequestClose: () => dialog.destroy(),
    sheet: true,
  });
  const body = el('div', { className: 'modal__body', attrs: { tabindex: '-1' } });
  dialog.content.append(
    el('div', {
      className: 'modal__header',
      children: [
        el('h2', { text: t('sync.review'), className: 'modal__title' }),
        btn(t('common.close'), { onClick: () => dialog.destroy() }),
      ],
    }),
    body,
  );
  const render = async (): Promise<void> => {
    const metadata = await getSyncMetadata();
    conflicts = metadata?.targets?.[target]?.conflicts ?? [];
    body.replaceChildren(
      el('p', { text: conflicts.length ? t('sync.conflictHelp') : t('sync.noConflicts') }),
    );
    for (const saved of conflicts) {
      const conflict = await refreshConflictLocal(target, saved);
      if (!conflict) continue;
      const panel = el('section', { className: 'sync-conflict' });
      panel.append(
        el('h3', { text: `${t(`sync.collection.${conflict.collection}`)} · ${conflict.id}` }),
      );
      const choose = async (choice: 'local' | 'remote'): Promise<void> => {
        const buttons = panel.querySelectorAll('button');
        buttons.forEach((button) => {
          button.disabled = true;
        });
        try {
          const before = store.getPayload();
          if (
            canonical(before[conflict.collection].find((item) => item.id === conflict.id)) !==
            canonical(conflict.local)
          )
            throw new Error('changed');
          await resolveSyncConflict(target, conflict, choice);
          const records = await getAll<SyncConflict['local']>(conflict.collection);
          const selected = records.find((item) => item.id === conflict.id)!;
          const incoming = {
            ...before,
            [conflict.collection]: [
              ...before[conflict.collection].filter((item) => item.id !== conflict.id),
              selected,
            ],
          };
          await store.applyPayload(incoming, before);
          await render();
          body.focus();
          if (!conflicts.length) onResolved();
        } catch {
          showToast(t('sync.changedConflict'), { variant: 'error' });
        } finally {
          buttons.forEach((button) => {
            button.disabled = false;
          });
        }
      };
      for (const side of ['local', 'remote'] as const) {
        panel.append(
          el('h4', { text: t(`sync.${side}`) }),
          el('pre', {
            className: 'sync-conflict__version',
            text: JSON.stringify(conflict[side], null, 2),
            attrs: { tabindex: '0', role: 'region', 'aria-label': t(`sync.${side}`) },
          }),
          btn(t(`sync.choose.${side}`), { onClick: () => void choose(side) }),
        );
      }
      panel.append(
        btn(t('sync.exportConflict'), {
          onClick: () => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(conflict, null, 2)], { type: 'application/json' }),
            );
            const link = el('a', { attrs: { href: url, download: 'hub-conflict.json' } });
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
        }),
      );
      body.appendChild(panel);
    }
  };
  await render();
  dialog.open();
}
