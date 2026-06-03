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
import { styled, t, SupersetClient } from '@superset-ui/core';
import { Icons } from '@superset-ui/core/components/Icons';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import { FaveStar } from '@superset-ui/core/components';
import { Tooltip } from '@superset-ui/core/components';
import { Skeleton } from '@superset-ui/core/components';

const FavoritesBannerContainer = styled.div`
  ${({ theme }) => `
    background: ${theme.colorBgContainer};
    border-bottom: 1px solid ${theme.colorBorderSecondary};
    margin-bottom: ${theme.sizeUnit * 2}px;
    overflow: hidden;
    transition: max-height 0.3s ease-out;
  `}
`;

const BannerContent = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 4}px;
  `}
`;

const BannerHeader = styled.div`
  ${({ theme }) => `
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: ${theme.sizeUnit * 3}px;
    
    .header-left {
      display: flex;
      align-items: center;
      gap: ${theme.sizeUnit * 2}px;
      cursor: pointer;
      user-select: none;
      
      h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: ${theme.colorText};
        display: flex;
        align-items: center;
        gap: ${theme.sizeUnit * 1.5}px;
      }
      
      .favorites-count {
        font-size: 14px;
        color: ${theme.colorTextSecondary};
        font-weight: 400;
      }
      
      &:hover h3 {
        color: ${theme.colorPrimary};
      }
    }
    
    .collapse-button {
      background: transparent;
      border: none;
      cursor: pointer;
      padding: ${theme.sizeUnit}px;
      display: flex;
      align-items: center;
      color: ${theme.colorTextSecondary};
      transition: all 0.2s;
      border-radius: ${theme.borderRadius}px;
      
      &:hover {
        background: ${theme.colorBgLayout};
        color: ${theme.colorPrimary};
      }
    }
  `}
`;

const ScrollContainer = styled.div`
  position: relative;
  padding: 0 80px;
  min-height: 160px;
  overflow: visible;
`;

const CardsScroller = styled.div`
  ${({ theme }) => `
    display: flex;
    gap: ${theme.sizeUnit * 3}px;
    overflow-x: auto;
    overflow-y: visible;
    padding-bottom: ${theme.sizeUnit * 3}px;
    padding-top: ${theme.sizeUnit}px;
    margin: -${theme.sizeUnit}px 0 0 0;
    position: relative;
    z-index: 1;
    
    /* Scrollbar styling */
    &::-webkit-scrollbar {
      height: 6px;
    }
    
    &::-webkit-scrollbar-track {
      background: ${theme.colorBgLayout};
      border-radius: 3px;
    }
    
    &::-webkit-scrollbar-thumb {
      background: ${theme.colorBorderSecondary};
      border-radius: 3px;
      
      &:hover {
        background: ${theme.colorPrimary};
      }
    }
  `}
`;

const ScrollButton = styled.button<{ direction: 'left' | 'right'; visible: boolean }>`
  ${({ theme, direction, visible }) => `
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    ${direction}: 5px;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    border: 2px solid ${theme.colorBorderSecondary};
    background: ${theme.colorBgContainer};
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    cursor: ${visible ? 'pointer' : 'not-allowed'};
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2;
    opacity: ${visible ? '0.9' : '0.3'};
    pointer-events: auto;
    transition: all 0.3s ease;
    color: ${theme.colorPrimary};
    font-size: 28px;
    
    &:hover {
      opacity: ${visible ? '1' : '0.3'};
      background: ${visible ? theme.colorPrimary : theme.colorBgContainer};
      color: ${visible ? 'white' : theme.colorPrimary};
      border-color: ${visible ? theme.colorPrimary : theme.colorBorderSecondary};
      transform: translateY(-50%) ${visible ? 'scale(1.15)' : 'scale(1)'};
      box-shadow: ${visible ? '0 6px 20px rgba(0, 0, 0, 0.35)' : '0 4px 16px rgba(0, 0, 0, 0.25)'};
    }
    
    &:active {
      transform: translateY(-50%) ${visible ? 'scale(0.95)' : 'scale(1)'};
    }
  `}
`;

