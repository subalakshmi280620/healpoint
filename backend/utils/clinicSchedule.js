export const CLINIC_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MINUTES = 330;
const SLOT_KEY_MINUTES = 15;

export const parseCalendarDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

export const getIstDateParts = (date) => {
  const istDate = new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return {
    dayOfWeek: istDate.getUTCDay(),
    minuteOfDay: istDate.getUTCHours() * 60 + istDate.getUTCMinutes(),
    date: [
      istDate.getUTCFullYear(),
      String(istDate.getUTCMonth() + 1).padStart(2, '0'),
      String(istDate.getUTCDate()).padStart(2, '0'),
    ].join('-'),
  };
};

export const istDateTimeToUtc = (dateValue, minuteOfDay) => {
  const date = parseCalendarDate(dateValue);
  if (!date || !Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay >= 1440) {
    return null;
  }
  return new Date(
    date.getTime() +
      minuteOfDay * 60 * 1000 -
      IST_OFFSET_MINUTES * 60 * 1000
  );
};

export const scheduleContainsStart = (association, startAt, durationMinutes) => {
  const { dayOfWeek, minuteOfDay } = getIstDateParts(startAt);
  return (association.weeklySchedule || []).some((window) => {
    if (window.dayOfWeek !== dayOfWeek) return false;
    const [startHour, startMinute] = window.startTime.split(':').map(Number);
    const [endHour, endMinute] = window.endTime.split(':').map(Number);
    const windowStart = startHour * 60 + startMinute;
    const windowEnd = endHour * 60 + endMinute;
    return (
      minuteOfDay >= windowStart &&
      minuteOfDay + durationMinutes <= windowEnd &&
      (minuteOfDay - windowStart) % durationMinutes === 0
    );
  });
};

export const createSlotKeys = (startAt, durationMinutes) =>
  Array.from(
    { length: durationMinutes / SLOT_KEY_MINUTES },
    (_, index) => new Date(startAt.getTime() + index * SLOT_KEY_MINUTES * 60 * 1000)
  );
