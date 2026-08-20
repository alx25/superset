/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import {
  type ChangeEvent,
  type FC,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { t } from '@apache-superset/core/translation';
import { styled } from '@apache-superset/core/theme';
import { SupersetClient, type DataMaskStateWithId } from '@superset-ui/core';
import {
  Button,
  EmptyState,
  Input,
  Loading,
  Popconfirm,
  type InputRef,
} from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import { Modal } from '@superset-ui/core/components/Modal';
import { type RootState } from 'src/dashboard/types';
import { updateDataMask, clearDataMask } from 'src/dataMask/actions';
import { setActiveTabs } from 'src/dashboard/actions/dashboardState';

// ── Types ────────────────────────────────────────────────────────────────────

type Bookmark = {
  id: string;
  name: string;
  permalink: string;
  dashboard_id: string;
  dashboard_title: string;
};

type SavedFilterState = {
  filterState?: { value?: unknown };
  extraFormData?: Record<string, unknown>;
  ownState?: Record<string, unknown>;
};

type PermalinkPayload = {
  state?: {
    dataMask?: Record<string, SavedFilterState>;
    activeTabs?: string[];
  };
};

type CachedEntry = {
  payload: PermalinkPayload;
  details: FilterDetail[];
};

type FilterDetail = {
  filterId: string;
  label: string;
  value: unknown;
};

// ── Styled components ────────────────────────────────────────────────────────

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.sizeUnit * 3}px;
  padding: ${({ theme }) => theme.sizeUnit * 4}px;
  padding-bottom: ${({ theme }) => theme.sizeUnit * 27}px;
`;

const BookmarkList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
`;

const BookmarkCard = styled.div`
  border: 1px solid ${({ theme }) => theme.colorBorder};
  border-radius: ${({ theme }) => theme.borderRadius}px;
  overflow: hidden;
`;

const BookmarkHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
  padding: ${({ theme }) => theme.sizeUnit * 2}px
    ${({ theme }) => theme.sizeUnit * 3}px;
  background: ${({ theme }) => theme.colorBgContainer};
`;

const BookmarkNameButton = styled.button`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: ${({ theme }) => theme.fontSizeSM}px;
  font-weight: ${({ theme }) => theme.fontWeightStrong};
  color: ${({ theme }) => theme.colorPrimary};
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
  &:hover {
    color: ${({ theme }) => theme.colorPrimaryHover};
    text-decoration: underline;
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
    text-decoration: none;
  }
`;

const BookmarkActions = styled.div`
  display: flex;
  align-items: center;
  flex-shrink: 0;
`;

const DetailsToggle = styled.button<{ $open: boolean }>`
  width: 100%;
  border: none;
  border-top: 1px solid ${({ theme }) => theme.colorBorder};
  background: ${({ theme }) => theme.colorBgLayout};
  padding: ${({ theme }) => theme.sizeUnit * 1.5}px
    ${({ theme }) => theme.sizeUnit * 3}px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeUnit}px;
  font-size: ${({ theme }) => theme.fontSizeSM}px;
  color: ${({ theme }) => theme.colorTextSecondary};
  text-align: left;
  user-select: none;

  .expand-icon {
    transition: transform 0.2s ease;
    transform: rotate(${({ $open }) => ($open ? '0deg' : '-90deg')});
    flex-shrink: 0;
  }

  &:hover {
    background: ${({ theme }) => theme.colorBgTextHover};
    color: ${({ theme }) => theme.colorText};
  }
`;

const DetailsContent = styled.div`
  padding: ${({ theme }) => theme.sizeUnit * 2}px
    ${({ theme }) => theme.sizeUnit * 3}px;
  background: ${({ theme }) => theme.colorBgLayout};
  border-top: 1px solid ${({ theme }) => theme.colorSplit};
  font-size: ${({ theme }) => theme.fontSizeSM}px;
`;

const FilterSummary = styled.p`
  margin: 0 0 ${({ theme }) => theme.sizeUnit}px 0;
  color: ${({ theme }) => theme.colorTextSecondary};
  font-size: ${({ theme }) => theme.fontSizeSM}px;
`;

const FilterItemList = styled.ul`
  margin: ${({ theme }) => theme.sizeUnit}px 0 0 0;
  padding-left: ${({ theme }) => theme.sizeUnit * 4}px;
