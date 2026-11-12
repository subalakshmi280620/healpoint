import Notification from '../models/Notification.js';
import { isValidObjectId } from '../utils/mongo.js';

export const getNotifications = async (req, res) => {
  const parsedLimit = Number(req.query.limit);
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, 50)
    : 20;

  try {
    const filter = { recipient: req.user._id };
    const [notifications, unreadCount] = await Promise.all([
      Notification.find(filter)
        .populate('appointment', 'startAt endAt status')
        .sort({ createdAt: -1 })
        .limit(limit),
      Notification.countDocuments({ ...filter, readAt: null }),
    ]);

    return res.status(200).json({
      status: 'success',
      data: { notifications, unreadCount },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to load notifications',
    });
  }
};

export const markNotificationRead = async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ status: 'error', message: 'Invalid notification id' });
  }

  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id, readAt: null },
      { $set: { readAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!notification) {
      const ownedNotification = await Notification.exists({
        _id: req.params.id,
        recipient: req.user._id,
      });
      if (!ownedNotification) {
        return res.status(404).json({ status: 'error', message: 'Notification not found' });
      }
      return res.status(200).json({
        status: 'success',
        message: 'Notification was already read',
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Notification marked as read',
      data: { notification },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to update notification',
    });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );
    return res.status(200).json({
      status: 'success',
      message: 'All notifications marked as read',
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to update notifications',
    });
  }
};
