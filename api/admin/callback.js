'use strict';

const { callback } = require('../../lib/admin-service');

module.exports = async function handler(req, res) {
  try {
    return await callback(req, res);
  } catch (error) {
    console.error('GitHub OAuth callback failed:', {
      name: error?.name,
      message: error?.message
    });

    return res.redirect('/admin?auth=failed');
  }
};
