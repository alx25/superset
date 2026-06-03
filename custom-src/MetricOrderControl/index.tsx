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
import { useEffect, useMemo } from 'react';
import { arrayMove, SortableContainer, SortableElement, SortableHandle } from 'react-sortable-hoc';
import { t, useTheme } from '@superset-ui/core';
import { List } from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import ControlHeader from 'src/explore/components/ControlHeader';

type MetricOption = { value: string; label?: string };

function getUniqueValues(values: string[]) {
  return Array.from(new Set(values));
}

type MetricOrderControlProps = {
  label?: string;
  description?: string;
  value?: string[];
  onChange?: (value: string[]) => void;
  options?: MetricOption[];
};

const SortableDragger = SortableHandle(() => (
  <Icons.MenuOutlined
    role="img"
    aria-label="drag"
    className="text-primary"
    style={{ cursor: 'ns-resize' }}
  />
));

const SortableItem = SortableElement(
  ({ label }: { label: string }) => {
    const theme = useTheme();
    return (
      <List.Item
        css={{
          alignItems: 'center',
          display: 'flex',
          paddingInline: theme.sizeUnit * 4,
          paddingBlock: theme.sizeUnit * 2,
        }}
      >
        <SortableDragger />
        <span
          css={{
            marginLeft: theme.sizeUnit * 2,
            fontSize: theme.fontSizeSM,
          }}
        >
          {label}
        </span>
      </List.Item>
    );
  },
);

const SortableList = SortableContainer(
  ({
    items,
    labelMap,
  }: {
    items: string[];
    labelMap: Map<string, string>;
  }) => (
    <List
      bordered
      css={theme => ({
        borderRadius: theme.borderRadius,
      })}
    >
      {items.map((value, index) => (
        <SortableItem
          key={value}
          index={index}
          label={labelMap.get(value) || value}
        />
      ))}
    </List>
  ),
);

export default function MetricOrderControl({
  value,
  onChange,
  options = [],
  ...props
}: MetricOrderControlProps) {
  const optionValues = useMemo(
    () =>
      getUniqueValues(
        options
          .map(option => String(option?.value ?? ''))
          .filter(option => option),
      ),
    [options],
  );

  const labelMap = useMemo(() => {
    const map = new Map<string, string>();
    options.forEach(option => {
      const key = String(option?.value ?? '');
      if (key && !map.has(key)) {
        map.set(key, String(option?.label ?? option?.value ?? key));
      }
    });
    (Array.isArray(value) ? value : []).forEach(item => {
      const key = String(item ?? '');
      if (key && !map.has(key)) {
        map.set(key, key);
      }
    });
    return map;
  }, [options, value]);

  const normalizedOrder = useMemo(() => {
    const currentValues = Array.isArray(value)
      ? getUniqueValues(
          value
            .map(item => String(item ?? ''))
            .filter(item => item),
        )
      : [];
    if (!optionValues.length) {
      return currentValues;
    }
    const current = currentValues.filter(item => optionValues.includes(item));
    const missing = optionValues.filter(item => !current.includes(item));
    return [...current, ...missing];
  }, [optionValues, value]);

  useEffect(() => {
    if (!optionValues.length) {
      return;
    }
    const current = Array.isArray(value) ? value : [];
    if (current.length !== normalizedOrder.length) {
      onChange?.(normalizedOrder);
      return;
    }
    for (let i = 0; i < current.length; i += 1) {
      if (current[i] !== normalizedOrder[i]) {
        onChange?.(normalizedOrder);
        return;
      }
    }
  }, [normalizedOrder, onChange, optionValues.length, value]);

  if (!optionValues.length) {
    return (
      <div>
        <ControlHeader {...props} />
        <div className="text-muted">{t('Add metrics or formulas to reorder.')}</div>
      </div>
    );
  }

  return (
    <div>
      <ControlHeader {...props} />
      <SortableList
        items={normalizedOrder}
        labelMap={labelMap}
        useDragHandle
        lockAxis="y"
        onSortEnd={({ oldIndex, newIndex }) =>
          onChange?.(arrayMove(normalizedOrder, oldIndex, newIndex))
        }
      />
    </div>
  );
}
