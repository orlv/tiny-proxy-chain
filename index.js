'use strict'

const http = require('http')
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
   */
  constructor ({ listenPort, proxyURL, proxyUsername, proxyPassword, debug = false, onRequest }) {
    this.listenPort = listenPort
    this.defaultProxyOptions = TinyProxyChain.makeProxyOptions(proxyURL, proxyUsername, proxyPassword)
    this.debug = debug === true
    this.onRequest = onRequest ? onRequest : (req, opt) => opt
    this.proxy = http.createServer(req => this.makeRequest(req, req.socket, null))
    this.proxy.on('connect', this.makeRequest.bind(this))
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

  makeRequest (req, clientSocket, head) {
    if (this.debug) {
      console.log(`${req.method} ${req.url} HTTP/${req.httpVersion}`)
      console.log(JSON.stringify(req.headers, null, 2))
    }

    const proxyOptions = this.onRequest(req, this.defaultProxyOptions)

    if (!proxyOptions) {
      req.socket.end()
    } else {
      const srvSocket = net.connect(proxyOptions.proxyPort, proxyOptions.proxyHost, () => {
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

      clientSocket.on('error', e => {
        srvSocket.end()

        if (this.debug) {
          console.error('->', e)
        }
      })
    }
  }
}

module.exports = TinyProxyChain
