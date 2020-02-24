'use strict'

const http = require('http')
const https = require('https')
const net = require('net')

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
   */
  constructor ({ listenPort, proxyURL, proxyUsername, proxyPassword, debug = false, onRequest, key, cert }) {
    this.listenPort = listenPort
    this.defaultProxyOptions = TinyProxyChain.makeProxyOptions(proxyURL, proxyUsername, proxyPassword)
    this.debug = debug === true
    this.onRequest = onRequest ? onRequest : (req, opt) => opt
    this.proxy = key && cert
      ? https.createServer({ key, cert }, (req, res) => this.makeRequest(req, res))
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
   * @returns {{proxyHost: string, proxyPort: number, proxyAuth: string}|null}
   */
  static makeProxyOptions (proxyURL, proxyUsername, proxyPassword) {
    if (proxyURL) {
      const { hostname, port } = new URL(proxyURL)

      return hostname
        ? {
          proxyAuth: proxyUsername && proxyPassword ? TinyProxyChain.makeAuth(proxyUsername, proxyPassword) : '',
          proxyHost: hostname,
          proxyPort: port
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

  makeRequest (req, res) {
    const proxyOptions = this.onRequest(req, this.defaultProxyOptions)

    if (!proxyOptions) {
      res.end()
    } else {
      const headers = {
        ...req.headers,
        'Proxy-Authorization': proxyOptions.proxyAuth
      }

      const options = {
        hostname: proxyOptions.proxyHost,
        port: proxyOptions.proxyPort,
        path: req.url,
        method: req.method,
        headers
      }

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

  makeConnection (req, clientSocket, head) {
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
      req.socket.end()
    } else {
      srvSocket = net.connect(proxyOptions.proxyPort, proxyOptions.proxyHost, () => {
        const httpRequest = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
          Object.keys(req.headers).map(header => `${header}: ${req.headers[header]}\r\n`).join('') +
          `Proxy-Authorization: ${proxyOptions.proxyAuth}\r\n\r\n`

        if (this.debug) {
          console.log(`\n${httpRequest}\n`)
        }

        srvSocket.write(httpRequest)

        if (head && head.length > 0) {
          srvSocket.write(head)
        }

        srvSocket.pipe(clientSocket)
        clientSocket.pipe(srvSocket)
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

      if (!alive) {
        srvSocket.end()
      }
    }
  }
}

module.exports = TinyProxyChain
