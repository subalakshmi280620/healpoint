import ClinicDoctor from '../models/ClinicDoctor.js';
import DoctorProfile from '../models/DoctorProfile.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';

const formatAppointmentTime = (startAt) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(startAt);

const createNotification = ({ recipient, appointment, actor, type, title, message }) => ({
  recipient,
  appointment: appointment._id,
  actor,
  type,
  title,
  message,
});

export const publishAppointmentNotifications = async ({
  appointment,
  actorId,
  event,
  session,
}) => {
  const [patient, doctor, association, platformAdmins] = await Promise.all([
    User.findById(appointment.patient).select('_id name').session(session),
    DoctorProfile.findById(appointment.doctor)
      .select('user')
      .populate('user', 'name')
      .session(session),
    appointment.clinicDoctor
      ? ClinicDoctor.findById(appointment.clinicDoctor)
          .select('clinic')
          .populate({ path: 'clinic', select: 'createdBy' })
          .session(session)
      : null,
    User.find({ role: 'platform_admin', isActive: true }).select('_id').session(session),
  ]);
  if (!patient || !doctor?.user) {
    throw new Error('Unable to determine appointment notification recipients');
  }

  const clinic = association?.clinic;
  const clinicAdmins = clinic
    ? await User.find({
        role: 'clinic_admin',
        isActive: true,
        $or: [{ _id: clinic.createdBy }, { clinic: clinic._id }],
      })
        .select('_id')
        .session(session)
    : [];
  const doctorName = doctor.user.name;
  const visitTime = formatAppointmentTime(appointment.startAt);
  const notifications = [];
  const recipientIds = new Set([
    String(patient._id),
    String(doctor.user._id),
    ...platformAdmins.map((user) => String(user._id)),
  ]);
  for (const clinicAdmin of clinicAdmins) recipientIds.add(String(clinicAdmin._id));

  if (event === 'booking') {
    const operationalRecipients = [...recipientIds]
      .filter((id) => id !== String(patient._id));
    notifications.push(
      ...operationalRecipients.map((recipient) =>
        createNotification({
          recipient,
          appointment,
          actor: actorId,
          type: 'booking',
          title: 'New appointment booked',
          message: `A patient booked an appointment with ${doctorName} for ${visitTime}.`,
        })
      ),
      createNotification({
        recipient: patient._id,
        appointment,
        actor: actorId,
        type: 'confirmation',
        title: 'Appointment confirmed',
        message: `Your appointment with ${doctorName} on ${visitTime} is confirmed.`,
      })
    );
  } else {
    const eventCopy = {
      cancellation: {
        title: 'Appointment cancelled',
        message: `The appointment with ${doctorName} on ${visitTime} was cancelled.`,
      },
      completion: {
        title: 'Appointment completed',
        message: `The appointment with ${doctorName} on ${visitTime} was marked complete.`,
      },
      confirmation: {
        title: 'Appointment confirmed',
        message: `The appointment with ${doctorName} on ${visitTime} is confirmed.`,
      },
    }[event];
    if (!eventCopy) throw new Error(`Unsupported appointment notification event: ${event}`);
    notifications.push(
      ...[...recipientIds].map((recipient) =>
        createNotification({
          recipient,
          appointment,
          actor: actorId,
          type: event,
          ...eventCopy,
        })
      )
    );
  }

  if (notifications.length) {
    await Notification.insertMany(notifications, { session });
  }
};
