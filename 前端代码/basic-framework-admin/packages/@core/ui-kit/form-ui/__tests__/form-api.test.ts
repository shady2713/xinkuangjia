/**
 * 验证 FormApi 挂载、值读写、并发挂载前等待与校验行为。
 *
 * @author shady2713
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormApi } from '../src/form-api';

describe('formApi', () => {
  let formApi: FormApi;

  beforeEach(() => {
    formApi = new FormApi();
  });

  it('should initialize with default state', () => {
    expect(formApi.state).toEqual(
      expect.objectContaining({
        actionWrapperClass: '',
        collapsed: false,
        collapsedRows: 1,
        commonConfig: {},
        handleReset: undefined,
        handleSubmit: undefined,
        layout: 'horizontal',
        resetButtonOptions: {},
        schema: [],
        showCollapseButton: false,
        showDefaultActions: true,
        submitButtonOptions: {},
        wrapperClass: 'grid-cols-1',
      }),
    );
    expect(formApi.isMounted).toBe(false);
  });

  it('should mount form actions', async () => {
    const formActions: any = {
      meta: {},
      resetForm: vi.fn(),
      setFieldValue: vi.fn(),
      setValues: vi.fn(),
      submitForm: vi.fn(),
      validate: vi.fn(),
      values: { name: 'test' },
    };

    await formApi.mount(formActions);
    expect(formApi.isMounted).toBe(true);
    expect(formApi.form).toEqual(formActions);
  });

  it('should get values from form', async () => {
    const formActions: any = {
      meta: {},
      values: { name: 'test' },
    };

    await formApi.mount(formActions);
    const values = await formApi.getValues();
    expect(values).toEqual({ name: 'test' });
  });

  it('should set field value', async () => {
    const setFieldValueMock = vi.fn();
    const formActions: any = {
      meta: {},
      setFieldValue: setFieldValueMock,
      values: { name: 'test' },
    };

    await formApi.mount(formActions);
    await formApi.setFieldValue('name', 'new value');
    expect(setFieldValueMock).toHaveBeenCalledWith(
      'name',
      'new value',
      undefined,
    );
  });

  it('should reset form', async () => {
    const resetFormMock = vi.fn();
    const formActions: any = {
      meta: {},
      resetForm: resetFormMock,
      values: { name: 'test' },
    };

    await formApi.mount(formActions);
    await formApi.resetForm();
    expect(resetFormMock).toHaveBeenCalled();
  });

  it('should call handleSubmit on submit', async () => {
    const handleSubmitMock = vi.fn();
    const formActions: any = {
      meta: {},
      submitForm: vi.fn().mockResolvedValue(true),
      values: { name: 'test' },
    };

    const state = {
      handleSubmit: handleSubmitMock,
    };

    formApi.setState(state);
    await formApi.mount(formActions);

    const result = await formApi.submitForm();
    expect(formActions.submitForm).toHaveBeenCalled();
    expect(handleSubmitMock).toHaveBeenCalledWith({ name: 'test' });
    expect(result).toEqual({ name: 'test' });
  });

  it('should unmount form and reset state', () => {
    formApi.unmount();
    expect(formApi.isMounted).toBe(false);
  });

  it('should validate form', async () => {
    const validateMock = vi.fn().mockResolvedValue(true);
    const formActions: any = {
      meta: {},
      validate: validateMock,
    };

    await formApi.mount(formActions);
    const isValid = await formApi.validate();
    expect(validateMock).toHaveBeenCalled();
    expect(isValid).toBe(true);
  });

  it('should resolve concurrent calls issued before mount and across unmount cycles', async () => {
    const setFieldValueMock = vi.fn();
    const validateMock = vi.fn().mockResolvedValue({ valid: true });
    const formActions: any = {
      meta: {},
      resetForm: vi.fn(),
      setFieldValue: setFieldValueMock,
      validate: validateMock,
      values: { name: 'initial' },
    };

    const getValuesPromise = formApi.getValues();
    const setFieldPromise = formApi.setFieldValue('name', 'next');
    const validatePromise = formApi.validate();

    formApi.mount(formActions, new Map());

    const [values, , validation] = await Promise.all([
      getValuesPromise,
      setFieldPromise,
      validatePromise,
    ]);
    expect(values).toEqual({ name: 'initial' });
    expect(setFieldValueMock).toHaveBeenCalledWith('name', 'next', undefined);
    expect(validation).toEqual({ valid: true });

    formApi.unmount();
    const secondCycleValues = formApi.getValues();
    formApi.mount({ ...formActions, values: { name: 'remounted' } }, new Map());
    await expect(secondCycleValues).resolves.toEqual({ name: 'remounted' });
  });
});

describe('updateSchema', () => {
  let instance: FormApi;

  beforeEach(() => {
    instance = new FormApi();
    instance.state = {
      schema: [
        { component: 'text', fieldName: 'name' },
        { component: 'number', fieldName: 'age', label: 'Age' },
      ],
    };
  });

  it('should update the schema correctly when fieldName matches', () => {
    const newSchema = [
      { component: 'text', fieldName: 'name' },
      { component: 'number', fieldName: 'age', label: 'Age' },
    ];

    instance.updateSchema(newSchema);

    expect(instance.state?.schema?.[0]?.component).toBe('text');
    expect(instance.state?.schema?.[1]?.label).toBe('Age');
  });

  it('should log an error if fieldName is missing in some items', () => {
    const newSchema: any[] = [
      { component: 'textarea', fieldName: 'name' },
      { component: 'number' },
    ];

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    instance.updateSchema(newSchema);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'All items in the schema array must have a valid `fieldName` property to be updated',
    );
  });

  it('should not update schema if fieldName does not match', () => {
    const newSchema = [{ component: 'textarea', fieldName: 'unknown' }];

    instance.updateSchema(newSchema);

    expect(instance.state?.schema?.[0]?.component).toBe('text');
    expect(instance.state?.schema?.[1]?.component).toBe('number');
  });

  it('should not update schema if updatedMap is empty', () => {
    const newSchema: any[] = [{ component: 'textarea' }];

    instance.updateSchema(newSchema);

    expect(instance.state?.schema?.[0]?.component).toBe('text');
    expect(instance.state?.schema?.[1]?.component).toBe('number');
  });
});
