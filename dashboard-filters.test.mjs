import { test } from 'node:test';
import assert from 'node:assert/strict';
import DashboardModel from './public/js/dashboard-model.js';

test('custom filter menus keep the existing state actions and close after a choice', () => {
  const app = new DashboardModel({ theme: 'light' });
  app.setState = patch => Object.assign(app.state, patch);
  let focused = 0;
  const dropdown = { open: true, querySelector: () => ({ focus: () => focused++ }) };
  const event = { currentTarget: { closest: () => dropdown } };
  let values = app.renderVals();
  assert.equal(values.statusMenuLabel, '전체 상태');
  values.statusOptions.find(option => option.label === '정리 완료').choose(event);
  assert.equal(app.state.statusF, 'done'); assert.equal(dropdown.open, false); assert.equal(focused, 1);
  values = app.renderVals();
  assert.equal(values.statusMenuLabel, '정리 완료');
  assert.equal(values.statusOptions.filter(option => option.pressed === 'true').length, 1);
  dropdown.open = true;
  values.sortOptions.find(option => option.label === '오래된 순').choose(event);
  assert.equal(app.state.sort, 'old'); assert.equal(dropdown.open, false); assert.equal(focused, 2);
  assert.equal(app.renderVals().sortMenuLabel, '오래된 순');
  app.renderVals().statusOptions[0].choose({ currentTarget: { closest: () => null } });
  assert.equal(app.state.statusF, 'all');
});
