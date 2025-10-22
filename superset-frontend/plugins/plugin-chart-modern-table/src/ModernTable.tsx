/* eslint-disable camelcase */
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
import { useMemo, useState, useCallback } from 'react';
import { styled, t } from '@superset-ui/core';
import { ModernTableChartTransformedProps, DataColumnMeta } from './types';

// Main container
const TableContainer = styled.div`
  ${({ theme }) => `
    font-family: ${theme.typography.families.sansSerif};
    background: ${theme.colors.grayscale.light5};
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid ${theme.colors.grayscale.light2};
    display: flex;
    flex-direction: column;
    height: 100%;
  `}
`;

// Search box
const SearchContainer = styled.div`
  ${({ theme }) => `
    padding: 16px;
    background: ${theme.colors.grayscale.light4};
    border-bottom: 1px solid ${theme.colors.grayscale.light2};
  `}
`;

const SearchInput = styled.input`
  ${({ theme }) => `
    width: 100%;
    padding: 8px 12px;
    border: 1px solid ${theme.colors.grayscale.light2};
    border-radius: 4px;
    font-size: 14px;
    background: ${theme.colors.grayscale.light5};
    
    &:focus {
      outline: none;
      border-color: ${theme.colors.primary.base};
      box-shadow: 0 0 0 2px ${theme.colors.primary.light3};
    }
  `}
`;

// Table styles
const TableScrollContainer = styled.div`
  flex: 1;
  overflow: auto;
`;

const StyledTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  min-width: 100%;
`;

const StyledTh = styled.th<{
  sortable?: boolean;
  sortDirection?: 'asc' | 'desc' | null;
}>`
  ${({ theme, sortable, sortDirection }) => `
    text-align: left;
    padding: 12px 16px;
    background: ${theme.colors.grayscale.light4};
    border-bottom: 2px solid ${theme.colors.grayscale.light2};
    font-weight: 600;
    font-size: 13px;
    color: ${theme.colors.grayscale.dark2};
    position: sticky;
    top: 0;
    z-index: 10;
    
    ${
      sortable
        ? `
      cursor: pointer;
      user-select: none;
      position: relative;
      
      &:hover {
        background: ${theme.colors.grayscale.light3};
      }
      
      ${
        sortDirection
          ? `
        &::after {
          content: '${sortDirection === 'asc' ? '↑' : '↓'}';
          margin-left: 8px;
          font-size: 12px;
          color: ${theme.colors.primary.base};
        }
      `
          : `
        &::after {
          content: '↕';
          margin-left: 8px;
          font-size: 12px;
          color: ${theme.colors.grayscale.light1};
          opacity: 0;
          transition: opacity 0.2s;
        }
        &:hover::after {
          opacity: 1;
        }
      `
      }
    `
        : ''
    }
  `}
`;

const StyledTd = styled.td<{ isEven?: boolean; stripedRows?: boolean }>`
  ${({ theme, isEven, stripedRows }) => `
    padding: 12px 16px;
    border-bottom: 1px solid ${theme.colors.grayscale.light2};
    font-size: 14px;
    color: ${theme.colors.grayscale.dark1};
    ${
      stripedRows && isEven
        ? `background: ${theme.colors.grayscale.light5};`
        : ''
    }
    
    &:hover {
      background: ${theme.colors.primary.light4};
    }
  `}
`;

// Pagination styles
const PaginationContainer = styled.div`
  ${({ theme }) => `
    padding: 16px;
    background: ${theme.colors.grayscale.light4};
    border-top: 1px solid ${theme.colors.grayscale.light2};
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  `}
`;

const PaginationInfo = styled.div`
  ${({ theme }) => `
    font-size: 14px;
    color: ${theme.colors.grayscale.dark1};
  `}
`;

const PaginationControls = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const PaginationButton = styled.button<{ disabled?: boolean }>`
  ${({ theme, disabled }) => `
    padding: 8px 12px;
    border: 1px solid ${theme.colors.grayscale.light2};
    background: ${
      disabled ? theme.colors.grayscale.light4 : theme.colors.grayscale.light5
    };
    color: ${
      disabled ? theme.colors.grayscale.light1 : theme.colors.grayscale.dark1
    };
    border-radius: 4px;
    cursor: ${disabled ? 'not-allowed' : 'pointer'};
    font-size: 14px;
    
    &:hover {
      ${!disabled ? `background: ${theme.colors.primary.light4};` : ''}
    }
  `}
`;

const RowNumberTh = styled(StyledTh)`
  width: 60px;
  text-align: center;
`;

const RowNumberTd = styled(StyledTd)`
  width: 60px;
  text-align: center;
  font-weight: 500;
