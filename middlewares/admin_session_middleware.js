function requireAdminSession(req, res, next) {
  if (!req.session || !req.session.adminUser) {
    return res.redirect("/admin/login");
  }

  next();
}

module.exports = {
  requireAdminSession,
};