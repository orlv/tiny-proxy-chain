'use strict'

const http = require('http')
const https = require('https')
const net = require('net')
const SocksProxyAgent = require('socks-proxy-agent')
const { SocksClient } = require('socks')

class TinyProxyChain {
  /**
   * TinyProxyChain
   * @param {number} listenPort
   * @param {string} [proxyURL] - 'http://127.0.0.1:8080'
   * @param {string} [proxyUsername]
   * @param {string} [proxyPassword]
   * @param {boolean} [debug=false]
   * @param {function} [onRequest]
   * @param {string} [key] - ssl key
   * @param {string} [cert] - ssl cert
   * @param {string} [ca] - ssl cert
   */
  constructor ({ listenPort, proxyURL, proxyUsername, proxyPassword, debug = false, onRequest, key, cert, ca }) {
    this.listenPort = listenPort
    this.defaultProxyOptions = TinyProxyChain.makeProxyOptions(proxyURL, proxyUsername, proxyPassword)
    this.debug = debug === true
    this.onRequest = onRequest ? onRequest : (req, opt) => opt
    this.proxy = key && cert && ca
      ? https.createServer({ key, cert, ca }, (req, res) => this.makeRequest(req, res))
      : http.createServer((req, res) => this.makeRequest(req, res))

    this.proxy.on('connect', this.makeConnection.bind(this))

    this.proxy.on('error', e =>
      console.log(e)
    )
  }

  /**
   * @param {string} proxyURL
   * @param {string} [proxyUsername]
   * @param {string} [proxyPassword]
   * @returns {{proxyType: string, socksType: number, proxyURL: string, proxyHost: string, proxyPort: number, proxyAuth: string}|null}
   */
  static makeProxyOptions (proxyURL, proxyUsername, proxyPassword) {
    if (proxyURL) {
      const { hostname, port } = new URL(proxyURL)

      const proxyType = /^socks/.test(proxyURL) ? 'socks' : 'http'

      return hostname
        ? {
          proxyType,
          socksType: proxyType === 'socks' ? /^socks5?:/.test(proxyURL) ? 5 : 4 : null,
          proxyAuth: proxyUsername && proxyPassword ? TinyProxyChain.makeAuth(proxyUsername, proxyPassword) : '',
          proxyURL: proxyURL,
          proxyHost: hostname,
          proxyPort: port,
          proxyUsername,
          proxyPassword
        }
        : null
    }

    return null
  }

  /**
   * @param {string} proxyUsername
   * @param {string} proxyPassword
   * @returns {string}
   */
  static makeAuth (proxyUsername, proxyPassword) {
    return 'Basic ' + Buffer.from(`${proxyUsername}:${proxyPassword}`).toString('base64')
  }

  listen () {
    if (!this.proxy.listening) {
      this.proxy.listen(this.listenPort)

      if (this.debug) {
        console.log(`TCP server accepting connection on port: ${this.listenPort}`)
      }
    }

    return this
  }

  close () {
    if (this.proxy.listening) {
      this.proxy.close()
    }

    return this
  }

  static makeSocksRequestOptions (proxyOptions, req) {
    const { hostname, port, pathname } = new URL(req.url)
    const headers = { ...req.headers }

    delete headers['Proxy-Authorization']

    return {
      hostname,
      port,
      path: pathname,
      method: req.method,
      headers,
      agent: new SocksProxyAgent(proxyOptions.proxyURL)
    }
  }

