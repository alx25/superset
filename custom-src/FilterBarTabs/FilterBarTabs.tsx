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

import { type FC, type ReactNode, type UIEvent, useState } from 'react';
import { t } from '@apache-superset/core/translation';
import { styled } from '@apache-superset/core/theme';
import Tabs from '@superset-ui/core/components/Tabs';
import BookmarksTab from 'src/dashboard/components/nativeFilters/FilterBar/FilterBarTabs/BookmarksTab';

type TabKey = 'filters' | 'bookmarks';

export interface FilterBarTabsProps {
  height: number | string;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

// ScrollPane fills 100% of the flex content area assigned by StyledTabs
const ScrollPane = styled.div`
  overflow: auto;
  height: 100%;
  overscroll-behavior: contain;
`;

// StyledTabs takes the full available height and distributes it via flexbox:
//   tab nav (flex-shrink: 0) + content holder (flex: 1) = total height
const StyledTabs = styled(Tabs)<{ $height: number | string }>`
  height: ${({ $height }) =>
    typeof $height === 'number' ? `${$height}px` : $height};
  display: flex;
  flex-direction: column;

  .ant-tabs-nav {
    flex-shrink: 0;
    margin: 0;
    padding: 0 ${({ theme }) => theme.sizeUnit * 4}px;
    background: ${({ theme }) => theme.colorBgContainer};
    border-bottom: 1px solid ${({ theme }) => theme.colorSplit};
  }

  .ant-tabs-content-holder {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .ant-tabs-content {
    height: 100%;
  }

  .ant-tabs-tabpane {
    height: 100%;
  }
`;

const FilterBarTabs: FC<FilterBarTabsProps> = ({ height, onScroll, children }) => {
  const [activeTab, setActiveTab] = useState<TabKey>('filters');

  const items = [
    {
      key: 'filters' as const,
      label: t('Filters'),
      children: (
        <ScrollPane onScroll={onScroll}>
          {children}
        </ScrollPane>
      ),
    },
    {
      key: 'bookmarks' as const,
      label: t('Bookmarks'),
      children: (
        <ScrollPane>
          <BookmarksTab />
        </ScrollPane>
      ),
    },
  ];

  return (
    <StyledTabs
      $height={height}
      activeKey={activeTab}
      onChange={key => setActiveTab(key as TabKey)}
      items={items}
    />
  );
};

export default FilterBarTabs;
