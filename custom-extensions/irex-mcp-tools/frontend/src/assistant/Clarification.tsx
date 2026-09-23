import React, { useState } from 'react';
import { theme as themeNs } from '@apache-superset/core';
import { readableOn } from './ui';
import type { AssistantClarification, AssistantClarificationQuestion } from '../contracts/assistant';

const OTHER_OPTION = 'Otro: especificar';

function hasCustomOption(options: string[]): boolean {
  return options.some(option => option.trim().toLowerCase() === OTHER_OPTION.toLowerCase());
}

export interface ClarificationProps {
  clarification: AssistantClarification;
  /** Deshabilita todo mientras hay un pedido en curso (mismo criterio que
   * `busy` en `ActionCard`). */
  busy: boolean;
  /**
   * Arma y envía el texto de respuesta — una sola pregunta manda la
   * respuesta elegida tal cual; varias preguntas mandan "1. resp; 2. resp"
   * (contrato acordado con el backend, 2026-09-21). Nunca manda ids de
   * opción ni un payload de selección aparte.
   */
  onSubmit: (answerText: string) => void;
}

export function Clarification({ clarification, busy, onSubmit }: ClarificationProps): React.ReactElement {
  const theme = themeNs.useTheme();
  // Por pregunta: la opción elegida (texto tal cual, incluido "Otro: especificar").
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});

  const isAnswered = (question: AssistantClarificationQuestion): boolean => {
    const choice = selected[question.id];
    if (!choice) return false;
    return choice === OTHER_OPTION ? (customText[question.id] ?? '').trim().length > 0 : true;
  };

  const allAnswered = clarification.questions.every(isAnswered);

  const handleSelect = (questionId: string, option: string) => {
    setSelected(prev => ({ ...prev, [questionId]: option }));
  };

  const handleSubmit = () => {
    const answers = clarification.questions.map(question => {
      const choice = selected[question.id];
      return choice === OTHER_OPTION ? customText[question.id].trim() : choice;
    });
    const text = answers.length === 1 ? answers[0] : answers.map((a, i) => `${i + 1}. ${a}`).join('; ');
    onSubmit(text);
  };

  return (
    <div
      style={{
        border: `1px solid ${theme.colorWarningBorder ?? theme.colorWarning}`,
        borderLeft: `3px solid ${theme.colorWarning}`,
        borderRadius: theme.borderRadius,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        background: theme.colorWarningBg ?? theme.colorBgContainer,
      }}
    >
      <div>
        <strong style={{ fontSize: 13.5, color: theme.colorText }}>Necesito confirmar una definición</strong>
        <div style={{ marginTop: 2, fontSize: 11.5, color: theme.colorTextSecondary }}>
          Elegí una opción por pregunta, o especificá tu propia respuesta.
        </div>
      </div>

      {clarification.questions.map((question, index) => {
        const options = hasCustomOption(question.options) ? question.options : [...question.options, OTHER_OPTION];
        const choice = selected[question.id];
        return (
          <div key={question.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12.5, color: theme.colorText }}>
              {clarification.questions.length > 1 ? `${index + 1}. ` : ''}
              {question.text}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {options.map(option => {
                const isSelected = choice === option;
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={busy}
                    aria-pressed={isSelected}
                    onClick={() => handleSelect(question.id, option)}
                    style={{
                      textAlign: 'left',
                      padding: '6px 10px',
                      borderRadius: theme.borderRadiusSM,
                      border: `1px solid ${isSelected ? theme.colorPrimary : theme.colorBorder}`,
                      background: isSelected ? theme.colorPrimaryBg : theme.colorBgContainer,
                      color: theme.colorText,
                      fontSize: 12,
                      cursor: busy ? 'default' : 'pointer',
                    }}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            {choice === OTHER_OPTION && (
              <input
                type="text"
                disabled={busy}
                value={customText[question.id] ?? ''}
                onChange={event => setCustomText(prev => ({ ...prev, [question.id]: event.target.value }))}
                placeholder="Especificá tu respuesta…"
                style={{
                  fontSize: 12,
                  padding: '6px 8px',
                  borderRadius: theme.borderRadiusSM,
                  border: `1px solid ${theme.colorBorder}`,
                  background: theme.colorBgContainer,
                  color: theme.colorText,
                }}
              />
            )}
          </div>
        );
      })}

      <button
        type="button"
        disabled={busy || !allAnswered}
        onClick={handleSubmit}
        style={{
          alignSelf: 'flex-end',
          padding: '7px 14px',
          fontWeight: 600,
          fontSize: 12.5,
          borderRadius: theme.borderRadius,
          border: 'none',
          cursor: busy || !allAnswered ? 'default' : 'pointer',
          background: !busy && allAnswered ? theme.colorPrimary : theme.colorFillSecondary,
          color: !busy && allAnswered ? readableOn(theme.colorPrimary) : theme.colorTextSecondary,
        }}
      >
        Continuar →
      </button>
    </div>
  );
}
