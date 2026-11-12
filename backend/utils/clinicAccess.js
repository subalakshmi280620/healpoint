export const isClinicAdminForClinic = (user, clinic) =>
  user?.role === 'clinic_admin' &&
  (
    String(clinic?.createdBy) === String(user._id) ||
    String(clinic?._id) === String(user.clinic)
  );

export const getClinicAdminClinicFilter = (user) => {
  const conditions = [{ createdBy: user._id }];
  if (user.clinic) conditions.push({ _id: user.clinic });
  return { $or: conditions };
};
