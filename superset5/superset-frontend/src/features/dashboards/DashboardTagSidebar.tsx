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
import { useEffect, useState, useMemo } from 'react';
import { styled, SupersetClient } from '@superset-ui/core';
import rison from 'rison';
import { Skeleton } from 'src/components';
import Tag from 'src/types/TagType';

const SidebarContainer = styled.div<{ visible: boolean }>`
  width: ${({ visible }) => (visible ? '260px' : '0')};
  min-width: ${({ visible }) => (visible ? '260px' : '0')};
  background: ${({ theme }) => theme.colors.grayscale.light5};
  border-right: 1px solid ${({ theme }) => theme.colors.grayscale.light2};
  overflow-y: auto;
  overflow-x: hidden;
  transition: all 0.3s ease-in-out;
  position: relative;

  @media (max-width: ${({ theme }) => theme.gridUnit * 192}px) {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 1000;
    box-shadow: ${({ visible, theme }) =>
      visible ? `2px 0 8px ${theme.colors.grayscale.dark1}40` : 'none'};
  }
`;

const SidebarContent = styled.div`
  padding: ${({ theme }) => theme.gridUnit * 4}px;
`;

const SidebarTitle = styled.h3`
  font-size: ${({ theme }) => theme.typography.sizes.l}px;
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  color: ${({ theme }) => theme.colors.grayscale.dark2};
  margin: 0 0 ${({ theme }) => theme.gridUnit * 4}px 0;
  padding-bottom: ${({ theme }) => theme.gridUnit * 2}px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.grayscale.light2};
`;

const TagItem = styled.button<{ active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: ${({ theme }) => theme.gridUnit * 2}px
    ${({ theme }) => theme.gridUnit * 3}px;
  margin-bottom: ${({ theme }) => theme.gridUnit}px;
  background: ${({ active, theme }) =>
    active ? theme.colors.primary.light4 : 'transparent'};
  border: 1px solid
    ${({ active, theme }) =>
      active ? theme.colors.primary.base : theme.colors.grayscale.light2};
  border-radius: ${({ theme }) => theme.borderRadius}px;
  color: ${({ active, theme }) =>
    active ? theme.colors.primary.dark1 : theme.colors.grayscale.dark1};
  font-weight: ${({ active, theme }) =>
    active ? theme.typography.weights.bold : theme.typography.weights.normal};
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;

  &:hover {
    background: ${({ active, theme }) =>
      active ? theme.colors.primary.light4 : theme.colors.grayscale.light4};
    border-color: ${({ theme }) => theme.colors.primary.light1};
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colors.primary.light3};
  }
`;

const TagName = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TagCount = styled.span`
  background: ${({ theme }) => theme.colors.grayscale.light3};
  color: ${({ theme }) => theme.colors.grayscale.dark1};
  padding: ${({ theme }) => theme.gridUnit / 2}px
    ${({ theme }) => theme.gridUnit * 1.5}px;
  border-radius: ${({ theme }) => theme.borderRadius * 2}px;
  font-size: ${({ theme }) => theme.typography.sizes.s}px;
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  margin-left: ${({ theme }) => theme.gridUnit * 2}px;
`;

const AllDashboardsButton = styled(TagItem)`
  background: ${({ active, theme }) =>
    active ? theme.colors.primary.base : theme.colors.primary.light5};
  border: 2px solid ${({ theme }) => theme.colors.primary.base};
  color: ${({ active, theme }) =>
    active ? theme.colors.grayscale.light5 : theme.colors.primary.dark1};
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  font-size: ${({ theme }) => theme.typography.sizes.m}px;
  margin-bottom: ${({ theme }) => theme.gridUnit * 3}px;
  
  &:hover {
    background: ${({ active, theme }) =>
      active ? theme.colors.primary.dark1 : theme.colors.primary.light4};
    border-color: ${({ theme }) => theme.colors.primary.dark1};
    color: ${({ active, theme }) =>
      active ? theme.colors.grayscale.light5 : theme.colors.primary.dark2};
  }
`;

const SkeletonWrapper = styled.div`
  margin-bottom: ${({ theme }) => theme.gridUnit * 2}px;
`;

const CloseButton = styled.button`
  position: absolute;
  top: ${({ theme }) => theme.gridUnit * 2}px;
  right: ${({ theme }) => theme.gridUnit * 2}px;
  background: transparent;
  border: none;
  font-size: ${({ theme }) => theme.typography.sizes.xl}px;
  color: ${({ theme }) => theme.colors.grayscale.base};
  cursor: pointer;
  padding: ${({ theme }) => theme.gridUnit}px;
  line-height: 1;
  width: ${({ theme }) => theme.gridUnit * 6}px;
  height: ${({ theme }) => theme.gridUnit * 6}px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: ${({ theme }) => theme.borderRadius}px;
  transition: all 0.2s ease;

  &:hover {
    background: ${({ theme }) => theme.colors.grayscale.light4};
    color: ${({ theme }) => theme.colors.grayscale.dark2};
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colors.primary.light3};
  }

  @media (min-width: ${({ theme }) => theme.gridUnit * 192}px) {
    display: none;
  }
