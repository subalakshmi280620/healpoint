export const authorizeRoles = (...allowedRoles) => (req, res, next) => {
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      status: 'error',
      message: 'Not authorized to perform this action',
    });
  }

  return next();
};

export const rejectRoleAssignment = (req, res, next) => {
  if (Object.prototype.hasOwnProperty.call(req.body, 'role')) {
    return res.status(403).json({
      status: 'error',
      message: 'You cannot assign roles through this endpoint',
    });
  }

  return next();
};
