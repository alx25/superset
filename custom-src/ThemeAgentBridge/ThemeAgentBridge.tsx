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
import { useEffect } from 'react';
import { useTheme, isThemeDark } from '@apache-superset/core/theme';

const THEME_CHANGE_EVENT = 'superset-agent:theme-change';
const THEME_READY_EVENT = 'superset-agent:theme-ready';

/**
 * Republishes Superset's resolved theme (light/dark mode + design tokens) as a
 * window CustomEvent so the externally-hosted chat widget (mounted in a Shadow
 * DOM via a plain <script> tag, outside of this React tree) can style itself
 * to match without Superset having to know the widget exists.
 *
 * Renders nothing. Mounted once at the app root, inside the Emotion theme
 * context, so `useTheme()` always reflects the live resolved theme — including
 * custom CRUD themes — rather than a raw localStorage preference.
 */
export function ThemeAgentBridge(): null {
  const theme = useTheme();

  useEffect(() => {
    const detail = {
      theme: isThemeDark(theme) ? 'dark' : 'light',
      tokens: {
        primary: theme.colorPrimary,
        primaryDark: theme.colorPrimaryActive,
        primarySoft: theme.colorPrimaryBg,
        primaryBorder: theme.colorPrimaryBorder,
        success: theme.colorSuccess,
        successDark: theme.colorSuccessActive,
        successSoft: theme.colorSuccessBg,
        background: theme.colorBgLayout,
        surface: theme.colorBgElevated,
        surfaceAlt: theme.colorBgContainer,
        border: theme.colorBorder,
        text: theme.colorText,
        textMuted: theme.colorTextSecondary,
        fontFamily: theme.fontFamily,
        borderRadius: `${theme.borderRadius}px`,
      },
    };

    const publish = (): void => {
      window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail }));
    };

    publish();
    window.addEventListener(THEME_READY_EVENT, publish);
    return () => {
      window.removeEventListener(THEME_READY_EVENT, publish);
    };
  }, [theme]);

  return null;
}
