const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../src/models/store');
const { _test } = store;

test('hidden activity automation is always disabled', () => {
  const automation = Object.fromEntries(
    [..._test.HIDDEN_ACTIVITY_AUTOMATION_KEYS].map(key => [key, true])
  );

  _test.disableHiddenActivityAutomation(automation, 1787709600);

  for (const key of _test.HIDDEN_ACTIVITY_AUTOMATION_KEYS) {
    assert.equal(automation[key], false, `${key} should be disabled`);
  }
});

test('rain poem automation stays enabled only during the activity window', () => {
  const keys = _test.RAIN_POEM_AUTOMATION_KEYS;
  for (const nowSeconds of [1787709599, 1788883200]) {
    const automation = Object.fromEntries(keys.map(key => [key, true]));
    _test.disableHiddenActivityAutomation(automation, nowSeconds);
    for (const key of keys) {
      assert.equal(automation[key], false, `${key} should be disabled at ${nowSeconds}`);
    }
  }

  const activeAutomation = Object.fromEntries(keys.map(key => [key, true]));
  _test.disableHiddenActivityAutomation(activeAutomation, 1787709600);
  for (const key of keys) {
    assert.equal(activeAutomation[key], true, `${key} should remain enabled while active`);
  }
});

test('charity flower automation stays enabled only during the activity window', () => {
  const keys = _test.CHARITY_FLOWER_AUTOMATION_KEYS;
  for (const nowSeconds of [1788191999, 1788969600]) {
    const automation = Object.fromEntries(keys.map(key => [key, true]));
    _test.disableHiddenActivityAutomation(automation, nowSeconds);
    for (const key of keys) assert.equal(automation[key], false, `${key} should be disabled at ${nowSeconds}`);
  }

  for (const nowSeconds of [1788192000, 1788969599]) {
    const automation = Object.fromEntries(keys.map(key => [key, true]));
    _test.disableHiddenActivityAutomation(automation, nowSeconds);
    for (const key of keys) assert.equal(automation[key], true, `${key} should remain enabled at ${nowSeconds}`);
  }
});

test('hidden activity defaults stay disabled', () => {
  const automation = store.getDefaultAccountConfig().automation;

  for (const key of _test.HIDDEN_ACTIVITY_AUTOMATION_KEYS) {
    assert.equal(automation[key], false, `${key} should default to disabled`);
  }
  for (const key of _test.RAIN_POEM_AUTOMATION_KEYS) {
    assert.equal(automation[key], false, `${key} should default to disabled`);
  }
  for (const key of _test.CHARITY_FLOWER_AUTOMATION_KEYS) {
    assert.equal(automation[key], false, `${key} should default to disabled`);
  }
});
