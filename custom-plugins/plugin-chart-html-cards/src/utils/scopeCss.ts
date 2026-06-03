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
import postcss, { AtRule } from 'postcss';
import selectorParser, {
  Node as SelectorNode,
  Selector,
  Tag,
  Pseudo,
} from 'postcss-selector-parser';

const KEYFRAME_AT_RULES = new Set([
  'keyframes',
  '-webkit-keyframes',
  '-moz-keyframes',
  '-o-keyframes',
]);

function cloneScopeNodes(scopeSelector: string): Selector['nodes'] {
  const scopeRoot = selectorParser().astSync(scopeSelector);
  return scopeRoot.first?.nodes.map(node => node.clone()) ?? [];
}

function prependScopeNodes(
  currentSelector: Selector,
  scopeSelector: string,
  addCombinator: boolean,
) {
  const scopeNodes = cloneScopeNodes(scopeSelector);
  if (addCombinator && currentSelector.nodes.length > 0) {
    currentSelector.prepend(selectorParser.combinator({ value: ' ' }));
  }
  [...scopeNodes].reverse().forEach(node => {
    currentSelector.prepend(node);
  });
}

function isRootLikeNode(node: SelectorNode) {
  return (
    (node.type === 'tag' &&
      ['html', 'body'].includes((node as Tag).value.toLowerCase())) ||
    (node.type === 'pseudo' && (node as Pseudo).value === ':root')
  );
}

function selectorAlreadyScoped(selector: Selector, scopeSelector: string) {
  return selector.toString().trim().startsWith(scopeSelector);
}

function prefixSelector(selector: string, scopeSelector: string) {
  return selectorParser(selectors => {
    selectors.each(currentSelector => {
      if (selectorAlreadyScoped(currentSelector, scopeSelector)) {
        return;
      }

      let replacedRootLikeNode = false;
      currentSelector.walk(node => {
        if (!isRootLikeNode(node)) {
          return;
        }
        replacedRootLikeNode = true;
        node.replaceWith(...cloneScopeNodes(scopeSelector));
      });

      if (!replacedRootLikeNode) {
        prependScopeNodes(currentSelector, scopeSelector, true);
      }
    });
  }).processSync(selector);
}

export function scopeCss(cssSource: string, scopeSelector: string) {
  if (!cssSource.trim()) {
    return '';
  }

  try {
    const root = postcss.parse(cssSource);
    root.walkRules(rule => {
      const parent = rule.parent;
      if (
        parent?.type === 'atrule' &&
        KEYFRAME_AT_RULES.has((parent as AtRule).name.toLowerCase())
      ) {
        return;
      }

      if (!Array.isArray(rule.selectors) || rule.selectors.length === 0) {
        return;
      }

      rule.selectors = rule.selectors.map(selector =>
        prefixSelector(selector, scopeSelector),
      );
    });
    return root.toString();
  } catch {
    return cssSource;
  }
}
