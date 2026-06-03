<!--
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
-->

## @superset-ui/plugin-chart-html-cards

[![Version](https://img.shields.io/npm/v/@superset-ui/plugin-chart-html-cards.svg?style=flat)](https://www.npmjs.com/package/@superset-ui/plugin-chart-html-cards)
[![Libraries.io](https://img.shields.io/librariesio/release/npm/%40superset-ui%2Fplugin-chart-html-cards?style=flat)](https://libraries.io/npm/@superset-ui%2Fplugin-chart-html-cards)

This plugin renders query results as HTML cards using a Handlebars template and CSS hover states.

### Usage

Configure `key`, which can be any `string`, and register the plugin. This `key` will be used to
lookup this chart throughout the app.

```js
import HtmlCardsChartPlugin from '@superset-ui/plugin-chart-html-cards';

new HtmlCardsChartPlugin().configure({ key: 'html_cards' }).register();
```

Then use it via `SuperChart`. See
[storybook](https://apache-superset.github.io/superset-ui/?selectedKind=plugin-chart-handlebars) for
the Handlebars base plugin details.

```js
<SuperChart
  chartType="html_cards"
  width={600}
  height={600}
  formData={...}
  queriesData={[{
    data: {...},
  }]}
/>
```

### File structure generated

```
├── package.json
├── README.md
├── tsconfig.json
├── src
│   ├── HtmlCards.tsx
│   ├── images
│   │   └── thumbnail.png
│   ├── index.ts
│   ├── plugin
│   │   ├── buildQuery.ts
│   │   ├── controlPanel.ts
│   │   ├── index.ts
│   │   └── transformProps.ts
│   └── types.ts
├── test
│   └── index.test.ts
└── types
    └── external.d.ts
```

### Template context

The chart exposes these root values to the template:

- `rows`: alias of the query result array
- `data`: same array for compatibility with the Handlebars chart
- `rowCount`: number of rows
- `width` / `height`: chart size
- `firstRow`: first row or `null`

The same helper registration used by the Handlebars chart remains available, including `dateFormat`, `stringify`, `formatNumber`, `parseJson`, and the helpers from `just-handlebars-helpers`.
