export const getHealth = (_req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'HealPoint API is running',
  });
};
