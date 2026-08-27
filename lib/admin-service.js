function sessionCookie(value, maxAge, cookieSecure) {
  const secure = cookieSecure ? '; Secure' : '';

  return (
    `admin_session=${encodeURIComponent(value)}; ` +
    'HttpOnly; SameSite=Lax; Path=/; ' +
    `Max-Age=${maxAge}${secure}`
  );
}
