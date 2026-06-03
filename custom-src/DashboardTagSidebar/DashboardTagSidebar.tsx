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
import { useEffect, useMemo, useState } from 'react';
import { styled, SupersetClient, t } from '@superset-ui/core';
import { Skeleton } from '@superset-ui/core/components';
import rison from 'rison';
import Tag from 'src/types/TagType';

interface TagWithCount extends Tag {
  count: number;
}

interface DashboardTagSidebarProps {
  visible: boolean;
  onClose: () => void;
  selectedTagId?: number | null;
  onTagSelect: (tagId: number | null, tagName?: string) => void;
}

const SIDEBAR_WIDTH = 280;
const DESKTOP_BREAKPOINT_PX = 1536;

const getGridUnit = (theme: any) => theme.gridUnit ?? theme.sizeUnit ?? 4;
const getTypography = (theme: any) => theme.typography ?? {};
const getFontSize = (theme: any, sizeKey: string, fallback: number) =>
  getTypography(theme)?.sizes?.[sizeKey] ?? theme.fontSize ?? fallback;
const getFontWeight = (theme: any, weightKey: string, fallback: number) =>
  getTypography(theme)?.weights?.[weightKey] ?? fallback;

const SidebarContainer = styled.div<{ visible: boolean }>`
  width: ${({ visible }) => (visible ? `${SIDEBAR_WIDTH}px` : '0')};
  min-width: ${({ visible }) => (visible ? `${SIDEBAR_WIDTH}px` : '0')};
  background: ${({ theme }) => theme.colorBgContainer};
  border-right: 1px solid ${({ theme }) => theme.colorBorderSecondary};
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  transition: all 0.3s ease-in-out;
  position: relative;
  height: 100%;

  @media (max-width: ${DESKTOP_BREAKPOINT_PX}px) {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 1001;
    box-shadow: ${({ visible, theme }) =>
      visible ? `2px 0 12px ${theme.colorTextTertiary}` : 'none'};
  }
`;

const Backdrop = styled.div<{ visible: boolean }>`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  opacity: ${({ visible }) => (visible ? 1 : 0)};
  pointer-events: ${({ visible }) => (visible ? 'auto' : 'none')};
  transition: opacity 0.2s ease;
  z-index: 1000;

  @media (min-width: ${DESKTOP_BREAKPOINT_PX}px) {
    display: none;
  }
`;

const SidebarContent = styled.div`
  padding: ${({ theme }) => getGridUnit(theme) * 4}px;
`;

const StickyHeader = styled.div`
  position: sticky;
  top: 0;
  z-index: 1;
  background: ${({ theme }) => theme.colorBgContainer};
  padding: ${({ theme }) => getGridUnit(theme) * 4}px;
  padding-bottom: ${({ theme }) => getGridUnit(theme) * 2}px;
  margin: ${({ theme }) => `-${getGridUnit(theme) * 4}px -${
    getGridUnit(theme) * 4
  }px ${getGridUnit(theme) * 2}px`};
  border-bottom: 1px solid ${({ theme }) => theme.colorBorderSecondary};
`;

const SidebarTitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => getGridUnit(theme) * 2}px;
`;

const SidebarTitle = styled.h3`
  font-size: ${({ theme }) => getFontSize(theme, 'l', 16)}px;
  font-weight: ${({ theme }) => getFontWeight(theme, 'bold', 600)};
  color: ${({ theme }) => theme.colorText};
  margin: 0;
`;

const SearchInput = styled.input`
  width: 100%;
  margin-top: ${({ theme }) => getGridUnit(theme) * 2}px;
  padding: ${({ theme }) => getGridUnit(theme) * 2}px
    ${({ theme }) => getGridUnit(theme) * 2.5}px;
  border: 1px solid ${({ theme }) => theme.colorBorderSecondary};
  border-radius: ${({ theme }) => theme.borderRadius}px;
  background: ${({ theme }) => theme.colorBgContainer};
  color: ${({ theme }) => theme.colorText};
  font-size: ${({ theme }) => getFontSize(theme, 'm', 14)}px;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colorPrimaryBorder};
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colorPrimaryBgHover};
  }
