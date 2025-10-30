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
import { useMemo, useState } from 'react';
import {
  styled,
  SupersetTheme,
  t,
  useTheme,
  GenericDataType,
} from '@superset-ui/core';
import { ColorSchemeEnum } from '@superset-ui/plugin-chart-table';
import {
  Comparator,
  MultipleValueComparators,
} from '@superset-ui/chart-controls';
import { Form, FormItem, FormProps } from 'src/components/Form';
import Select from 'src/components/Select/Select';
import { Input, InputNumber } from 'src/components/Input';
import { Col, Row } from 'src/components';
import Button from 'src/components/Button';
import { SketchPicker, ColorResult } from 'react-color';
import { ConditionalFormattingConfig } from './types';

const FullWidthInputNumber = styled(InputNumber)`
  width: 100%;
`;

const JustifyEnd = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const CustomColorPicker = styled.div`
  margin-top: ${({ theme }) => theme.gridUnit * 2}px;
`;

const colorSchemeOptions = (theme: SupersetTheme) => [
  { value: theme.colors.success.light1, label: t('success') },
  { value: theme.colors.alert.light1, label: t('alert') },
  { value: theme.colors.error.light1, label: t('error') },
  { value: theme.colors.success.dark1, label: t('success dark') },
  { value: theme.colors.alert.dark1, label: t('alert dark') },
  { value: theme.colors.error.dark1, label: t('error dark') },
];

const operatorOptions = [
  { value: Comparator.None, label: t('None') },
  { value: Comparator.GreaterThan, label: '>' },
  { value: Comparator.LessThan, label: '<' },
  { value: Comparator.GreaterOrEqual, label: '≥' },
  { value: Comparator.LessOrEqual, label: '≤' },
  { value: Comparator.Equal, label: '=' },
  { value: Comparator.Like, label: 'LIKE' },
  { value: Comparator.NotEqual, label: '≠' },
  { value: Comparator.Between, label: '< x <' },
  { value: Comparator.BetweenOrEqual, label: '≤ x ≤' },
  { value: Comparator.BetweenOrLeftEqual, label: '≤ x <' },
  { value: Comparator.BetweenOrRightEqual, label: '< x ≤' },
];

const targetValueValidator =
  (
    compare: (targetValue: number, compareValue: number) => boolean,
    rejectMessage: string,
  ) =>
  (targetValue: number | string) =>
  (_: any, compareValue: number | string) => {
    if (
      !targetValue ||
      !compareValue ||
      compare(Number(targetValue), Number(compareValue))
    ) {
      return Promise.resolve();
    }
    return Promise.reject(new Error(rejectMessage));
  };

const targetValueLeftValidator = targetValueValidator(
  (target: number, val: number) => target > val,
  t('This value should be smaller than the right target value'),
);

const targetValueRightValidator = targetValueValidator(
  (target: number, val: number) => target < val,
  t('This value should be greater than the left target value'),
);

const isOperatorMultiValue = (operator?: Comparator) =>
  operator && MultipleValueComparators.includes(operator);

const isOperatorNone = (operator?: Comparator) =>
  !operator || operator === Comparator.None;

const rulesRequired = [{ required: true, message: t('Required') }];

type GetFieldValue = Pick<Required<FormProps>['form'], 'getFieldValue'>;
const rulesTargetValueLeft = [
  { required: true, message: t('Required') },
  ({ getFieldValue }: GetFieldValue) => ({
    validator: targetValueLeftValidator(getFieldValue('targetValueRight')),
  }),
];

const rulesTargetValueRight = [
  { required: true, message: t('Required') },
  ({ getFieldValue }: GetFieldValue) => ({
    validator: targetValueRightValidator(getFieldValue('targetValueLeft')),
  }),
];

const targetValueLeftDeps = ['targetValueRight'];
const targetValueRightDeps = ['targetValueLeft'];

const shouldFormItemUpdate = (
  prevValues: ConditionalFormattingConfig,
  currentValues: ConditionalFormattingConfig,
) =>
  isOperatorNone(prevValues.operator) !==
    isOperatorNone(currentValues.operator) ||
  isOperatorMultiValue(prevValues.operator) !==
    isOperatorMultiValue(currentValues.operator);

const renderOperator = ({ showOnlyNone }: { showOnlyNone?: boolean } = {}) => (
  <FormItem
    name="operator"
    label={t('Operator')}
    rules={rulesRequired}
    initialValue={operatorOptions[0].value}
  >
    <Select
      ariaLabel={t('Operator')}
      options={showOnlyNone ? [operatorOptions[0]] : operatorOptions}
    />
  </FormItem>
);

// renderOperatorFields will be defined inside the component so it can access the
// `columns` prop and GenericDataType to decide which input to render for target values.

