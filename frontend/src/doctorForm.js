export const clinicIdForAssociation = (association) =>
  String(association?.clinic?._id || association?.clinic?.id || association?.clinic || '')

export const emptyDoctorForm = (clinicId = '') => ({
  userId: '',
  name: '',
  profileImage: '',
  specialty: '',
  qualification: '',
  experienceYears: '0',
  consultationFeeInr: '',
  consultationDurationMinutes: '30',
  languagesSpoken: '',
  bio: '',
  clinicId,
  branchId: '',
  weeklySchedule: [],
  isActive: true,
  clinicAssociationIsActive: true,
})

export const initialDoctorClinicId = (doctor, clinics) => {
  const activeClinicIds = new Set(
    clinics.filter((clinic) => clinic.isActive).map((clinic) => String(clinic.id))
  )
  const existingAssociation = doctor?.clinicAssociations?.find((association) =>
    activeClinicIds.has(clinicIdForAssociation(association))
  )
  if (existingAssociation) return clinicIdForAssociation(existingAssociation)
  if (doctor?.clinicAssociations?.length) return ''
  return clinics.find((clinic) => clinic.isActive)?.id || ''
}

export const formFromDoctor = (doctor, clinicId = '') => {
  const association = doctor?.clinicAssociations?.find((item) =>
    clinicIdForAssociation(item) === String(clinicId)
  )
  const selectedClinicId = clinicId || clinicIdForAssociation(association)
  return {
    ...emptyDoctorForm(selectedClinicId),
    userId: String(doctor?.user?._id || doctor?.user || ''),
    name: doctor?.user?.name || '',
    profileImage: doctor?.profileImage || '',
    specialty: String(doctor?.specialty?._id || doctor?.specialty || ''),
    qualification: doctor?.qualification || '',
    experienceYears: String(doctor?.experienceYears ?? 0),
    consultationFeeInr: String(doctor?.consultationFeeInr ?? doctor?.consultationFee ?? ''),
    consultationDurationMinutes: String(doctor?.consultationDurationMinutes || 30),
    languagesSpoken: (doctor?.languagesSpoken || []).join(', '),
    bio: doctor?.bio || '',
    branchId: String(association?.branch?._id || association?.branch?.id || ''),
    weeklySchedule: (association?.weeklySchedule || []).map((window) => ({ ...window })),
    isActive: doctor?.isActive ?? true,
    clinicAssociationIsActive: association?.isActive ?? true,
  }
}