`;

const TagItem = styled.button<{ active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: ${({ theme }) => getGridUnit(theme) * 2}px
    ${({ theme }) => getGridUnit(theme) * 3}px;
  margin-bottom: ${({ theme }) => getGridUnit(theme)}px;
  background: ${({ active, theme }) =>
    active ? theme.colorPrimaryBg : theme.colorBgContainer};
  border: 1px solid
    ${({ active, theme }) =>
      active ? theme.colorPrimaryBorder : theme.colorBorderSecondary};
  border-radius: ${({ theme }) => theme.borderRadius}px;
  color: ${({ active, theme }) => (active ? theme.colorPrimary : theme.colorText)};
  font-weight: ${({ active, theme }) =>
    active
      ? getFontWeight(theme, 'bold', 600)
      : getFontWeight(theme, 'normal', 400)};
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;

  ${({ active, theme }) =>
    active ? `box-shadow: inset 3px 0 0 ${theme.colorPrimary};` : ''}

  &:hover {
    background: ${({ active, theme }) =>
      active ? theme.colorPrimaryBg : theme.colorFillTertiary};
    border-color: ${({ theme }) => theme.colorBorder};
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colorPrimaryBorder};
  }
`;

const TagName = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TagCount = styled.span`
  background: ${({ theme }) => theme.colorFillSecondary};
  color: ${({ theme }) => theme.colorText};
  padding: ${({ theme }) => getGridUnit(theme) / 2}px
    ${({ theme }) => getGridUnit(theme) * 1.5}px;
  border-radius: ${({ theme }) => theme.borderRadius * 2}px;
  font-size: ${({ theme }) => getFontSize(theme, 's', 12)}px;
  font-weight: ${({ theme }) => getFontWeight(theme, 'bold', 600)};
  margin-left: ${({ theme }) => getGridUnit(theme) * 2}px;
`;

const AllDashboardsButton = styled(TagItem)`
  background: ${({ active, theme }) =>
    active ? theme.colorPrimary : theme.colorPrimaryBg};
  border: 2px solid ${({ theme }) => theme.colorPrimary};
  color: ${({ active, theme }) => (active ? theme.colorTextLightSolid : theme.colorPrimary)};
  font-weight: ${({ theme }) => getFontWeight(theme, 'bold', 600)};
  font-size: ${({ theme }) => getFontSize(theme, 'm', 14)}px;
  margin-bottom: ${({ theme }) => getGridUnit(theme) * 3}px;

  &:hover {
    background: ${({ active, theme }) =>
      active ? theme.colorPrimaryHover : theme.colorPrimaryBgHover};
    border-color: ${({ theme }) => theme.colorPrimaryHover};
    color: ${({ active, theme }) => (active ? theme.colorTextLightSolid : theme.colorPrimary)};
  }
`;

const SkeletonWrapper = styled.div`
  margin-bottom: ${({ theme }) => getGridUnit(theme) * 2}px;
`;

const EmptyText = styled.p`
  color: ${({ theme }) => theme.colorTextTertiary};
  font-style: italic;
  margin: 0;
`;

const CloseButton = styled.button`
  position: absolute;
  top: ${({ theme }) => getGridUnit(theme) * 2}px;
  right: ${({ theme }) => getGridUnit(theme) * 2}px;
  background: transparent;
  border: none;
  font-size: ${({ theme }) => getFontSize(theme, 'xl', 20)}px;
  color: ${({ theme }) => theme.colorTextSecondary};
  cursor: pointer;
  padding: ${({ theme }) => getGridUnit(theme)}px;
  line-height: 1;
  width: ${({ theme }) => getGridUnit(theme) * 6}px;
  height: ${({ theme }) => getGridUnit(theme) * 6}px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: ${({ theme }) => theme.borderRadius}px;
  transition: all 0.2s ease;

  &:hover {
    background: ${({ theme }) => theme.colorFillTertiary};
    color: ${({ theme }) => theme.colorText};
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colorPrimaryBorder};
  }

  @media (min-width: ${DESKTOP_BREAKPOINT_PX}px) {
    display: none;
  }
`;

