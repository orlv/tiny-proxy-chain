# Tiny Proxy Chain
Proxy in-the-middle

```
npm i -D tiny-proxy-chain
```

```javascript
const TinyProxyChain = require('tiny-proxy-chain')

new TinyProxyChain({
  listenPort: 8080,
  proxyURL: 'http://host:port',
  proxyUsername: 'user',
  proxyPassword: 'password',
  debug: false,
  onRequest: (req, defaultProxyOptions) => {
      console.log(`${req.method} ${req.url} HTTP/${req.httpVersion}`)
  
      if (req.headers.authorization !== TinyProxyChain.makeAuth('user', 'password')) {
            req.socket.write(`HTTP/${req.httpVersion} 401 Unauthorized\r\n` +
              `WWW-Authenticate: Basic\r\n`)
      } else if (req.url.includes('some-site')) {
        return TinyProxyChain.makeProxyOptions('http://proxy2:port', 'username2', 'password2')
      } else {
        return defaultProxyOptions
      }
    }
}).listen()
```
