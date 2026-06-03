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
import { FC } from 'react';
import { styled, useTheme, css } from '@superset-ui/core';
import { Skeleton } from '../Skeleton';
import { CertifiedBadge } from '../CertifiedBadge';
import { Tooltip } from '../Tooltip';
import { ImageLoader } from './ImageLoader';
import type { ListViewCardProps, LinkProps } from './types';

const ActionsWrapper = styled.div`
  width: 64px;
  display: flex;
  justify-content: flex-end;
`;

// Styling part 2: Use CSS when necessary
const StyledCard = styled.div`
  ${({ theme }) => `
    overflow: hidden;
    border-radius: 10px;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
    border: 1px solid ${theme.colorBorder};
    background: ${theme.colorBgContainer};
    display: flex;
    flex-direction: row;
    min-height: 140px;

    .gradient-container {
      position: relative;
      height: 100%;
      overflow: hidden;
      
      &::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 30px;
        background: linear-gradient(to top, rgba(0, 0, 0, 0.15), transparent);
        opacity: 0;
        transition: opacity 0.25s ease;
      }
    }
    
    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.08);
      border-color: ${theme.colorPrimary};

      .gradient-container::after {
        opacity: 1;
      }

      .cover-footer {
        opacity: 1;
      }
      
      img {
        transform: scale(1.05);
      }
    }
  `}
`;

const CardBody = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 3}px;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    position: relative;
  `}
`;

const Cover = styled.div`
  width: 120px;
  min-width: 120px;
  height: 120px;
  margin: ${({ theme }) => theme.sizeUnit * 2.5}px;
  margin-right: ${({ theme }) => theme.sizeUnit * 3}px;
  border-radius: 8px;
  overflow: hidden;
  background: ${({ theme }) => theme.colorBgLayout};
  position: relative;
  flex-shrink: 0;

  img {
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    height: 100%;
    width: 100%;
    object-fit: cover;
  }

  .cover-footer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    opacity: 0;
    transition: ${({ theme }) => theme.motionDurationMid} ease-out;
  }
`;

const TitleContainer = styled.div`
  display: flex;
  justify-content: flex-start;
  flex-direction: column;
  flex: 1;
  position: relative;

  .card-actions {
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.sizeUnit * 2}px;
    span[role='img'] {
      display: flex;
      align-items: center;
    }
  }

  .titleRow {
    display: flex;
    justify-content: flex-start;
    flex-direction: column;
  }

  .badgeRow {
    display: flex;
    justify-content: flex-end;
    margin-bottom: ${({ theme }) => theme.sizeUnit * 2}px;
    min-height: ${({ theme }) => theme.sizeUnit * 4}px;
  }
`;

const TitleLink = styled.span`
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  line-height: 1.3;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  padding-right: ${({ theme }) => theme.sizeUnit * 2}px;
  
  & a {
    color: ${({ theme }) => theme.colorText} !important;
    text-decoration: none;
    
    &:hover {
      color: ${({ theme }) => theme.colorPrimary} !important;
    }
  }
`;

const TitleRight = styled.span`
  ${({ theme }) => css`
    font-weight: 200;
    font-size: 8px;
    color: ${theme.colorTextSecondary};
  `}
`;
const CoverFooter = styled.div`
  display: flex;
  flex-wrap: nowrap;
  padding: ${({ theme }) => theme.sizeUnit}px ${({ theme }) => theme.sizeUnit * 1.5}px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
`;

const CoverFooterLeft = styled.div`
  flex: 1;
  overflow: hidden;
`;

const CoverFooterRight = styled.div`
  align-self: flex-end;
  margin-left: auto;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  color: white;
`;

const MetaFooter = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
  padding-top: ${({ theme }) => theme.sizeUnit * 2}px;
  color: ${({ theme }) => theme.colorTextSecondary};
  font-size: 12px;
`;

const ThinSkeleton = styled(Skeleton)`
  h3 {
    margin: ${({ theme }) => theme.sizeUnit}px 0;
  }

  ul {
    margin-bottom: 0;
  }
`;

const paragraphConfig = { rows: 1, width: 150 };

const AnchorLink: FC<LinkProps> = ({ to, children }) => (
  <a href={to}>{children}</a>
);

function ListViewCard({
  title,
  subtitle,
  url,
  linkComponent,
  titleRight,
  imgURL,
  imgFallbackURL,
  description,
  coverLeft,
  coverRight,
  actions,
  avatar,
  loading,
  imgPosition = 'top',
  cover,
  certifiedBy,
  certificationDetails,
}: ListViewCardProps) {
  const Link = url && linkComponent ? linkComponent : AnchorLink;
  const theme = useTheme();
  return (
    <StyledCard data-test="styled-card">
      {(cover || imgURL || imgFallbackURL) && (
        <Cover>
          <Link to={url!}>
            <div className="gradient-container">
              <ImageLoader
                src={imgURL || ''}
                fallback={imgFallbackURL || ''}
                isLoading={loading}
                position={imgPosition}
              />
            </div>
          </Link>
          <CoverFooter className="cover-footer">
            {!loading && coverLeft && (
              <CoverFooterLeft>{coverLeft}</CoverFooterLeft>
            )}
            {!loading && coverRight && (
              <CoverFooterRight>{coverRight}</CoverFooterRight>
            )}
          </CoverFooter>
        </Cover>
      )}
      <CardBody>
        {loading && (
          <>
            <TitleContainer>
              <Skeleton.Input
                active
                size="small"
                css={{
                  width: Math.trunc(theme.sizeUnit * 62.5),
                }}
              />
            </TitleContainer>
            <MetaFooter>
              <ThinSkeleton
                round
                active
                title={false}
                paragraph={paragraphConfig}
              />
              <div className="card-actions">
                <Skeleton.Button active shape="circle" />{' '}
                <Skeleton.Button
                  active
                  css={{
                    width: theme.sizeUnit * 10,
                  }}
                />
              </div>
            </MetaFooter>
          </>
        )}
        {!loading && (
          <>
            <TitleContainer>
              {subtitle || null}
              <div className="badgeRow">
                {titleRight && <TitleRight>{titleRight}</TitleRight>}
              </div>
              <div className="titleRow">
                <Tooltip title={title}>
                  <TitleLink>
                    {certifiedBy && (
                      <>
                        <CertifiedBadge
                          certifiedBy={certifiedBy}
                          details={certificationDetails}
                        />{' '}
                      </>
                    )}
                    {title}
                  </TitleLink>
                </Tooltip>
              </div>
            </TitleContainer>
            <MetaFooter>
              <span>{description}</span>
              <div className="card-actions" data-test="card-actions">
                {actions}
              </div>
            </MetaFooter>
          </>
        )}
      </CardBody>
    </StyledCard>
  );
}

ListViewCard.Actions = ActionsWrapper;

export { ListViewCard, ImageLoader };
export type { ListViewCardProps };