function isCustomTag(tagType: unknown) {
  if (tagType == null) return false;
  const value = String(tagType).toLowerCase();
  return value.includes('custom');
}

export default function DashboardTagSidebar({
  visible,
  onClose,
  selectedTagId,
  onTagSelect,
}: DashboardTagSidebarProps) {
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const fetchTags = async () => {
      setLoading(true);
      try {
        const tagsQuery = rison.encode({
          filters: [{ col: 'type', opr: 'custom_tag', value: true }],
          page: 0,
          page_size: 1000,
          order_column: 'name',
          order_direction: 'asc',
        });
        const tagsResponse = await SupersetClient.get({
          endpoint: `/api/v1/tag/?q=${tagsQuery}`,
        });
        const allTags = Array.isArray(tagsResponse.json?.result)
          ? tagsResponse.json.result
          : [];

        const dashboardsResponse = await SupersetClient.get({
          endpoint: '/api/v1/tag/get_objects/?types=dashboard',
        });

        const tagCountMap = new Map<number, number>();
        const dashboards = Array.isArray(dashboardsResponse.json?.result)
          ? dashboardsResponse.json.result
          : [];

        dashboards.forEach((dashboard: any) => {
          const dashboardTags = Array.isArray(dashboard?.tags)
            ? dashboard.tags
            : [];
          dashboardTags.forEach((tag: any) => {
            if (isCustomTag(tag?.type) && tag?.id != null) {
              const id = Number(tag.id);
              tagCountMap.set(id, (tagCountMap.get(id) || 0) + 1);
            }
          });
        });

        const tagsWithCount: TagWithCount[] = allTags
          .map((tag: any) => {
            const id = Number(tag.id);
            return {
              id,
              name: tag.name,
              type: tag.type,
              count: tagCountMap.get(id) || 0,
            };
          })
          .filter(tag => tag.count > 0)
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));

        setTags(tagsWithCount);
      } catch {
        setTags([]);
      } finally {
        setLoading(false);
      }
    };

    if (visible) {
      fetchTags();
    }
  }, [visible]);

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && visible) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [visible, onClose]);

  const filteredTags = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return tags;
    return tags.filter(tag => String(tag.name).toLowerCase().includes(normalized));
  }, [tags, query]);

  const renderContent = useMemo(() => {
    if (loading) {
      return (
        <>
          {Array.from({ length: 8 }).map((_, index) => (
            <SkeletonWrapper key={index}>
              <Skeleton.Button active size="large" />
            </SkeletonWrapper>
          ))}
        </>
      );
    }

    if (filteredTags.length === 0) {
      return <EmptyText>{t('No hay categorías disponibles')}</EmptyText>;
    }

    return (
      <>
        <AllDashboardsButton
          active={selectedTagId == null}
          onClick={() => onTagSelect(null)}
        >
          <TagName>{t('Todos los dashboards')}</TagName>
        </AllDashboardsButton>
        {filteredTags.map(tag => (
          <TagItem
            key={tag.id}
            active={selectedTagId === tag.id}
            onClick={() => tag.id != null && onTagSelect(tag.id, String(tag.name))}
          >
            <TagName>{tag.name}</TagName>
            <TagCount>{tag.count}</TagCount>
          </TagItem>
        ))}
      </>
    );
  }, [loading, filteredTags, selectedTagId, onTagSelect]);

  return (
    <>
      <Backdrop visible={visible} onClick={onClose} />
      <SidebarContainer visible={visible}>
        <CloseButton onClick={onClose} aria-label={t('Cerrar')}>
          ×
        </CloseButton>
        <SidebarContent>
          <StickyHeader>
            <SidebarTitleRow>
              <SidebarTitle>{t('Categorías')}</SidebarTitle>
            </SidebarTitleRow>
            <SearchInput
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('Buscar categoría')}
              aria-label={t('Buscar categoría')}
            />
          </StickyHeader>
          {renderContent}
        </SidebarContent>
      </SidebarContainer>
    </>
  );
}
