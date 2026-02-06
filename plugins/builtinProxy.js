// plugins/builtinProxy.js
module.exports = (bot, proxyConfig) => {
  if (!proxyConfig || proxyConfig.type !== 'socks5') {
    console.log('[builtinProxy] No valid SOCKS5 proxy config provided — skipping');
    return;
  }

  const { host, port, auth } = proxyConfig;

  console.log(`[builtinProxy] Applying built-in SOCKS5 proxy: ${host}:${port}`);

  // minecraft-protocol built-in proxy support (from the example you linked)
  bot._client.setProxy({
    type: 'socks5',
    host: host,
    port: port,
    auth: auth ? { username: auth.username, password: auth.password } : undefined
  });

  console.log('[builtinProxy] Proxy applied successfully');
};