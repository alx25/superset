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
import { useMemo } from 'react';
import { shallowEqual, useSelector } from 'react-redux';
import { DataMaskStateWithId, ExtraFormData } from '@superset-ui/core';
import { RootState } from 'src/dashboard/types';
import { mergeExtraFormData } from '../../utils';
import {
  FilterConfigMap,
  resolveTransitiveParentIds,
} from '../../dependencyGraph';

/**
 * Resolve the transitive ancestor ids for a given filter from the live
 * native-filter configuration in Redux. Shared between
 * `useFilterDependencies` and the readiness guard in `FilterValue` so they
 * always agree on which parents count.
 */
export function useTransitiveParentIds(id: string): string[] {
  const filterConfig = useSelector<RootState, FilterConfigMap | undefined>(
    state => state.nativeFilters?.filters,
    shallowEqual,
  );

  return useMemo(
    () => resolveTransitiveParentIds(id, filterConfig ?? {}),
    [id, filterConfig],
  );
}

export function hasPendingRequiredFirstParentFilters(
  dependencyIds: string[],
  filters: FilterConfigMap,
  dataMaskSelected?: DataMaskStateWithId,
): boolean {
  return dependencyIds.some(parentId => {
    const parentFilter = filters[parentId];
    if (!parentFilter?.requiredFirst) {
      return false;
    }

    const parentState = dataMaskSelected?.[parentId];
    const parentValue = parentState?.filterState?.value;
    const hasValue = Array.isArray(parentValue)
      ? parentValue.length > 0
      : parentValue !== null && parentValue !== undefined;
    const hasExtraFormData =
      Object.keys(parentState?.extraFormData || {}).length > 0;

    return !hasValue || !hasExtraFormData;
  });
}

export function useHasPendingRequiredFirstParentFilters(
  id: string,
  dataMaskSelected?: DataMaskStateWithId,
): boolean {
  const filterConfig = useSelector<RootState, FilterConfigMap | undefined>(
    state => state.nativeFilters?.filters,
    shallowEqual,
  );

  return useMemo(() => {
    const filters = filterConfig ?? {};
    return hasPendingRequiredFirstParentFilters(
      resolveTransitiveParentIds(id, filters),
      filters,
      dataMaskSelected,
    );
  }, [dataMaskSelected, filterConfig, id]);
}

export function useFilterDependencies(
  id: string,
  dataMaskSelected?: DataMaskStateWithId,
): ExtraFormData {
  const dependencyIds = useTransitiveParentIds(id);

  return useMemo(() => {
    let dependencies: ExtraFormData = {};
    dependencyIds.forEach(parentId => {
      const parentState = dataMaskSelected?.[parentId];
      dependencies = mergeExtraFormData(
        dependencies,
        parentState?.extraFormData,
      );
    });
    return dependencies;
  }, [dataMaskSelected, dependencyIds]);
}
