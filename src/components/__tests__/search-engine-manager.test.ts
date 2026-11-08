import { describe, expect, it, vi } from 'vitest';

import { SearchEngineManager, validateSearchProvider } from '../search-engine-manager';
import type { AppConfig, SearchProvider } from '../../types/schemas';
import { DEFAULT_APP_CONFIG } from '../../types/schemas';

const SAMPLE_PROVIDERS: SearchProvider[] = [
  {
    id: 'sp_ddg',
    name: 'DuckDuckGo',
    query_url: 'https://duckduckgo.com/?q=%s',
    is_default: true,
    icon: 'duckduckgo',
  },
  {
    id: 'sp_google',
    name: 'Google',
    query_url: 'https://www.google.com/search?q=%s',
    is_default: false,
    icon: 'google',
  },
];

describe('validateSearchProvider', () => {
  it('rejects an empty name', () => {
    const res = validateSearchProvider('  ', 'https://example.com/search?q=%s');
    expect(res.valid).toBe(false);
    expect(res.errorKey).toBe('searchEngines.nameRequired');
  });

  it('rejects query URL missing %s', () => {
    const res = validateSearchProvider('Test', 'https://example.com/search?q=123');
    expect(res.valid).toBe(false);
    expect(res.errorKey).toBe('searchEngines.queryUrlInvalid');
  });

  it('rejects invalid URL or blocked scheme', () => {
    const res = validateSearchProvider('Test', 'javascript:alert(%s)');
    expect(res.valid).toBe(false);
    expect(res.errorKey).toBe('searchEngines.queryUrlInvalid');
  });

  it('accepts valid https URL containing %s', () => {
    const res = validateSearchProvider(
      'YouTube',
      'https://www.youtube.com/results?search_query=%s',
    );
    expect(res.valid).toBe(true);
    expect(res.errorKey).toBeUndefined();
  });
});

describe('SearchEngineManager Component', () => {
  function makeStore(providers: SearchProvider[] = SAMPLE_PROVIDERS) {
    let currentConfig: AppConfig = {
      ...DEFAULT_APP_CONFIG,
      search_providers: [...providers],
    };

    return {
      get appConfig() {
        return currentConfig;
      },
      updateConfig: vi.fn(async (patch: Partial<AppConfig>) => {
        currentConfig = { ...currentConfig, ...patch };
        return currentConfig;
      }),
    };
  }

  it('renders list of search engines with default badge', () => {
    const store = makeStore();
    const manager = new SearchEngineManager(store);
    document.body.appendChild(manager.element);
    manager.open();

    const rows = manager.element.querySelectorAll('.search-engine-row');
    expect(rows.length).toBe(2);

    const firstRow = rows[0]!;
    expect(firstRow.textContent).toContain('DuckDuckGo');
    expect(firstRow.querySelector('.search-engine-row__badge')).not.toBeNull();
    // Default engine shouldn't have a "Make default" button
    expect(firstRow.querySelector('.search-engine-row__default-btn')).toBeNull();

    const secondRow = rows[1]!;
    expect(secondRow.textContent).toContain('Google');
    expect(secondRow.querySelector('.search-engine-row__default-btn')).not.toBeNull();

    manager.destroy();
  });

  it('updates default engine when clicking Make default', async () => {
    const store = makeStore();
    let changed = false;
    const manager = new SearchEngineManager(store, {
      onChanged: () => {
        changed = true;
      },
    });
    document.body.appendChild(manager.element);
    manager.open();

    const makeDefaultBtn = manager.element.querySelector<HTMLButtonElement>(
      '.search-engine-row__default-btn',
    );
    expect(makeDefaultBtn).not.toBeNull();
    makeDefaultBtn?.click();

    await Promise.resolve();

    expect(store.updateConfig).toHaveBeenCalled();
    const updated = store.appConfig.search_providers;
    expect(updated.find((p) => p.id === 'sp_google')?.is_default).toBe(true);
    expect(updated.find((p) => p.id === 'sp_ddg')?.is_default).toBe(false);
    expect(changed).toBe(true);

    manager.destroy();
  });

  it('adds a new search engine via preset', async () => {
    const store = makeStore();
    const manager = new SearchEngineManager(store);
    document.body.appendChild(manager.element);
    manager.open();

    const addBtn = manager.element.querySelector<HTMLButtonElement>(
      '.search-engine-manager__add-btn',
    );
    addBtn?.click();

    const presetSelect = manager.element.querySelector<HTMLSelectElement>(
      'select[aria-label="Preset"]',
    );
    expect(presetSelect).not.toBeNull();

    if (presetSelect) {
      presetSelect.value = 'youtube';
      presetSelect.dispatchEvent(new Event('change'));
    }

    const nameInput = manager.element.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    const urlInput = manager.element.querySelector<HTMLInputElement>(
      'input[aria-label="Query URL"]',
    )!;

    expect(nameInput.value).toBe('YouTube');
    expect(urlInput.value).toContain('%s');

    const saveBtn = Array.from(manager.element.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === 'Save',
    );
    saveBtn?.click();

    await Promise.resolve();

    expect(store.updateConfig).toHaveBeenCalled();
    expect(store.appConfig.search_providers.length).toBe(3);
    const added = store.appConfig.search_providers.find((p) => p.name === 'YouTube');
    expect(added).not.toBeUndefined();
    expect(added?.icon).toBe('youtube');

    manager.destroy();
  });

  it('disables delete button when only 1 search engine exists', () => {
    const store = makeStore([SAMPLE_PROVIDERS[0]!]);
    const manager = new SearchEngineManager(store);
    document.body.appendChild(manager.element);
    manager.open();

    const deleteBtn = manager.element.querySelector<HTMLButtonElement>(
      'button[aria-label^="Delete"]',
    );
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn?.disabled).toBe(true);

    manager.destroy();
  });
});
