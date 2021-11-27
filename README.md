# Tiny Proxy Chain

Proxy in-the-middle

```
npm i -D tiny-proxy-chain
```

```javascript
const TinyProxyChain = require('tiny-proxy-chain')

new TinyProxyChain({
  listenPort: 8080,
  proxyURL: 'http://other-proxy-host:port',
  proxyUsername: 'other-proxy-user',
  proxyPassword: 'other-proxy-password',
  debug: false,
  key: fs.readFileSync('./keys/privkey.pem'),
  cert: fs.readFileSync('./keys/cert.pem'),
  ca: fs.readFileSync('./keys/chain.pem'),
  connectionTimeout: 60000,
  onRequest: (req, defaultProxyOptions) => {
    console.log(`${req.method} ${req.url} HTTP/${req.httpVersion}`)

    if (req.headers['proxy-authorization'] !== TinyProxyChain.makeAuth('tiny-proxy-username', 'tiny-proxy-password')) {
      req.socket.write(
        `HTTP/${req.httpVersion} 407 Proxy Authentication Required\r\n` +
        `Proxy-Authenticate: Basic\r\n\r\n`
      )
    } else {
      delete req.headers['proxy-authorization']
      return defaultProxyOptions
    }
  }
}).listen()
```
