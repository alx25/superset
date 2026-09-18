import React from 'react';
import { views } from '@apache-superset/core';
import { SqlLabAssistantPanel } from './assistant/SqlLabAssistantPanel';

views.registerView(
  { id: 'irex.irex-mcp-tools.sql_lab_assistant', name: 'Asistente SQL Lab (spike)' },
  'sqllab.rightSidebar',
  () => <SqlLabAssistantPanel />,
);
