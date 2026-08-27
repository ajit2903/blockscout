  } catch (error) {
    console.error('GitHub OAuth callback failed:', {
      name: error?.name || 'Error',
      message: error?.message || 'Unknown error'
    });

    return redirect(res, '/admin?auth=failed', [clearOauthCookie]);
  }