const FavoriteCardWrapper = styled.div`
  min-width: 240px;
  max-width: 240px;
  flex-shrink: 0;
`;

const CompactCard = styled.div`
  ${({ theme }) => `
    background: ${theme.colorBgContainer};
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: 8px;
    padding: 0;
    cursor: pointer;
    transition: all 0.2s ease;
    height: 140px;
    display: flex;
    flex-direction: column;
    position: relative;
    z-index: 1;
    overflow: hidden;
    
    &:hover {
      border-color: ${theme.colorPrimary};
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      transform: translateY(-2px);
      z-index: 10;
    }
    
    .card-thumbnail {
      width: 100%;
      height: 60px;
      background: linear-gradient(135deg, ${theme.colorPrimaryBg} 0%, ${theme.colorPrimaryBgHover} 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border-bottom: 1px solid ${theme.colorBorderSecondary};
      
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      
      .placeholder-icon {
        color: ${theme.colorPrimary};
        opacity: 0.3;
      }
    }
    
    .card-body {
      padding: ${theme.sizeUnit * 2}px ${theme.sizeUnit * 2.5}px;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
  `}
`;

const CardHeader = styled.div`
  ${({ theme }) => `
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: ${theme.sizeUnit * 2}px;
    
    .fave-star {
      flex-shrink: 0;
      margin-left: ${theme.sizeUnit}px;
    }
  `}
`;

const CardTitle = styled.div`
  ${({ theme }) => `
    font-size: 14px;
    font-weight: 600;
    color: ${theme.colorText};
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
    flex: 1;
    margin-bottom: ${theme.sizeUnit}px;
  `}
`;

const CardFooter = styled.div`
  ${({ theme }) => `
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: ${theme.colorTextSecondary};
    margin-top: auto;
    
    .badge {
      display: inline-flex;
      align-items: center;
      gap: ${theme.sizeUnit * 0.5}px;
      padding: ${theme.sizeUnit * 0.5}px ${theme.sizeUnit}px;
      background: ${theme.colorBgLayout};
      border-radius: 4px;
      font-size: 10px;
      font-weight: 500;
    }
    
    .chart-count {
      display: flex;
      align-items: center;
      gap: ${theme.sizeUnit * 0.5}px;
      color: ${theme.colorTextTertiary};
    }
    
    .published {
      color: ${theme.colorSuccess};
      background: ${theme.colorSuccessBg};
    }
    
    .draft {
      color: ${theme.colorWarning};
      background: ${theme.colorWarningBg};
    }
  `}
`;

interface FavoritesBannerProps {
  favoriteStatus: Record<string, boolean>;
  saveFavoriteStatus: (id: number, isStarred: boolean) => void;
  userId?: string | number;
  showThumbnails?: boolean;
  bulkSelectEnabled?: boolean;
  addDangerToast?: (msg: string) => void;
  addSuccessToast?: (msg: string) => void;
  refreshData?: () => void;
  hasPerm?: (name: string) => boolean;
  handleBulkDashboardExport?: (dashboards: any[]) => void;
  onDelete?: (dashboard: any) => void;
}

export default function FavoritesBanner({
  favoriteStatus,
  saveFavoriteStatus,
  userId,
  showThumbnails,
  bulkSelectEnabled,
  addDangerToast,
  addSuccessToast,
  refreshData,
  hasPerm = () => false,
  handleBulkDashboardExport = () => {},
  onDelete = () => {},
}: FavoritesBannerProps) {
  const history = useHistory();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [allFavorites, setAllFavorites] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true); // Inicialmente true para mostrar el botón
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Función para verificar si se puede scrollear
  const checkScrollability = useCallback(() => {
    if (scrollerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollerRef.current;
      const hasScroll = scrollWidth > clientWidth;
      const canLeft = scrollLeft > 1; // Usar > 1 en lugar de > 0 para evitar problemas de precisión
      const canRight = scrollLeft < scrollWidth - clientWidth - 1;
      
      setCanScrollLeft(canLeft);
      setCanScrollRight(canRight && hasScroll);
    }
  }, []);
  
  // Función para iniciar desplazamiento continuo
  const startScrolling = useCallback((direction: 'left' | 'right') => {
    if (scrollIntervalRef.current) return;
    
    const scrollStep = () => {
      if (scrollerRef.current) {
        const scrollAmount = direction === 'left' ? -10 : 10;
        scrollerRef.current.scrollBy({ left: scrollAmount });
        checkScrollability(); // Actualizar estado después de cada paso
      }
    };
    
    scrollStep(); // Scroll inmediato
    scrollIntervalRef.current = setInterval(scrollStep, 20);
  }, [checkScrollability]);

  // Función para detener desplazamiento continuo
  const stopScrolling = useCallback(() => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  }, []);
  
  // Función para scrollear suavemente con un clic
  const scroll = useCallback((direction: 'left' | 'right') => {
    if (scrollerRef.current) {
      const scrollAmount = 300;
      const newScrollLeft = direction === 'left' 
        ? scrollerRef.current.scrollLeft - scrollAmount
        : scrollerRef.current.scrollLeft + scrollAmount;
      
      scrollerRef.current.scrollTo({
        left: newScrollLeft,
        behavior: 'smooth',
      });
      
      // Verificar estado después de un delay para que termine el smooth scroll
      setTimeout(checkScrollability, 350);
    }
  }, [checkScrollability]);
  
  // Función memoizada para fetch de favoritos
  const fetchAllFavorites = useCallback(async () => {
    setIsLoading(true);
    try {
      const queryParams = {
        filters: [
          {
            col: 'id',
            opr: 'dashboard_is_favorite',
            value: true,
          },
        ],
        order_column: 'dashboard_title',
        order_direction: 'asc',
        page: 0,
        page_size: 100, // Obtener hasta 100 favoritos
      };
      
      const { json } = await SupersetClient.get({
        endpoint: `/api/v1/dashboard/?q=${JSON.stringify(queryParams)}`,
      });
      
      if (json?.result) {
        setAllFavorites(json.result);
      }
    } catch (error) {
      console.error('Error fetching favorite dashboards:', error);
      if (addDangerToast) {
        addDangerToast(t('Error al cargar dashboards favoritos'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [addDangerToast]);
  
  // Obtener TODOS los dashboards favoritos del usuario
  useEffect(() => {
    fetchAllFavorites();
  }, [fetchAllFavorites, refreshTrigger]);
  
  // Los dashboards ya vienen filtrados como favoritos del API, no necesitamos filtrar más
  const favoriteDashboards = allFavorites;
  
  // Monitorear el scroll para actualizar las flechas
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) {
      // Verificar inmediatamente
      checkScrollability();
      
      // Agregar listeners
      scroller.addEventListener('scroll', checkScrollability);
      window.addEventListener('resize', checkScrollability);
      
      // Verificar después de un pequeño delay por si el contenido aún se está renderizando
      const timeoutId = setTimeout(checkScrollability, 100);
      
      return () => {
        scroller.removeEventListener('scroll', checkScrollability);
        window.removeEventListener('resize', checkScrollability);
        clearTimeout(timeoutId);
        stopScrolling(); // Limpiar intervalo al desmontar
      };
    }
    return undefined;
  }, [checkScrollability, favoriteDashboards.length, stopScrolling]);

  // Si está cargando, mostrar skeleton
  if (isLoading) {
    return (
      <FavoritesBannerContainer style={{ maxHeight: '180px' }}>
        <BannerContent>
          <BannerHeader>
            <div className="header-left">
              <h3>
                <Icons.StarFilled
                  iconSize="m"
                  iconColor="gold"
                />
                {t('Favoritos')}
              </h3>
            </div>
          </BannerHeader>
          <Skeleton active paragraph={{ rows: 3 }} />
        </BannerContent>
      </FavoritesBannerContainer>
    );
  }

  if (favoriteDashboards.length === 0) {
    return null;
  }

  return (
    <FavoritesBannerContainer style={{ maxHeight: isCollapsed ? '60px' : '500px' }}>
      <BannerContent>
        <BannerHeader>
          <div className="header-left" onClick={() => setIsCollapsed(!isCollapsed)}>
            <h3>
              <Icons.StarFilled iconColor="#faad14" iconSize="l" />
              {t('Favoritos')}
              <span className="favorites-count">
                ({favoriteDashboards.length})
              </span>
            </h3>
          </div>
          <button
            className="collapse-button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? t('Expandir') : t('Colapsar')}
          >
            {isCollapsed ? (
              <Icons.DownOutlined iconSize="m" />
            ) : (
              <Icons.UpOutlined iconSize="m" />
            )}
          </button>
        </BannerHeader>
        {!isCollapsed && (
          <ScrollContainer>
            <ScrollButton 
              direction="left" 
              visible={canScrollLeft}
              onClick={() => scroll('left')}
              onMouseDown={() => startScrolling('left')}
              onMouseUp={stopScrolling}
              onMouseLeave={stopScrolling}
              aria-label="Scroll left"
            >
              <Icons.CaretLeftOutlined />
            </ScrollButton>
            
            <ScrollButton 
              direction="left" 
              visible={canScrollLeft}
              onClick={(e) => {
                e.preventDefault();
                if (canScrollLeft) scroll('left');
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                if (canScrollLeft) startScrolling('left');
              }}
              onMouseUp={stopScrolling}
              onMouseLeave={stopScrolling}
              aria-label="Scroll left"
            >
              <Icons.CaretLeftOutlined />
            </ScrollButton>
            
            <CardsScroller ref={scrollerRef}>
              {favoriteDashboards.map(dashboard => (
              <FavoriteCardWrapper key={dashboard.id}>
                <CompactCard onClick={() => history.push(dashboard.url)}>
                  <div className="card-thumbnail">
                    {showThumbnails && dashboard.thumbnail_url ? (
                      <img 
                        src={dashboard.thumbnail_url} 
                        alt={dashboard.dashboard_title}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <Icons.DashboardOutlined className="placeholder-icon" iconSize="xxl" />
                    )}
                  </div>
                  <div className="card-body">
                    <CardHeader>
                      <CardTitle>
                        <Tooltip title={dashboard.dashboard_title}>
                          <span>{dashboard.dashboard_title}</span>
                        </Tooltip>
                      </CardTitle>
                      <div 
                        className="fave-star"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <FaveStar
                          itemId={dashboard.id}
                          isStarred={true}
                          saveFaveStar={async (id, isStarred) => {
                            await saveFavoriteStatus(id, isStarred);
                            // Recargar la lista después de cambiar el estado de favorito
                            setRefreshTrigger(prev => prev + 1);
                            if (refreshData) {
                              refreshData();
                            }
                          }}
                        />
                      </div>
                    </CardHeader>
                    <CardFooter>
                      {dashboard.slice_ids?.length > 0 && (
                        <span className="chart-count">
                          <Icons.BarChartOutlined iconSize="xs" />
                          {dashboard.slice_ids.length}
                        </span>
                      )}
                      {dashboard.published ? (
                        <span className="badge published">
                          <Icons.CheckCircleOutlined iconSize="xs" />
                          Publicado
                        </span>
                      ) : (
                        <span className="badge draft">
                          <Icons.EditOutlined iconSize="xs" />
                          Borrador
                        </span>
                      )}
                    </CardFooter>
                  </div>
                </CompactCard>
              </FavoriteCardWrapper>
            ))}
            </CardsScroller>
            
            <ScrollButton 
              direction="right" 
              visible={canScrollRight}
              onClick={(e) => {
                e.preventDefault();
                if (canScrollRight) scroll('right');
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                if (canScrollRight) startScrolling('right');
              }}
              onMouseUp={stopScrolling}
              onMouseLeave={stopScrolling}
              aria-label="Scroll right"
            >
              <Icons.CaretRightOutlined />
            </ScrollButton>
          </ScrollContainer>
        )}
      </BannerContent>
    </FavoritesBannerContainer>
  );
}