`;

const FilterItem = styled.li`
  margin-bottom: ${({ theme }) => theme.sizeUnit}px;
  color: ${({ theme }) => theme.colorText};
  font-size: ${({ theme }) => theme.fontSizeSM}px;
  line-height: 1.4;
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPermalinkKey(url: string): string | null {
  const match = url.match(/\/dashboard\/p\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return t('(none)');
  }
  if (Array.isArray(value)) {
    const arr = value as unknown[];
    return arr.length === 0 ? t('(none)') : arr.map(String).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

function buildDetails(
  payload: PermalinkPayload,
  filterNames: Map<string, string>,
): FilterDetail[] {
  const rawMask = payload?.state?.dataMask ?? {};
  return Object.entries(rawMask)
    .map(([filterId, entry]) => ({
      filterId,
      label: filterNames.get(filterId) ?? filterId,
      value: entry?.filterState?.value,
    }))
    .filter(d => hasValue(d.value))
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    );
}

// ── Component ─────────────────────────────────────────────────────────────────

const BookmarksTab: FC = () => {
  const dispatch = useDispatch();

  const dashboardId = useSelector<RootState, number>(
    state => state.dashboardInfo.id,
  );
  const dataMask = useSelector<RootState, DataMaskStateWithId>(
    state => state.dataMask,
  );
  const activeTabs = useSelector<RootState, string[]>(
    state => state.dashboardState.activeTabs,
  );
  const filterConfig = useSelector<
    RootState,
    Array<{ id: string; name?: string }>
  >(
    state =>
      (state.dashboardInfo.metadata?.native_filter_configuration as Array<{
        id: string;
        name?: string;
      }>) ?? [],
  );

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [cache, setCache] = useState<Record<string, CachedEntry>>({});
  const [loadingDetailsIds, setLoadingDetailsIds] = useState<Set<string>>(
    new Set(),
  );

  const inputRef = useRef<InputRef>(null);

  const filterNames = useMemo(() => {
    const map = new Map<string, string>();
    filterConfig.forEach(f => {
      if (f.id) map.set(f.id, f.name ?? f.id);
    });
    return map;
  }, [filterConfig]);

  const loadBookmarks = useCallback(async () => {
    if (!dashboardId) return;
    setLoading(true);
    try {
      const { json } = await SupersetClient.get({
        endpoint: `/api/v1/dashboard/bookmark/?dashboard_id=${dashboardId}`,
      });
      setBookmarks((json as { result?: Bookmark[] }).result ?? []);
    } catch {
      setBookmarks([]);
    } finally {
      setLoading(false);
    }
  }, [dashboardId]);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  useEffect(() => {
    if (showModal) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setNewName('');
    }
  }, [showModal]);

  // Fetch and cache a permalink's full payload
  const fetchPermalinkPayload = useCallback(
    async (bookmarkId: string, permalink: string): Promise<PermalinkPayload | null> => {
      if (cache[bookmarkId]) return cache[bookmarkId].payload;
      const key = getPermalinkKey(permalink);
      if (!key) return null;
      try {
        const { json } = await SupersetClient.get({
          endpoint: `/api/v1/dashboard/permalink/${encodeURIComponent(key)}`,
        });
        const payload = json as PermalinkPayload;
        const details = buildDetails(payload, filterNames);
        setCache(prev => ({ ...prev, [bookmarkId]: { payload, details } }));
        return payload;
      } catch {
        return null;
      }
    },
    [cache, filterNames],
  );

  // Apply a bookmark's filter state to the current dashboard
  const applyBookmark = useCallback(
    async (bookmark: Bookmark) => {
      if (applyingId) return;
      setApplyingId(bookmark.id);
      try {
        const payload = await fetchPermalinkPayload(bookmark.id, bookmark.permalink);
        if (!payload?.state) return;

        const savedMask = payload.state.dataMask ?? {};
        const savedActiveTabs = payload.state.activeTabs;

        // Apply saved filter values, clear filters not present in the bookmark
        filterConfig.forEach(({ id: filterId }) => {
          const savedEntry = savedMask[filterId];
          if (savedEntry) {
            dispatch(
              updateDataMask(filterId, {
                id: filterId,
                ...savedEntry,
              }),
            );
          } else {
            dispatch(clearDataMask(filterId));
          }
        });

        // Restore active tabs if the dashboard has tabs
        if (savedActiveTabs && savedActiveTabs.length > 0) {
          dispatch(setActiveTabs(savedActiveTabs));
        }
      } finally {
        setApplyingId(null);
      }
    },
    [applyingId, fetchPermalinkPayload, filterConfig, dispatch],
  );

  const handleSave = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const { json: permalinkJson } = await SupersetClient.post({
        endpoint: `/api/v1/dashboard/${dashboardId}/permalink`,
        jsonPayload: { urlParams: [], dataMask, activeTabs },
      });
      const permalink =
        (permalinkJson as { url?: string }).url ??
        (permalinkJson as { result?: string }).result ??
        '';

      await SupersetClient.post({
        endpoint: '/api/v1/dashboard/bookmark/',
        jsonPayload: { permalink, dashboard_id: dashboardId, name },
      });

      setShowModal(false);
      loadBookmarks();
    } catch {
      // keep modal open on error so user can retry
    } finally {
      setSaving(false);
    }
  }, [newName, dashboardId, dataMask, activeTabs, loadBookmarks]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await SupersetClient.delete({
        endpoint: `/api/v1/dashboard/bookmark/${encodeURIComponent(id)}`,
      });
      setBookmarks(prev => prev.filter(b => b.id !== id));
      setCache(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch {
      // deletion failed silently; list stays unchanged
    }
  }, []);

  const handleCopy = useCallback(async (permalink: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(permalink);
      } else {
        const ta = document.createElement('textarea');
        ta.value = permalink;
        ta.style.cssText = 'position:fixed;top:-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      // copy failed silently
    }
  }, []);

  const toggleDetails = useCallback(
    async (bookmark: Bookmark) => {
      const { id } = bookmark;
      setExpandedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });

      if (id in cache || loadingDetailsIds.has(id)) return;

      setLoadingDetailsIds(prev => new Set(prev).add(id));
      try {
        await fetchPermalinkPayload(id, bookmark.permalink);
      } finally {
        setLoadingDetailsIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [cache, loadingDetailsIds, fetchPermalinkPayload],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleSave();
      if (e.key === 'Escape') setShowModal(false);
    },
    [handleSave],
  );

  return (
    <>
      <Container>
        <Button
          buttonStyle="primary"
          buttonSize="small"
          onClick={() => setShowModal(true)}
        >
          <Icons.BookOutlined iconSize="s" />
          &nbsp;{t('Save current view')}
        </Button>

        {loading ? (
          <Loading position="inline-centered" size="s" muted />
        ) : bookmarks.length === 0 ? (
          <EmptyState
            size="small"
            title={t('No bookmarks saved')}
            image="filter.svg"
            description={t(
              'Click "Save current view" to save the current filters as a bookmark.',
            )}
          />
        ) : (
          <BookmarkList>
            {bookmarks.map(bookmark => {
              const isExpanded = expandedIds.has(bookmark.id);
              const cached = cache[bookmark.id];
              const isLoadingDetails = loadingDetailsIds.has(bookmark.id);
              const isApplying = applyingId === bookmark.id;

              return (
                <BookmarkCard key={bookmark.id}>
                  <BookmarkHeader>
                    <BookmarkNameButton
                      type="button"
                      title={t('Apply this bookmark')}
                      disabled={!!applyingId}
                      onClick={() => applyBookmark(bookmark)}
                    >
                      {isApplying ? (
                        <Loading
                          position="inline"
                          size="s"
                          muted
                          css={{ display: 'inline-block', marginRight: 4 }}
                        />
                      ) : null}
                      {bookmark.name}
                    </BookmarkNameButton>
                    <BookmarkActions>
                      <Button
                        buttonStyle="link"
                        buttonSize="xsmall"
                        tooltip={t('Copy link')}
                        onClick={() => handleCopy(bookmark.permalink)}
                      >
                        <Icons.CopyOutlined iconSize="s" />
                      </Button>
                      <Popconfirm
                        title={t('Delete this bookmark?')}
                        onConfirm={() => handleDelete(bookmark.id)}
                        okText={t('Delete')}
                        cancelText={t('Cancel')}
                      >
                        <Button
                          buttonStyle="link"
                          buttonSize="xsmall"
                          tooltip={t('Delete')}
                        >
                          <Icons.DeleteOutlined iconSize="s" />
                        </Button>
                      </Popconfirm>
                    </BookmarkActions>
                  </BookmarkHeader>

                  <DetailsToggle
                    $open={isExpanded}
                    onClick={() => toggleDetails(bookmark)}
                    type="button"
                  >
                    <Icons.CaretDownOutlined
                      iconSize="xs"
                      className="expand-icon"
                    />
                    {t('Filter details')}
                  </DetailsToggle>

                  {isExpanded && (
                    <DetailsContent>
                      {isLoadingDetails ? (
                        <Loading position="inline-centered" size="s" muted />
                      ) : !cached || cached.details.length === 0 ? (
                        <FilterSummary>
                          {t('No filters applied in this bookmark')}
                        </FilterSummary>
                      ) : (
                        <>
                          <FilterSummary>
                            {t('%s filter(s) applied', cached.details.length)}
                          </FilterSummary>
                          <FilterItemList>
                            {cached.details.map(d => (
                              <FilterItem key={d.filterId}>
                                <strong>{d.label}: </strong>
                                {formatValue(d.value)}
                              </FilterItem>
                            ))}
                          </FilterItemList>
                        </>
                      )}
                    </DetailsContent>
                  )}
                </BookmarkCard>
              );
            })}
          </BookmarkList>
        )}
      </Container>

      <Modal
        title={t('Save current view as bookmark')}
        show={showModal}
        onHide={() => setShowModal(false)}
        primaryButtonName={t('Save')}
        onHandledPrimaryAction={handleSave}
        primaryButtonLoading={saving}
        disablePrimaryButton={!newName.trim()}
        centered
      >
        <Input
          ref={inputRef}
          placeholder={t('E.g. Jan sales — north region')}
          value={newName}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setNewName(e.target.value)
          }
          onKeyDown={handleKeyDown}
          maxLength={120}
        />
      </Modal>
    </>
  );
};

export default BookmarksTab;
