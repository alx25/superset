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
export function normalizeRenderedTemplate(source: string) {
  const normalized = String(source || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  const indentation = lines
    .filter(line => line.trim().length > 0)
    .map(line => {
      const match = line.match(/^\s*/);
      return match ? match[0].length : 0;
    });

  const commonIndent = indentation.length ? Math.min(...indentation) : 0;
  if (commonIndent <= 0) {
    return lines.join('\n');
  }

  return lines
    .map(line =>
      line.trim().length === 0
        ? ''
        : line.replace(new RegExp(`^\\s{0,${commonIndent}}`), ''),
    )
    .join('\n');
}
