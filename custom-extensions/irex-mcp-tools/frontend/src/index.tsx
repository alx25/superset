import React from 'react';
import { views } from '@apache-superset/core';
import { SqlLabAssistantPanel } from './assistant/SqlLabAssistantPanel';
import { activateExploreHost } from './hosts/exploreHost';

views.registerView(
  { id: 'irex.irex-mcp-tools.sql_lab_assistant', name: 'Asistente SQL Lab (spike)' },
  'sqllab.rightSidebar',
  () => <SqlLabAssistantPanel />,
);

// Explore no tiene un punto de montaje como `sqllab.rightSidebar` (ver
// PLAN_COPILOTO_EXPLORE.md, Fase 0): `exploreHost` monta su propia raíz de
// React al entrar a /explore. Spike — sin lógica del asistente todavía.
activateExploreHost();