`;

interface TagWithCount extends Tag {
  count: number;
}

interface DashboardTagSidebarProps {
  visible: boolean;
  onClose: () => void;
  selectedTagId?: number | null;
  onTagSelect: (tagId: number | null, tagName?: string) => void;
}

export default function DashboardTagSidebar({
  visible,
  onClose,
  selectedTagId,
  onTagSelect,
}: DashboardTagSidebarProps) {
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<TagWithCount[]>([]);

  useEffect(() => {
    const fetchTags = async () => {
      try {
        setLoading(true);
        
        // Paso 1: Obtener todas las tags custom
        const tagsQuery = rison.encode({
          filters: [
            { col: 'type', opr: 'custom_tag', value: true },
          ],
          page: 0,
          page_size: 1000,
          order_column: 'name',
          order_direction: 'asc',
        });
        
        const tagsResponse = await SupersetClient.get({
          endpoint: `/api/v1/tag/?q=${tagsQuery}`,
        });
        
        console.log('Tags response:', tagsResponse.json);
        
        if (!tagsResponse.json?.result || !Array.isArray(tagsResponse.json.result)) {
          console.error('Invalid tags response format');
          setTags([]);
          return;
        }
        
        const allTags = tagsResponse.json.result;
        console.log('All custom tags:', allTags);
        
        // Paso 2: Obtener dashboards con tags para contar
        const dashboardsResponse = await SupersetClient.get({
          endpoint: '/api/v1/tag/get_objects/?types=dashboard',
        });
        
        console.log('Dashboards response:', dashboardsResponse.json);
        
        // Crear un mapa de conteo de dashboards por tag
        const tagCountMap = new Map<number, number>();
        
        if (dashboardsResponse.json?.result && Array.isArray(dashboardsResponse.json.result)) {
          console.log('Processing', dashboardsResponse.json.result.length, 'dashboards');
          
          dashboardsResponse.json.result.forEach((dashboard: any, index: number) => {
            console.log(`Dashboard ${index}:`, dashboard);
            console.log(`Dashboard ${index} tags:`, dashboard.tags);
            
            if (dashboard.tags && Array.isArray(dashboard.tags)) {
              dashboard.tags.forEach((tag: any) => {
                console.log('Processing dashboard tag:', tag);
                // Comparar con 'TagType.custom' o 'custom' para compatibilidad
                const isCustomTag = tag.type === 'TagType.custom' || tag.type === 'custom';
                if (isCustomTag && tag.id !== undefined) {
                  console.log('✅ Custom tag matched:', tag.name, 'ID:', tag.id);
                  const currentCount = tagCountMap.get(tag.id) || 0;
                  tagCountMap.set(tag.id, currentCount + 1);
                }
              });
            } else {
              console.warn(`Dashboard ${index} has no tags or tags is not an array`);
            }
          });
        }
        
        console.log('Tag count map:', tagCountMap);
        
        // Paso 3: Combinar tags con sus conteos (solo tags con dashboards)
        const tagsWithCount: TagWithCount[] = allTags
          .filter((tag: any) => {
            const count = tagCountMap.get(tag.id) || 0;
            return count > 0; // Solo incluir tags que tienen al menos 1 dashboard
          })
          .map((tag: any) => ({
            id: tag.id,
            name: tag.name,
            type: tag.type,
            count: tagCountMap.get(tag.id) || 0,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        
        console.log('Final tags with count:', tagsWithCount);
        setTags(tagsWithCount);
      } catch (error) {
        console.error('Error fetching tags:', error);
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

    if (tags.length === 0) {
      return (
        <p style={{ color: '#999', fontStyle: 'italic' }}>
          No hay categorías disponibles
        </p>
      );
    }

    return (
      <>
        <AllDashboardsButton
          active={selectedTagId === null}
          onClick={() => onTagSelect(null)}
        >
          <TagName>Todos los dashboards</TagName>
        </AllDashboardsButton>
        {tags.map(tag => (
          <TagItem
            key={tag.id}
            active={selectedTagId === tag.id}
            onClick={() => tag.id !== undefined && onTagSelect(tag.id, tag.name)}
          >
            <TagName>{tag.name}</TagName>
            <TagCount>{tag.count}</TagCount>
          </TagItem>
        ))}
      </>
    );
  }, [loading, tags, selectedTagId, onTagSelect]);

  return (
    <SidebarContainer visible={visible}>
      <CloseButton onClick={onClose} aria-label="Cerrar">
        ×
      </CloseButton>
      <SidebarContent>
        <SidebarTitle>Categorías</SidebarTitle>
        {renderContent}
      </SidebarContent>
    </SidebarContainer>
  );
}
