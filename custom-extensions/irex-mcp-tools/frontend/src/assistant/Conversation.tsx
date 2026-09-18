import React from 'react';
import { theme as themeNs } from '@apache-superset/core';
import type { AssistantMode } from '../contracts/assistant';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  text: string;
}

const MODE_LABELS: Record<AssistantMode, string> = {
  create: 'Crear SQL',
  review_document: 'Revisar consulta completa',
  review_selection: 'Revisar selección',
  explain_error: 'Explicar/corregir el último error',
};

const MODE_ORDER: AssistantMode[] = ['create', 'review_document', 'review_selection', 'explain_error'];

const ROLE_AVATAR: Record<ConversationMessage['role'], string> = {
  user: '🧑',
  assistant: '✨',
};

export interface ConversationProps {
  history: ConversationMessage[];
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  userMessage: string;
  onUserMessageChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  sendDisabledReason?: string;
  explainErrorDisabled: boolean;
}

export function Conversation({
  history,
  mode,
  onModeChange,
  userMessage,
  onUserMessageChange,
  onSend,
  sending,
  sendDisabledReason,
  explainErrorDisabled,
}: ConversationProps): React.ReactElement {
  const theme = themeNs.useTheme();
  const canSend = !sending && !sendDisabledReason;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {history.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            maxHeight: 260,
            overflowY: 'auto',
            padding: '2px 2px 4px',
          }}
        >
          {history.map((entry, index) => (
            <div
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              style={{
                display: 'flex',
                flexDirection: entry.role === 'user' ? 'row-reverse' : 'row',
                gap: 6,
                alignItems: 'flex-start',
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  background:
                    entry.role === 'user' ? theme.colorFillSecondary : theme.colorPrimaryBg,
                }}
              >
                {ROLE_AVATAR[entry.role]}
              </div>
              <div
                style={{
                  background: entry.role === 'user' ? theme.colorFillTertiary : theme.colorBgContainer,
                  border: entry.role === 'assistant' ? `1px solid ${theme.colorBorderSecondary}` : 'none',
                  color: theme.colorText,
                  borderRadius: theme.borderRadius,
                  borderTopRightRadius: entry.role === 'user' ? 2 : theme.borderRadius,
                  borderTopLeftRadius: entry.role === 'assistant' ? 2 : theme.borderRadius,
                  padding: '6px 10px',
                  maxWidth: '85%',
                  fontSize: 12,
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {entry.text}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          borderTop: history.length > 0 ? `1px solid ${theme.colorBorderSecondary}` : 'none',
          paddingTop: history.length > 0 ? 10 : 0,
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: theme.colorTextSecondary,
              textTransform: 'uppercase',
              letterSpacing: 0.3,
            }}
          >
            Qué necesitás
          </span>
          <select
            value={mode}
            onChange={event => onModeChange(event.target.value as AssistantMode)}
            style={{
              fontSize: 12,
              padding: 5,
              borderRadius: theme.borderRadius,
              border: `1px solid ${theme.colorBorder}`,
              background: theme.colorBgContainer,
              color: theme.colorText,
            }}
          >
            {MODE_ORDER.map(option => (
              <option key={option} value={option} disabled={option === 'explain_error' && explainErrorDisabled}>
                {MODE_LABELS[option]}
                {option === 'explain_error' && explainErrorDisabled ? ' (sin error reciente)' : ''}
              </option>
            ))}
          </select>
        </label>

        <textarea
          value={userMessage}
          onChange={event => onUserMessageChange(event.target.value)}
          placeholder="Describí qué necesitás..."
          rows={3}
          style={{
            fontSize: 12,
            padding: 6,
            resize: 'vertical',
            borderRadius: theme.borderRadius,
            border: `1px solid ${theme.colorBorder}`,
            background: theme.colorBgContainer,
            color: theme.colorText,
          }}
        />

        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          style={{
            padding: '6px 0',
            fontWeight: 600,
            fontSize: 12,
            borderRadius: theme.borderRadius,
            border: 'none',
            cursor: canSend ? 'pointer' : 'default',
            background: canSend ? theme.colorPrimary : theme.colorFillSecondary,
            color: canSend ? theme.colorWhite ?? '#fff' : theme.colorTextTertiary,
          }}
        >
          {sending ? 'Enviando…' : 'Enviar'}
        </button>
        {sendDisabledReason && (
          <span style={{ fontSize: 11, color: theme.colorTextTertiary }}>{sendDisabledReason}</span>
        )}
      </div>
    </div>
  );
}