  static makeHttpRequestOptions (proxyOptions, req) {
    return {
      hostname: proxyOptions.proxyHost,
      port: proxyOptions.proxyPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        'Proxy-Authorization': proxyOptions.proxyAuth
      }
    }
  }

  makeRequest (req, res) {
    const proxyOptions = this.onRequest(req, this.defaultProxyOptions)

    if (!proxyOptions) {
      res.end()
    } else {
      const options = proxyOptions.proxyType === 'socks'
        ? TinyProxyChain.makeSocksRequestOptions(proxyOptions, req)
        : TinyProxyChain.makeHttpRequestOptions(proxyOptions, req)

      const proxyReq = http.request(options)

      req.pipe(proxyReq)

      proxyReq.on('response', proxyRes => {
        res.statusCode = proxyRes.statusCode

        Object.keys(proxyRes.headers).forEach(key => {
          res.setHeader(key, proxyRes.headers[key])
        })

        proxyRes.pipe(res)
      })

      proxyReq.on('error', e => {
        res.statusCode = 500
        res.end()

        if (this.debug) {
          console.error('<-', e)
        }
      })
    }
  }

  async makeSocksConnection (proxyOptions, req, clientSocket) {
    const [host, port] = req.url.split(':')

    const options = {
      proxy: {
        host: proxyOptions.proxyHost,
        port: parseInt(proxyOptions.proxyPort),
        type: proxyOptions.socksType, // 4 or 5
        userId: proxyOptions.proxyUsername,
        password: proxyOptions.proxyPassword
      },

      command: 'connect',

      destination: {
        host,
        port: parseInt(port) || 80
      }
    }

    const { socket: srvSocket } = await SocksClient.createConnection(options)

    srvSocket.on('end', () => {
      if (clientSocket.writable) {
        clientSocket.end()
      }
    })

    srvSocket.on('error', e => {
      if (clientSocket.writable) {
        clientSocket.write(`HTTP/${req.httpVersion} 500 Connection error\r\n\r\n`)
        clientSocket.end()
      }

      if (this.debug) {
        console.error('<-', e)
      }
    })

    if (clientSocket.writable) {
      clientSocket.write('HTTP/1.0 200 Connection established\r\n\r\n')
    }

    return srvSocket
  }

  async makeHTTPProxyConnection (proxyOptions, req, clientSocket) {
    return new Promise(resolve => {
      const srvSocket = net.connect(proxyOptions.proxyPort, proxyOptions.proxyHost, () => {
        const httpRequest = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
          Object.keys(req.headers).map(header => `${header}: ${req.headers[header]}\r\n`).join('') +
          `Proxy-Authorization: ${proxyOptions.proxyAuth}\r\n\r\n`

        if (this.debug) {
          console.log(`\n${httpRequest}\n`)
        }

        srvSocket.write(httpRequest)

        resolve(srvSocket)
      })

      srvSocket.on('end', () => {
        clientSocket.end()
      })

      srvSocket.on('error', e => {
        clientSocket.write(`HTTP/${req.httpVersion} 500 Connection error\r\n\r\n`)
        clientSocket.end()

        if (this.debug) {
          console.error('<-', e)
        }
      })
    })
  }

  async makeConnection (req, clientSocket, head) {
    let srvSocket = null
    let alive = true

    clientSocket.on('error', e => {
      alive = false

      if (srvSocket) {
        srvSocket.end()
      }

      if (this.debug) {
        console.error('->', e)
      }
    })

    if (this.debug) {
      console.log(`${req.method} ${req.url} HTTP/${req.httpVersion}`)
      console.log(JSON.stringify(req.headers, null, 2))
    }

    const proxyOptions = this.onRequest(req, this.defaultProxyOptions)

    if (!proxyOptions) {
      clientSocket.end()
    } else {
      try {
        srvSocket = await (proxyOptions.proxyType === 'socks'
          ? this.makeSocksConnection(proxyOptions, req, clientSocket)
          : this.makeHTTPProxyConnection(proxyOptions, req, clientSocket))

        if (head && head.length > 0) {
          srvSocket.write(head)
        }

        clientSocket.on('data', data => {
          if (srvSocket.writable) {
            srvSocket.write(data)
          }
        })

        srvSocket.pipe(clientSocket)

        if (!alive) {
          srvSocket.end()
        }
      } catch (e) {
        if (this.debug) {
          console.error('<-1', e)
        }

        clientSocket.write(`HTTP/${req.httpVersion} 500 Connection error\r\n\r\n`)
        clientSocket.end()

        if (srvSocket) {
          srvSocket.end()
        }
      }
    }
  }
}

module.exports = TinyProxyChain
