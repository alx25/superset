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
  getNumberFormatter,
  getTimeFormatter,
  sanitizeHtmlIfNeeded,
  styled,
  t,
} from '@superset-ui/core';
import Handlebars from 'handlebars';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import { isPlainObject } from 'lodash';
import Helpers from 'just-handlebars-helpers';
import HandlebarsGroupBy from 'handlebars-group-by';
import { normalizeRenderedTemplate } from '../../utils/normalizeRenderedTemplate';

export interface HandlebarsViewerProps {
  templateSource: string;
  data: any;
}

const ErrorContainer = styled.pre`
  white-space: pre-wrap;
`;

const HtmlContainer = styled.div`
  height: 100%;
  width: 100%;
  min-height: 0;
  overflow: visible;
`;

export const HandlebarsViewer = ({
  templateSource,
  data,
}: HandlebarsViewerProps) => {
  const appContainer = document.getElementById('app');
  const { common } = JSON.parse(
    appContainer?.getAttribute('data-bootstrap') || '{}',
  );
  const htmlSanitization = common?.conf?.HTML_SANITIZATION ?? true;

  const { renderedTemplate, error } = useMemo(() => {
    try {
      const template = Handlebars.compile(templateSource);
      const result = template(data);
      const normalizedTemplate = normalizeRenderedTemplate(result);
      return {
        renderedTemplate: htmlSanitization
          ? sanitizeHtmlIfNeeded(normalizedTemplate)
          : normalizedTemplate,
        error: '',
      };
    } catch (error) {
      return {
        renderedTemplate: '',
        error:
          error instanceof globalThis.Error ? error.message : String(error),
      };
    }
  }, [templateSource, data, htmlSanitization]);

  if (error) {
    return <ErrorContainer>{error}</ErrorContainer>;
  }

  if (renderedTemplate) {
    return <HtmlContainer dangerouslySetInnerHTML={{ __html: renderedTemplate }} />;
  }
  return <p>{t('Loading...')}</p>;
};

//  usage: {{dateFormat my_date format="MMMM YYYY"}}
Handlebars.registerHelper('dateFormat', function (context, block) {
  const f = block.hash.format || 'YYYY-MM-DD';
  return dayjs(context).format(f);
});

// usage: {{  }}
Handlebars.registerHelper('stringify', (obj: any, obj2: any) => {
  // calling without an argument
  if (obj2 === undefined)
    throw new globalThis.Error(
      'Please call with an object. Example: `stringify myObj`',
    );
  return isPlainObject(obj) ? JSON.stringify(obj) : String(obj);
});

Handlebars.registerHelper(
  'formatNumber',
  function (number: any, locale = 'en-US') {
    if (typeof number !== 'number') {
      return number;
    }
    return number.toLocaleString(locale);
  },
);

Handlebars.registerHelper(
  'numberFormatD3',
  function (number: any, formatString?: string) {
    if (number === null || number === undefined || number === '') {
      return number;
    }
    return getNumberFormatter(formatString)(number);
  },
);

Handlebars.registerHelper(
  'timeFormatD3',
  function (value: any, formatString?: string) {
    if (value === null || value === undefined || value === '') {
      return value;
    }
    return getTimeFormatter(formatString)(value);
  },
);

Handlebars.registerHelper('coalesce', (...args: any[]) => {
  const values = args.slice(0, -1);
  return values.find(
    value => value !== null && value !== undefined && value !== '',
  );
});

Handlebars.registerHelper('hasValue', (value: any) => {
  return value !== null && value !== undefined && value !== '';
});

// usage: {{parseJson jsonString}}
Handlebars.registerHelper('parseJson', (jsonString: string) => {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    if (error instanceof globalThis.Error) {
      error.message = `Invalid JSON string: ${error.message}`;
      throw error;
    }
    throw new globalThis.Error(`Invalid JSON string: ${String(error)}`);
  }
});

Helpers.registerHelpers(Handlebars);
HandlebarsGroupBy.register(Handlebars);

Handlebars.registerHelper('pluck', (array: any, key: string) => {
  if (!Array.isArray(array) || !key) {
    return [];
  }

  return array.map(item =>
    item !== null && item !== undefined && typeof item === 'object'
      ? item[key]
      : undefined,
  );
});

Handlebars.registerHelper('sum', (...args: any[]) => {
  const values = args.slice(0, -1);
  const target =
    values.length === 1 && Array.isArray(values[0]) ? values[0] : values;

  if (!Array.isArray(target)) {
    return 0;
  }

  return target.reduce((accumulator, value) => {
    return accumulator + (Number(value) || 0);
  }, 0);
});
