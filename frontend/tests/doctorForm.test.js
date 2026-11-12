import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formFromDoctor, initialDoctorClinicId } from '../src/doctorForm.js'

const clinic = (id, isActive = true) => ({ id, isActive })
const association = (clinicId, schedule, branchId, isActive = true) => ({
  clinic: { _id: clinicId },
  branch: { _id: branchId },
  weeklySchedule: schedule,
  isActive,
})
const mondayHours = [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }]

describe('doctor editor clinic schedule mapping', () => {
  it('selects and loads the only existing clinic association', () => {
    const doctor = {
      clinicAssociations: [association('clinic-a', mondayHours, 'branch-a')],
    }
    const clinics = [clinic('other-clinic'), clinic('clinic-a')]

    const clinicId = initialDoctorClinicId(doctor, clinics)
    const form = formFromDoctor(doctor, clinicId)

    assert.equal(clinicId, 'clinic-a')
    assert.equal(form.clinicId, 'clinic-a')
    assert.equal(form.branchId, 'branch-a')
    assert.deepEqual(form.weeklySchedule, mondayHours)
  })

  it('loads the selected association when a doctor has multiple clinics', () => {
    const tuesdayHours = [{ dayOfWeek: 2, startTime: '13:00', endTime: '17:00' }]
    const doctor = {
      clinicAssociations: [
        association('clinic-a', mondayHours, 'branch-a'),
        association('clinic-b', tuesdayHours, 'branch-b'),
      ],
    }
    const clinics = [clinic('clinic-b'), clinic('clinic-a')]

    assert.equal(initialDoctorClinicId(doctor, clinics), 'clinic-a')
    const selectedForm = formFromDoctor(doctor, 'clinic-b')

    assert.equal(selectedForm.clinicId, 'clinic-b')
    assert.equal(selectedForm.branchId, 'branch-b')
    assert.deepEqual(selectedForm.weeklySchedule, tuesdayHours)
  })

  it('does not copy another clinic schedule when the selected clinic has no association', () => {
    const doctor = {
      clinicAssociations: [association('clinic-a', mondayHours, 'branch-a')],
    }

    const form = formFromDoctor(doctor, 'clinic-b')

    assert.equal(form.clinicId, 'clinic-b')
    assert.equal(form.branchId, '')
    assert.deepEqual(form.weeklySchedule, [])
    assert.equal(form.clinicAssociationIsActive, true)
  })

  it('preserves new-doctor initialization to the first active clinic', () => {
    const clinics = [clinic('inactive', false), clinic('active')]

    assert.equal(initialDoctorClinicId(null, clinics), 'active')
    assert.equal(formFromDoctor(null, 'active').clinicId, 'active')
  })
})
