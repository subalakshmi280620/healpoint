import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSlotKeys,
  getIstDateParts,
  istDateTimeToUtc,
  parseCalendarDate,
  scheduleContainsStart,
} from '../utils/clinicSchedule.js';

describe('Clinic appointment schedules', () => {
  it('accepts only real YYYY-MM-DD calendar dates', () => {
    assert.ok(parseCalendarDate('2026-02-28'));
    assert.equal(parseCalendarDate('2026-02-30'), null);
    assert.equal(parseCalendarDate('26-02-28'), null);
  });

  it('converts clinic wall time to UTC and derives the IST weekday', () => {
    const appointment = istDateTimeToUtc('2026-07-06', 9 * 60);
    assert.equal(appointment.toISOString(), '2026-07-06T03:30:00.000Z');
    assert.deepEqual(getIstDateParts(appointment), {
      dayOfWeek: 1,
      minuteOfDay: 9 * 60,
      date: '2026-07-06',
    });
  });

  it('requires the full consultation to fit on a configured schedule boundary', () => {
    const association = {
      weeklySchedule: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:30' }],
    };
    assert.equal(
      scheduleContainsStart(association, istDateTimeToUtc('2026-07-06', 9 * 60), 45),
      true
    );
    assert.equal(
      scheduleContainsStart(association, istDateTimeToUtc('2026-07-06', 9 * 60 + 15), 45),
      false
    );
    assert.equal(
      scheduleContainsStart(association, istDateTimeToUtc('2026-07-06', 10 * 60), 45),
      false
    );
  });

  it('creates one overlap-lock key per fifteen-minute segment', () => {
    const keys = createSlotKeys(istDateTimeToUtc('2026-07-06', 9 * 60), 45);
    assert.equal(keys.length, 3);
    assert.deepEqual(
      keys.map((date) => date.toISOString()),
      [
        '2026-07-06T03:30:00.000Z',
        '2026-07-06T03:45:00.000Z',
        '2026-07-06T04:00:00.000Z',
      ]
    );
  });
});
