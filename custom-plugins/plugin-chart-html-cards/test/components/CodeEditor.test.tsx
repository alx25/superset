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
import { render, screen, userEvent } from 'spec/helpers/testing-library';

jest.mock('react-ace', () => ({
  __esModule: true,
  default: ({
    name,
    value,
    onChange,
  }: {
    name: string;
    value?: string;
    onChange?: (value: string) => void;
  }) => (
    <textarea
      data-testid={name}
      value={value}
      onChange={event => onChange?.(event.target.value)}
    />
  ),
}));
jest.mock('ace-builds/src-min-noconflict/mode-handlebars', () => ({}));
jest.mock('ace-builds/src-min-noconflict/mode-css', () => ({}));
jest.mock('ace-builds/src-noconflict/theme-github', () => ({}));
jest.mock('ace-builds/src-noconflict/theme-monokai', () => ({}));

import { CodeEditor } from '../../src/components/CodeEditor/CodeEditor';

describe('HTML Cards CodeEditor', () => {
  it('opens the editor in a modal without replacing the inline editor', async () => {
    render(
      <CodeEditor
        mode="css"
        modalTitle="Card CSS"
        value=".card { color: red; }"
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Open in modal' })).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Open in modal' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Card CSS')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });
});