export const FormattingPopoverContent = ({
  config,
  onChange,
  columns = [],
  extraColorChoices = [],
}: {
  config?: ConditionalFormattingConfig;
  onChange: (config: ConditionalFormattingConfig) => void;
  columns: { label: string; value: string; type?: number }[];
  extraColorChoices?: { label: string; value: string }[];
}) => {
  const theme = useTheme();
  const presetColorOptions = useMemo(() => colorSchemeOptions(theme), [theme]);
  const CUSTOM_COLOR_VALUE = '__custom_color__';
  const allColorValues = useMemo(
    () => [...presetColorOptions, ...extraColorChoices].map(opt => opt.value),
    [presetColorOptions, extraColorChoices],
  );
  const hasCustomInitialValue = Boolean(
    config?.colorScheme && !allColorValues.includes(config.colorScheme),
  );
  const defaultColumn = config?.column ?? columns[0]?.value;
  const initialCustomColor = hasCustomInitialValue
    ? (config?.colorScheme as string)
    : theme.colors.primary.base;
  const [customColor, setCustomColor] = useState(initialCustomColor);
  const [showOperatorFields, setShowOperatorFields] = useState(
    config === undefined ||
      (config?.colorScheme !== ColorSchemeEnum.Green &&
        config?.colorScheme !== ColorSchemeEnum.Red),
  );
  const [isCustomColor, setIsCustomColor] = useState(hasCustomInitialValue);
  const handleChange = (selection: any) => {
    const value =
      selection && typeof selection === 'object'
        ? selection.value ?? selection.key ?? selection
        : selection;
    const isBasicColor =
      value === ColorSchemeEnum.Green || value === ColorSchemeEnum.Red;
    setShowOperatorFields(!isBasicColor || value === CUSTOM_COLOR_VALUE);
    setIsCustomColor(value === CUSTOM_COLOR_VALUE);
  };

  const handleCustomColorChange = (value: ColorResult) => {
    setCustomColor(value.hex);
  };

  const initialColorSchemeValue = hasCustomInitialValue
    ? CUSTOM_COLOR_VALUE
    : config?.colorScheme ?? presetColorOptions[0].value;

  const selectColorOptions = useMemo(
    () => [
      ...presetColorOptions,
      ...extraColorChoices,
      { value: CUSTOM_COLOR_VALUE, label: t('Custom color') },
    ],
    [presetColorOptions, extraColorChoices],
  );

  const handleFinish = (values: ConditionalFormattingConfig) => {
    const rawColor = values.colorScheme as any;
    const normalizedColor =
      rawColor && typeof rawColor === 'object'
        ? rawColor.value ?? rawColor.key
        : rawColor;
    const resolvedColor =
      normalizedColor === CUSTOM_COLOR_VALUE ? customColor : normalizedColor;
    onChange({ ...values, colorScheme: resolvedColor });
  };

  const renderOperatorFields = ({ getFieldValue }: GetFieldValue) => {
    const operator = getFieldValue('operator');
    if (isOperatorNone(operator)) {
      return (
        <Row gutter={12}>
          <Col span={6}>{renderOperator()}</Col>
        </Row>
      );
    }
    if (isOperatorMultiValue(operator)) {
      return (
        <Row gutter={12}>
          <Col span={9}>
            <FormItem
              name="targetValueLeft"
              label={t('Left value')}
              rules={rulesTargetValueLeft}
              dependencies={targetValueLeftDeps}
              validateTrigger="onBlur"
              trigger="onBlur"
            >
              <FullWidthInputNumber />
            </FormItem>
          </Col>
          <Col span={6}>{renderOperator()}</Col>
          <Col span={9}>
            <FormItem
              name="targetValueRight"
              label={t('Right value')}
              rules={rulesTargetValueRight}
              dependencies={targetValueRightDeps}
              validateTrigger="onBlur"
              trigger="onBlur"
            >
              <FullWidthInputNumber />
            </FormItem>
          </Col>
        </Row>
      );
    }
    return (
      <Row gutter={12}>
        <Col span={6}>{renderOperator()}</Col>
        <Col span={18}>
          <FormItem
            noStyle
            shouldUpdate={(prev, cur) => prev.column !== cur.column}
          >
            {({ getFieldValue }) => {
              const column = getFieldValue('column');
              const selectedCol = columns.find(c => c.value === column) as any;
              const isNumeric = selectedCol?.type === GenericDataType.Numeric;
              return (
                <FormItem
                  name="targetValue"
                  label={t('Target value')}
                  rules={rulesRequired}
                >
                  {isNumeric ? (
                    <FullWidthInputNumber />
                  ) : (
                    <Input
                      placeholder={t(
                        'Text or pattern (use % as wildcard for LIKE)',
                      )}
                    />
                  )}
                </FormItem>
              );
            }}
          </FormItem>
        </Col>
      </Row>
    );
  };

  return (
    <Form
      onFinish={handleFinish}
      initialValues={{
        ...config,
        column: defaultColumn,
        colorScheme: initialColorSchemeValue,
      }}
      requiredMark="optional"
      layout="vertical"
    >
      <Row gutter={12}>
        <Col span={12}>
          <FormItem name="column" label={t('Column')} rules={rulesRequired}>
            <Select ariaLabel={t('Select column')} options={columns} />
          </FormItem>
        </Col>
        <Col span={12}>
          <FormItem
            name="colorScheme"
            label={t('Color scheme')}
            rules={rulesRequired}
          >
            <Select
              onChange={event => handleChange(event)}
              ariaLabel={t('Color scheme')}
              options={selectColorOptions}
            />
          </FormItem>
        </Col>
      </Row>
      {isCustomColor && (
        <Row gutter={12}>
          <Col span={24}>
            <CustomColorPicker>
              <SketchPicker
                color={customColor}
                onChangeComplete={handleCustomColorChange}
                disableAlpha
              />
            </CustomColorPicker>
          </Col>
        </Row>
      )}
      <FormItem noStyle shouldUpdate={shouldFormItemUpdate}>
        {showOperatorFields ? (
          renderOperatorFields
        ) : (
          <Row gutter={12}>
            <Col span={6}>{renderOperator({ showOnlyNone: true })}</Col>
          </Row>
        )}
      </FormItem>
      <FormItem>
        <JustifyEnd>
          <Button htmlType="submit" buttonStyle="primary">
            {t('Apply')}
          </Button>
        </JustifyEnd>
      </FormItem>
    </Form>
  );
};