`;

export default function ModernTable(props: ModernTableChartTransformedProps) {
  const {
    data,
    columns,
    height,
    width,
    showRowNumbers = false,
    pageSize = 25,
    enableSearch = true,
    enableSorting = true,
    enablePagination = true,
    stripedRows = true,
  } = props;

  // State for table functionality
  const [searchTerm, setSearchTerm] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(
    null,
  );
  const [currentPage, setCurrentPage] = useState(1);

  const processedColumns = useMemo(() => columns || [], [columns]);

  // Filter data based on search term
  const filteredData = useMemo(() => {
    if (!enableSearch || !searchTerm.trim()) return data;

    return data.filter(row =>
      processedColumns.some(col =>
        String(row[col.key] || '')
          .toLowerCase()
          .includes(searchTerm.toLowerCase()),
      ),
    );
  }, [data, searchTerm, processedColumns, enableSearch]);

  // Sort filtered data
  const sortedData = useMemo(() => {
    if (!enableSorting || !sortColumn || !sortDirection) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aValue = a[sortColumn];
      const bValue = b[sortColumn];

      if (aValue === bValue) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      let comparison = 0;
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue;
      } else {
        comparison = String(aValue).localeCompare(String(bValue));
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredData, sortColumn, sortDirection, enableSorting]);

  // Paginate sorted data
  const totalPages = Math.ceil(sortedData.length / pageSize);
  const paginatedData = useMemo(() => {
    if (!enablePagination) return sortedData;

    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return sortedData.slice(startIndex, endIndex);
  }, [sortedData, currentPage, pageSize, enablePagination]);

  // Handle column header click for sorting
  const handleSort = useCallback(
    (columnKey: string) => {
      if (!enableSorting) return;

      if (sortColumn === columnKey) {
        if (sortDirection === 'asc') {
          setSortDirection('desc');
        } else if (sortDirection === 'desc') {
          setSortColumn(null);
          setSortDirection(null);
        } else {
          setSortDirection('asc');
        }
      } else {
        setSortColumn(columnKey);
        setSortDirection('asc');
      }
      setCurrentPage(1); // Reset to first page when sorting
    },
    [sortColumn, sortDirection, enableSorting],
  );

  // Handle search
  const handleSearch = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSearchTerm(event.target.value);
      setCurrentPage(1); // Reset to first page when searching
    },
    [],
  );

  // Handle pagination
  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(Math.max(1, Math.min(page, totalPages)));
    },
    [totalPages],
  );

  // Format cell value
  const formatCellValue = useCallback((value: any, column: DataColumnMeta) => {
    if (value == null) return '';

    if (column.isDatetime && value) {
      try {
        return new Date(value).toLocaleDateString();
      } catch {
        return String(value);
      }
    }

    if (column.isNumeric && typeof value === 'number') {
      return value.toLocaleString();
    }

    return String(value);
  }, []);

  if (!data || data.length === 0) {
    return (
      <TableContainer style={{ height, width }}>
        <div style={{ padding: 20, textAlign: 'center' }}>
          {t('No data available')}
        </div>
      </TableContainer>
    );
  }

  const startRow = enablePagination ? (currentPage - 1) * pageSize + 1 : 1;
  const endRow = enablePagination
    ? Math.min(currentPage * pageSize, sortedData.length)
    : sortedData.length;

  return (
    <TableContainer style={{ height, width }}>
      {enableSearch && (
        <SearchContainer>
          <SearchInput
            type="text"
            placeholder={t('Search table...')}
            value={searchTerm}
            onChange={handleSearch}
          />
        </SearchContainer>
      )}

      <TableScrollContainer>
        <StyledTable>
          <thead>
            <tr>
              {showRowNumbers && <RowNumberTh>#</RowNumberTh>}
              {processedColumns.map(col => (
                <StyledTh
                  key={col.key}
                  sortable={enableSorting}
                  sortDirection={sortColumn === col.key ? sortDirection : null}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                </StyledTh>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {showRowNumbers && (
                  <RowNumberTd
                    isEven={rowIndex % 2 === 0}
                    stripedRows={stripedRows}
                  >
                    {startRow + rowIndex}
                  </RowNumberTd>
                )}
                {processedColumns.map(col => (
                  <StyledTd
                    key={col.key}
                    isEven={rowIndex % 2 === 0}
                    stripedRows={stripedRows}
                  >
                    {formatCellValue(row[col.key], col)}
                  </StyledTd>
                ))}
              </tr>
            ))}
          </tbody>
        </StyledTable>
      </TableScrollContainer>

      {enablePagination && totalPages > 1 && (
        <PaginationContainer>
          <PaginationInfo>
            {t(
              'Showing %s to %s of %s entries',
              startRow,
              endRow,
              sortedData.length,
            )}
          </PaginationInfo>

          <PaginationControls>
            <PaginationButton
              disabled={currentPage === 1}
              onClick={() => handlePageChange(currentPage - 1)}
            >
              {t('Previous')}
            </PaginationButton>

            <span style={{ margin: '0 16px', fontSize: 14 }}>
              {t('Page %s of %s', currentPage, totalPages)}
            </span>

            <PaginationButton
              disabled={currentPage === totalPages}
              onClick={() => handlePageChange(currentPage + 1)}
            >
              {t('Next')}
            </PaginationButton>
          </PaginationControls>
        </PaginationContainer>
      )}
    </TableContainer>
  );
}
